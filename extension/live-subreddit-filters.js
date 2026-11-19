/* Keep native community feeds and search results in charge of loading and rendering. */
(() => {
  'use strict';
  if (window.top !== window || globalThis.RTLiveSubredditFilters) return;
  const filters = globalThis.RTFeedFilters;
  const sheet = globalThis.RTFeedSheet;
  if (!filters || !sheet) return;

  const hidden = 'data-rt-community-filtered';
  const paused = 'data-rt-community-paused';
  const outgoing = 'data-rt-community-outgoing';
  const restoring = 'data-rt-community-restoring';
  const returnInputs = ['wheel','touchstart','pointerdown','keydown'];
  const resultsSelector = '[data-testid="search-sdui-post"],[data-testid="search-sdui-comment"]';
  const flairKey = 'rt-community-flairs-v1';
  const searchSorts = [['relevance','Relevance','search'], ['new','New','new'], ['top','Top','top'], ['hot','Hot','hot'], ['comments','Most comments','comment']];
  const searchDates = [['all','All time'], ['hour','Past hour'], ['day','Past 24 hours'], ['week','Past week'], ['month','Past month'], ['year','Past year']];
  const mediaTypes = new Map([['image','Photos'],['video','Videos'],['gif','GIFs'],['gallery','Galleries']]);
  const mediaUnits = 'search-media-feed search-telemetry-tracker[view-events="search/view/post"]';
  const videoHosts = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|streamable\.com|twitch\.tv|dailymotion\.com|dai\.ly|gfycat\.com|redgifs\.com|tiktok\.com|rumble\.com)$/i;
  const isPhone = () => Boolean(globalThis.matchMedia?.('(max-width: 767.98px)')?.matches);
  const nativeFeedSort = 'shreddit-sort-dropdown:not([hidden]),shreddit-layout-switcher:not([hidden])';
  const sortReplaced = 'data-rt-community-sort-replaced';
  const sortBoot = 'data-rt-community-sort-boot';
  const sortNative = 'data-rt-community-sort-native';
  const feedSortIcons = {best:'best',hot:'hot',new:'new',top:'top',rising:'top',controversial:'sort'};
  // Reddit shows the selected sort with the filled variant of its icon.
  const sortGlyph = (choice, size) => (choice.selected && filters.svgIcon(choice.icon + '-fill',size)) || filters.svgIcon(choice.icon,size);
  const nativeSearchSort = 'search-sort-dropdown-menu:not([hidden]),shreddit-sort-dropdown:not([hidden]),filter-drawer[id*="sort"]:not([hidden]),[data-testid="search-sort"]';
  const nativeSearchTime = 'search-time-dropdown-menu:not([hidden]),shreddit-time-dropdown:not([hidden]),filter-drawer[id*="time"]:not([hidden]),[data-testid="search-time"]';

  function externalVideo(unit) {
    const direct = unit.getAttribute?.('content-href') || unit.getAttribute?.('url') || '';
    const domain = String(unit.getAttribute?.('domain') || '').replace(/^www\./i,'');
    try { if (direct && videoHosts.test(new URL(direct,location.href).hostname)) return true; } catch {}
    if (domain && videoHosts.test(domain)) return true;
    for (const link of unit.querySelectorAll('a[href]')) {
      try {
        if (videoHosts.test(new URL(link.getAttribute('href'),location.href).hostname)) return true;
      } catch {}
    }
    return false;
  }

  function mediaType(unit) {
    const explicit = filters.inferType(unit.querySelector('[post-type]') || unit);
    if (explicit === 'video' || explicit === 'gif' || explicit === 'gallery') return explicit;
    if (unit.querySelector('shreddit-gallery-carousel,[data-testid="galleryIcon"],a[href^="/gallery/"]')) return 'gallery';
    const image = unit.querySelector('img[data-post-media-primary]');
    const source = image?.getAttribute('src') || '';
    if (/\.gif(?:[?#]|$)|[?&]format=gif(?:&|$)/i.test(source)) return 'gif';
    if (unit.querySelector('[data-testid="videoIcon"],shreddit-player,shreddit-player-2,video') || externalVideo(unit)) return 'video';
    if (explicit === 'image') return 'image';
    return image ? 'image' : '';
  }
  const fold = value => String(value || '').toLowerCase();
  const postId = path => /^\/(?:r\/[^/]+\/|user\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/|$)/i.exec(path)?.[1].toLowerCase();
  const historyEntry = () => window.navigation?.currentEntry?.key || location.href;

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
    constructor({navigate: go = navigate, enabled = true, waitingForSettings = false} = {}) {
      this.navigate = go;
      this.enabled = enabled;
      this.waitingForSettings = waitingForSettings;
      this.hidden = new Set();
      this.flairs = loadFlairs();
      this.links = new Map();
      this.positions = new Map();
      this.onRoute = () => {
        this.panel?.close();
        this.schedule();
      };
      this.onHistory = () => {
        const entry = historyEntry();
        if (this.returnEntry !== entry) {
          this.returnEntry = entry;
          this.returnDeadline = performance.now() + 2500;
        }
        this.onRoute();
      };
      this.onEntry = event => event.navigationType === 'traverse' ? this.onHistory() : this.onRoute();
      this.onNavigate = event => {
        if (event.navigationType === 'push') this.rememberPost(new URL(event.destination.url));
      };
      this.onPostClick = event => {
        if (event.defaultPrevented || event.button !== 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const path = event.composedPath();
        const link = path.find(node => node.matches?.('a[href]'));
        const card = path.find(node => node.matches?.('shreddit-post'));
        if (!card || !link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
        this.rememberPost(new URL(link.href),card);
      };
      this.onReturnInput = () => this.finishReturn();
      this.onKeys = event => this.handleKey(event);
      this.onFocus = event => this.prepareInput(event);
      this.onScroll = () => this.resumeWhenScrolled();
      this.observer = new MutationObserver(records => {
        if ((!this.enabled && !this.waitingForSettings) || (!this.scope && !route())) return;
        if (this.departure?.opened && !this.departure.feed.isConnected && postId(location.pathname) === this.departure.id) {
          this.toolbar?.remove();
          this.note?.remove();
          return;
        }
        if (records.some(record => {
          if (record.target.closest?.('[data-rt-ui]')) return false;
          return [...record.addedNodes, ...record.removedNodes].some(node =>
            node.nodeType === 1 && !node.matches('[data-rt-ui]'));
        })) this.schedule();
      });
      this.observer.observe(document, {childList:true, subtree:true});
      window.addEventListener('popstate', this.onHistory);
      window.navigation?.addEventListener('navigate',this.onNavigate);
      window.navigation?.addEventListener('currententrychange',this.onEntry);
      for (const type of returnInputs) window.addEventListener(type,this.onReturnInput,{capture:true,passive:true});
      document.addEventListener('reddit:route', this.onRoute);
      document.addEventListener('click',this.onPostClick,true);
      document.addEventListener('keydown', this.onKeys, true);
      document.addEventListener('focusin', this.onFocus, true);
      window.addEventListener('scroll', this.onScroll, {passive:true});
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
      if (this.enabled === enabled && !this.waitingForSettings) return;
      this.waitingForSettings = false;
      this.enabled = enabled;
      if (!enabled) this.positions.clear();
      this.refresh();
    }

    rememberPost(url, card = null) {
      const id = postId(url.pathname), feed = this.feed;
      if (!id || url.origin !== location.origin || !this.enabled || !feed?.isConnected ||
          this.url.href !== location.href || !this.selectedTypes().length) return;
      const entry = historyEntry();
      if (this.departure?.entry === entry && this.departure?.id === id && !card) return;
      card ||= feed.querySelector(`shreddit-post[id="t3_${id}"]`);
      if (card?.id !== 't3_' + id || !feed.contains(card) || card.closest('[' + hidden + ']')) return;
      const offset = (card.closest('article') || card).getBoundingClientRect().top;
      this.departure = {id,entry,feed,href:location.href,offset,y:scrollY};
    }

    releaseDeparture() {
      this.departure?.feed.removeAttribute(outgoing);
      this.departure = null;
    }

    holdDeparture(url) {
      const state = this.departure;
      if (!state) return false;
      if (this.enabled && url.href === state.href && !state.opened) return false;
      if (!this.enabled || postId(url.pathname) !== state.id) {
        this.releaseDeparture();
        return false;
      }
      if (!state.opened) {
        state.opened = true;
        const {entry,id,href,offset,y} = state;
        this.positions.delete(entry);
        this.positions.set(entry,{id,href,offset,y});
        if (this.positions.size > 8) this.positions.delete(this.positions.keys().next().value);
      }
      if (state.feed.isConnected && state.feed.querySelector('shreddit-post[view-context="CommentsPage"]')) {
        this.releaseDeparture();
        return false;
      }
      // Keep filtering the exact outgoing native objects until Reddit is done with them. While a playing video or
      // YouTube player moves into the post (data-rt-media-moving, docs/video-control-spec.md) the feed stays on
      // screen behind it instead of leaving it on a blank page.
      state.feed.toggleAttribute(outgoing,state.feed.isConnected && !document.documentElement.hasAttribute('data-rt-media-moving'));
      if (!state.feed.isConnected) {
        this.toolbar?.remove();
        this.note?.remove();
      }
      return true;
    }

    releaseScrollHold() {
      if (!this.scrollReturn) return;
      this.scrollReturn.feed.removeAttribute(restoring);
      window.cancelAnimationFrame(this.scrollReturn.frame);
      this.scrollReturn = null;
    }

    finishReturn() {
      this.returnEntry = null;
      this.releaseScrollHold();
    }

    restoreAfterBack() {
      const saved = this.positions.get(this.returnEntry), feed = this.feed;
      if (!saved || saved.href !== location.href || !feed || this.scrollReturn?.feed === feed) return;
      this.releaseScrollHold();
      const state = this.scrollReturn = {feed,until:this.returnDeadline,stable:0};
      feed.setAttribute(restoring,'');
      const step = () => {
        if (this.scrollReturn !== state) return;
        if (!feed.isConnected) { this.releaseScrollHold(); return; }
        if (performance.now() >= state.until || saved.href !== location.href) { this.finishReturn(); return; }
        const card = feed.querySelector(`shreddit-post[id="t3_${saved.id}"]`);
        const box = card && !card.closest('[' + hidden + ']') && (card.closest('article') || card).getBoundingClientRect();
        if (box?.height) {
          const delta = box.top - saved.offset;
          if (Math.abs(delta) >= 1) {
            state.stable = 0;
            window.scrollBy({top:delta,behavior:'instant'});
          } else if (++state.stable >= 2) { this.finishReturn(); return; }
        } else {
          const max = Math.max(0,document.documentElement.scrollHeight - innerHeight);
          const target = Math.min(saved.y,max);
          if (Math.abs(scrollY - target) >= 1) window.scrollTo({top:target,behavior:'instant'});
        }
        state.frame = window.requestAnimationFrame(step);
      };
      step();
    }

    clear() {
      this.panel?.close();
      this.toolbar?.remove();
      this.note?.remove();
      this.endNote?.remove();
      this.feedPagination = null;
      this.toolbar = this.note = this.feed = this.main = this.scope = null;
      this.clearHidden();
      this.setReplacedSorts([]);
      this.setNativeSorts([]);
      this.feedSorts = null;
      this.clearPager();
      this.restoreLinks();
    }

    refresh() {
      const url = new URL(location.href);
      if (!this.enabled || (this.returnEntry && this.returnEntry !== historyEntry())) this.finishReturn();
      const current = route(url);
      const archive = current && document.querySelector('[data-rt-ui="archive-subreddit"]');
      document.documentElement?.toggleAttribute(sortBoot,Boolean((this.enabled || this.waitingForSettings) && current?.kind === 'feed' && !archive));
      if (this.holdDeparture(url)) return;
      const scope = this.enabled && current;
      const main = document.querySelector('main');
      const feed = scope?.kind === 'feed' && main?.querySelector('shreddit-feed');
      const tabs = scope?.kind === 'search' && document.querySelector('#search-results-page-tabgroup');
      const search = scope?.kind === 'search' && (tabs || main?.querySelector('[slot="filters"],search-media-feed,[data-testid="search-sdui-post"],[data-testid="search-error-message"]'));
      if (!scope || !main || (!feed && !search) || main.closest('[data-rt-ui]') || archive) {
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
      if (!this.toolbar?.isConnected) { this.panel?.close(); this.mount(tabs); }
      if (this.feed) this.placeFeedControls();
      else this.placeSearchControls(tabs);
      this.collectFlairs();
      this.filterResults();
      this.restoreAfterBack();
      this.updateToolbar();
      this.updateLinks();
      if (!this.feed) this.prepareBrowseHeader();
    }

    mount(tabs) {
      const bar = this.toolbar = make('div','rt-community-controls');
      bar.dataset.rtUi = 'community-filters';
      this.chips = make('div','rt-community-chips rt-filter-chips');
      if (this.feed) {
        // Same name as the profile's Feed options menu, which this toolbar mirrors.
        const options = this.options = make('button','rt-search-inline-filter rt-community-button','Feed options');
        options.type = 'button';
        options.dataset.rtCommunityOptions = '';
        options.setAttribute('aria-haspopup','true');
        options.setAttribute('aria-expanded','false');
        options.append(filters.svgIcon('caret-down',16));
        options.prepend(filters.svgIcon('filter',16));
        options.addEventListener('click', () => this.open());
        bar.append(options,this.chips);
        this.placeFeedControls();
        return;
      }
      this.searchButtons = new Map();
      for (const [key,title] of [['sort','Sort'],['date','Date'],['flair','Flair'],['media','Media type']]) {
        const button = make('button','rt-search-inline-filter');
        button.type = 'button';
        button.dataset.rtCommunitySearch = key;
        button.setAttribute('aria-haspopup','true');
        button.setAttribute('aria-expanded','false');
        const text = make('span','',title);
        button.append(text,filters.svgIcon('caret-down',16));
        button.addEventListener('click',() => this.openSearchMenu(button,key,title));
        this.searchButtons.set(key,{button,text,title});
        bar.append(button);
      }
      bar.append(this.chips);
      this.placeSearchControls(tabs);
    }

    placeFeedControls() {
      this.readFeedSorts();
      const sort = this.main.querySelector(nativeFeedSort);
      const rail = sort?.closest('div.flex.items-center');
      const bar = this.toolbar;
      bar?.classList.toggle('rt-community-in-feed-rail',Boolean(rail));
      this.chips.toggleAttribute('data-rt-rail',Boolean(rail));
      if (rail) {
        if (bar.parentElement !== rail) rail.append(bar);
      } else if (this.feed && bar.parentElement !== this.feed.parentElement) {
        this.feed.before(bar);
      }
    }

    setReplacedSorts(nodes) {
      const next = new Set(nodes);
      for (const node of this.replacedSorts || []) {
        if (!next.has(node)) node.removeAttribute(sortReplaced);
      }
      for (const node of next) {
        if (!node.hasAttribute(sortReplaced)) node.setAttribute(sortReplaced,'');
      }
      this.replacedSorts = next;
    }

    setNativeSorts(nodes) {
      const next = new Set(nodes);
      for (const node of this.nativeSorts || []) if (!next.has(node)) node.removeAttribute(sortNative);
      for (const node of next) node.setAttribute(sortNative,'');
      this.nativeSorts = next;
    }

    readFeedSorts() {
      const dropDowns = [...this.main.querySelectorAll('shreddit-sort-dropdown:not([hidden])')];
      const sort = dropDowns.find(node => node.getAttribute('sort-event') === 'feed-sort-change') ||
        dropDowns.find(node => !node.hasAttribute('sort-event') && node.getAttribute('header-text') !== 'View');
      const time = dropDowns.find(node => node.getAttribute('sort-event') === 'feed-time-sort-change');
      const read = (node, isTime = false) => {
        if (!node) return null;
        const current = node.querySelector('[slot="selected-item"]')?.textContent.trim() || '';
        const choices = new Map();
        for (const link of node.querySelectorAll('a[href],rpl-menu-item[href]')) {
          const hrefNow = link.getAttribute('href');
          const patched = this.links.get(link);
          const href = patched?.applied === hrefNow ? patched.original : hrefNow;
          const label = (link.getAttribute('aria-label') || link.textContent).trim();
          let url;
          try { url = new URL(href,this.url); } catch { continue; }
          const target = route(url);
          if (!label || url.origin !== this.url.origin || target?.kind !== 'feed' ||
              fold(target.name) !== fold(this.scope.name)) continue;
          const sortKey = fold(url.pathname.split('/').filter(Boolean)[2]);
          const key = isTime ? url.searchParams.get('t') : sortKey;
          if (!key) continue;
          const currentKey = isTime ? this.url.searchParams.get('t') :
            fold(this.url.pathname.split('/').filter(Boolean)[2]);
          const selected = currentKey ? key === currentKey : fold(label) === fold(current);
          choices.set(key,{key,label,selected,url,icon:isTime ? 'calendar' : feedSortIcons[key] || 'sort'});
        }
        if (!choices.size) return null;
        return {node,current:[...choices.values()].find(choice => choice.selected)?.label || current,choices:[...choices.values()]};
      };
      const sorting = read(sort);
      const range = sorting ? read(time,true) : null;
      this.feedSorts = {sorting,range};
      this.setReplacedSorts([sorting?.node,range?.node].filter(Boolean));
      this.setNativeSorts([sorting ? null : sort,range ? null : time].filter(Boolean));
    }

    chooseFeedSort(choice) {
      const url = new URL(choice.url);
      for (const name of ['rt_type','f','feedViewType','t']) {
        const value = this.url.searchParams.get(name);
        if (value && (name !== 't' || !url.searchParams.has(name))) url.searchParams.set(name,value);
      }
      this.go(url);
    }

    placeSearchControls(tabs) {
      const sort = document.querySelector(nativeSearchSort);
      const rail = sort?.closest('div.flex.items-center');
      const anchor = tabs?.parentElement;
      const bar = this.toolbar;
      bar?.classList.toggle('rt-community-in-search-rail',Boolean(rail));
      if (rail) {
        if (bar.parentElement !== rail) rail.append(bar);
      } else if (anchor) {
        if (anchor.nextElementSibling !== bar) anchor.after(bar);
      } else if (bar.parentElement !== this.main) {
        this.main.prepend(bar);
      }
      const native = el => el && !bar.contains(el);
      const railControls = rail ? [...rail.querySelectorAll('button,a,[role="button"]')].filter(native) : [];
      const labelOf = el => fold(el.getAttribute('aria-label') || el.textContent).trim();
      const nativeSort = Boolean(sort) || railControls.some(el => /sort by/.test(labelOf(el)));
      const nativeTime = Boolean(document.querySelector(nativeSearchTime)) ||
        railControls.some(el => /^(?:all time|past hour|past 24 hours|past week|past month|past year)$/.test(labelOf(el)));
      const state = {
        sort:{hidden:nativeSort,value:searchSorts.find(([id]) => id === this.url.searchParams.get('sort'))?.[1]},
        date:{hidden:nativeTime,value:searchDates.find(([id]) => id !== 'all' && id === this.url.searchParams.get('t'))?.[1]},
        flair:{value:this.activeFlair()},
        media:{hidden:!this.isMedia(),value:this.typeLabel()},
      };
      for (const [key,{button,text,title}] of this.searchButtons) {
        button.hidden = Boolean(state[key].hidden);
        const label = state[key].value || title;
        if (text.textContent !== label) text.textContent = label;
        button.setAttribute('aria-label',title + (state[key].value ? ', ' + label : ''));
      }
    }

    isMedia() {
      return !this.feed && this.url.searchParams.get('type') === 'media';
    }

    selectedTypes() {
      const types = filters.parse(this.url.search).types;
      if (this.feed) return types;
      return this.isMedia() ? types.filter(type => mediaTypes.has(type)) : [];
    }

    typeLabel() {
      const types = this.selectedTypes();
      if (types.length > 1) return types.length + ' types';
      return this.feed ? filters.typeLabels[types[0]] : mediaTypes.get(types[0]);
    }

    activeFlair() {
      return this.feed ? feedFlair(this.url) : searchParts(this.url).flair;
    }

    toggleType(type) {
      const current = this.selectedTypes();
      this.applyTypes(current.includes(type) ? current.filter(value => value !== type) : [...current,type]);
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
      this.pausedAt = 0;
    }

    // Scrolling after an empty-filter pause is a request for more results: let the native
    // pager load another couple of pages instead of leaving the reader on an empty feed.
    resumeWhenScrolled() {
      const paging = this.paging;
      if (!paging?.pager?.hasAttribute(paused)) return;
      if (this.pausedAt && performance.now() - this.pausedAt < 400) return;
      paging.emptyPages = 0;
      this.pausedAt = 0;
      this.filterResults();
    }

    filterResults() {
      const types = this.selectedTypes();
      const period = this.feed ? '' : this.url.searchParams.get('t');
      const date = period && filters.dateRange({date:{preset:period === 'day' ? '24h' : period}});
      const next = new Set();
      let matching = 0;
      if (this.feed && types.length) {
        const wanted = new Set(types);
        for (const card of this.feed.querySelectorAll('shreddit-post')) {
          const unit = card.closest('article') || card;
          const parent = unit.parentElement;
          if (parent !== this.feed && !parent?.matches('faceplate-batch,faceplate-partial')) continue;
          if (card.parentElement?.closest('shreddit-post,shreddit-ad-post')) continue;
          const type = filters.inferType(card);
          if (wanted.has(type) || (wanted.has('video') && type === 'embed' && externalVideo(card))) matching++;
          else {
            next.add(unit);
            if (unit.nextElementSibling?.tagName === 'HR') next.add(unit.nextElementSibling);
          }
        }
        // Promoted units are not posts of the chosen type; hiding the posts around them
        // otherwise leaves the feed looking like an ad list.
        for (const ad of this.feed.querySelectorAll('shreddit-ad-post')) {
          const unit = ad.closest('article') || ad;
          const parent = unit.parentElement;
          if (parent !== this.feed && !parent?.matches('faceplate-batch,faceplate-partial')) continue;
          next.add(unit);
          if (unit.nextElementSibling?.tagName === 'HR') next.add(unit.nextElementSibling);
        }
      }
      if (this.isMedia() && types.length) {
        const wanted = new Set(types);
        for (const unit of this.main.querySelectorAll(mediaUnits)) {
          if (wanted.has(mediaType(unit))) matching++;
          else next.add(unit);
        }
      }
      if (date && !this.isMedia()) for (const unit of this.main.querySelectorAll(resultsSelector)) {
        // New and some other sorts may ignore t on Reddit's server.
        const time = unit.querySelector('faceplate-timeago[ts],time[datetime]');
        const seconds = Date.parse(time?.getAttribute('ts') || time?.getAttribute('datetime') || '') / 1000;
        if (seconds >= date.after) matching++;
        else next.add(unit);
      }
      for (const node of this.hidden) if (!next.has(node)) node.removeAttribute(hidden);
      for (const node of next) if (!this.hidden.has(node)) node.setAttribute(hidden,'');
      this.hidden = next;

      const feedPager = this.feed ? [...this.feed.querySelectorAll('faceplate-partial[slot="load-after"]')].at(-1) : null;
      const reachedEnd = this.syncFeedEnd(feedPager,types.length,matching,next.size);
      const needsMore = (types.length || date) && next.size && !matching;
      if (!needsMore || reachedEnd) {
        this.clearPager();
        this.note?.remove();
        return;
      }
      // When all cards collapse, the next native loader can stay in view and
      // request many pages without a scroll. Pause after two empty continuations.
      const pager = this.feed
        ? feedPager
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
      if (waiting && !pager.hasAttribute(paused)) this.pausedAt = performance.now();
      if (!waiting) this.pausedAt = 0;
      pager?.toggleAttribute(paused,waiting);
      this.updateNote(date && !this.isMedia() ? 'No loaded results match this date range.' : 'No loaded posts match these types.',waiting);
    }

    syncFeedEnd(pager,filterCount,matching,hiddenCount) {
      if (!this.feed) return false;
      const source = this.url.pathname + '\n' + (this.feed.getAttribute('reload-url') || '');
      if (this.feedPagination?.source !== source) this.feedPagination = {source,pager:null};
      if (pager) this.feedPagination.pager = pager;
      const ended = filterCount && (matching || hiddenCount) && !pager &&
        this.feedPagination.pager && !this.feedPagination.pager.isConnected;
      if (!ended) { this.endNote?.remove(); return false; }

      const alternatives = (this.feedSorts?.sorting?.choices || []).filter(choice =>
        !choice.selected && ['new','top'].includes(choice.key));
      const message = matching ? 'You’ve reached the end of this Reddit feed.' : 'No posts in this Reddit feed match your filters.';
      const state = JSON.stringify([message,...alternatives.map(choice => choice.url)]);
      if (this.endNote?.isConnected && this.endNote.dataset.state === state) return true;
      this.endNote?.remove();
      const note = this.endNote = make('div','rt-community-note');
      note.dataset.rtUi = 'community-filter-end';
      note.dataset.state = state;
      const label = make('span','',message);
      label.setAttribute('role','status');
      note.append(label);
      for (const choice of alternatives) {
        const link = make('button','rt-community-button',choice.label);
        link.type = 'button';
        link.addEventListener('click',() => this.chooseFeedSort(choice));
        note.append(link);
      }
      this.feed.after(note);
      return true;
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
        else {
          const results = this.main.querySelector('search-media-feed,' + resultsSelector);
          if (results) results.before(this.note);
          else this.main.append(this.note);
        }
      }
      if (this.noteText.textContent !== message) this.noteText.textContent = message;
      this.more.hidden = !waiting;
    }

    updateToolbar() {
      const types = this.selectedTypes();
      const flair = this.activeFlair();
      const period = !this.feed && searchDates.find(([value]) => value !== 'all' && value === this.url.searchParams.get('t'));
      const key = JSON.stringify([types,flair,period]);
      if (this.chips.dataset.state === key) return;
      this.chips.dataset.state = key;
      this.chips.replaceChildren();
      const chip = (id, label, icon, onRemove) => this.chips.append(filters.pill(
        {id,label,icon},{make,glyph:name => filters.svgIcon(name,16),onRemove}
      ));
      for (const type of types) chip('type-' + type,this.feed ? filters.typeLabels[type] : mediaTypes.get(type),filters.typeIcons[type],
        () => this.applyTypes(types.filter(value => value !== type)));
      if (flair) chip('flair',flair,'filter',() => this.go(withFlair(this.url,'')));
      if (period) chip('date',period[1],'calendar',() => this.go(setSearchOption(this.url,'t','all')));
      this.chips.hidden = !this.chips.childElementCount;
    }

    updateLinks() {
      // Carry local types across native feed sort/view/flair changes, and
      // carry sort/date across native search result tabs.
      const used = new Set();
      const types = this.selectedTypes().join(',');
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
          if (types && url.searchParams.get('type') === 'media') url.searchParams.set('rt_type',types);
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
      if (!isPhone()) { this.openFeedMenu(); return; }
      const button = this.options;
      button.setAttribute('aria-expanded','true');
      this.panel = sheet.open({
        title:'Feed options', returnFocus:button,
        onClose: () => {
          this.panel = null;
          button.setAttribute('aria-expanded','false');
        },
        build: (_body, ui) => this.buildPhoneFeed(ui),
      });
      this.panel.root.classList.add('rt-community-sheet');
    }

    openPanel(button, root, {phone = false, back = () => false} = {}) {
      this.panel?.close();
      const scrim = phone ? make('div','rt-inline-sheet-scrim') : null;
      const overflow = document.documentElement.style;
      const oldOverflow = overflow.getPropertyValue('overflow');
      const oldPriority = overflow.getPropertyPriority('overflow');
      const close = (focus = true) => {
        if (this.panel?.root !== root) return;
        this.panel = null;
        button.setAttribute('aria-expanded','false');
        document.removeEventListener('pointerdown',outside,true);
        document.removeEventListener('keydown',keys,true);
        window.removeEventListener('resize',resize);
        window.removeEventListener('scroll',place);
        if (phone) {
          if (oldOverflow) overflow.setProperty('overflow',oldOverflow,oldPriority);
          else overflow.removeProperty('overflow');
        }
        root.remove();
        scrim?.remove();
        if (focus && button.isConnected) button.focus({preventScroll:true});
      };
      const outside = event => {
        const path = event.composedPath();
        if (!path.includes(root) && !path.includes(button)) close(false);
      };
      const keys = event => {
        if (event.key === 'Escape' && (root.contains(document.activeElement) || document.activeElement === button)) {
          event.preventDefault();
          event.stopPropagation();
          if (!back()) close();
          return;
        }
        if (!['ArrowDown','ArrowUp'].includes(event.key) || !root.contains(document.activeElement) ||
            document.activeElement.matches('input,textarea')) return;
        const rows = [...root.querySelectorAll('[role^="menuitem"]:not([hidden]),[data-rt-sub-back]')];
        if (!rows.length) return;
        const step = event.key === 'ArrowDown' ? 1 : -1;
        const index = rows.indexOf(document.activeElement);
        event.preventDefault();
        rows[(index + step + rows.length) % rows.length]?.focus({preventScroll:true});
      };
      const place = () => {
        if (phone || !button.isConnected) return;
        const box = button.getBoundingClientRect();
        const width = root.getBoundingClientRect().width;
        const vw = document.documentElement.clientWidth || innerWidth;
        const vh = document.documentElement.clientHeight || innerHeight;
        const below = vh - box.bottom - 16;
        const above = box.top - 16;
        const flip = below < 200 && above > below;
        const x = getComputedStyle(button).direction === 'rtl' ? box.right - width : box.left;
        root.style.left = Math.max(8,Math.min(x,vw - width - 8)) + 'px';
        root.style.maxHeight = Math.max(90,flip ? above : below) + 'px';
        root.style.top = flip ? 'auto' : box.bottom + 8 + 'px';
        root.style.bottom = flip ? vh - box.top + 8 + 'px' : 'auto';
      };
      const resize = () => isPhone() === phone ? place() : close();
      this.panel = {root,close};
      button.setAttribute('aria-expanded','true');
      if (scrim) {
        scrim.dataset.rtUi = 'community-filter-scrim';
        scrim.setAttribute('aria-hidden','true');
        document.body.append(scrim);
        overflow.setProperty('overflow','hidden');
      }
      document.body.append(root);
      place();
      document.addEventListener('pointerdown',outside,true);
      document.addEventListener('keydown',keys,true);
      window.addEventListener('resize',resize);
      window.addEventListener('scroll',place,{passive:true});
      return {close,place};
    }

    openFeedMenu() {
      const root = make('div','rt-inline-menu rt-community-feed-menu');
      root.dataset.rtUi = 'community-filter-menu';
      root.dataset.rtFeedOptions = '';
      root.setAttribute('role','menu');
      root.setAttribute('aria-label','Feed options');
      const ctx = filters.plainContext(name => filters.svgIcon(name,16),{role:'menuitem'});
      const choices = filters.plainContext(name => filters.svgIcon(name,16));
      let section = '';
      let menu;
      const back = () => {
        if (!section) return false;
        const previous = section;
        render(previous === 'Time range' ? 'Sort' : '');
        root.querySelector('[aria-label="' + previous + '"]')?.focus({preventScroll:true});
        return true;
      };
      const render = (view = '') => {
        section = view;
        root.replaceChildren();
        root.toggleAttribute('data-rt-drill',Boolean(view));
        const entry = (list,label,icon,value) => {
          const row = ctx.row(label,icon);
          row.setAttribute('aria-haspopup','menu');
          const trailing = make('span','rt-menu-value text-12 text-neutral-content-weak',value);
          trailing.dataset.rtMenuValue = '';
          row.firstElementChild.append(trailing,filters.svgIcon('chevron-right',16));
          ctx.activate(row,() => render(label));
          list.append(row);
        };
        if (view === 'Sort' || view === 'Time range') {
          const header = filters.submenuHeader(view,back);
          const list = make('div','rt-community-menu-body');
          root.append(header.head,list);
          const {sorting,range} = this.feedSorts || {};
          const radios = filters.plainContext(name => filters.svgIcon(name,16),{role:'menuitemradio'});
          for (const choice of (view === 'Sort' ? sorting : range)?.choices || []) {
            list.append(filters.menuOption(radios,{
              label:choice.label,icon:sortGlyph(choice,16),checked:choice.selected,slot:true,
              onSelect:() => { this.chooseFeedSort(choice); menu.close(); },
            }));
          }
          if (view === 'Sort' && range) entry(list,'Time range','calendar',range.current || 'All time');
          menu?.place();
          header.back.focus({preventScroll:true});
          return;
        }
        if (view === 'Post type') {
          const header = filters.submenuHeader(view,back);
          const list = make('div','rt-community-menu-body');
          root.append(header.head,list);
          const types = filters.typeOptions(choices,{
            append:el => list.append(el),iconSize:16,outline:true,allIcon:'show',
            onToggle:type => { this.toggleType(type); types.sync(this.selectedTypes()); },
            onClear:() => { this.applyTypes([]); types.sync(this.selectedTypes()); },
          });
          types.sync(this.selectedTypes());
          menu?.place();
          header.back.focus({preventScroll:true});
          return;
        }
        if (view === 'Flair') {
          const panel = this.flairPanel({
            active:this.activeFlair(), onBack:back,
            onChoose:label => { this.go(withFlair(this.url,label)); menu.close(); },
          });
          root.append(panel.panel);
          menu?.place();
          panel.search.focus({preventScroll:true});
          return;
        }
        const list = make('div','rt-community-menu-body');
        root.append(list);
        root.prepend(filters.sectionLabel('Feed options'));
        const sorting = this.feedSorts?.sorting;
        if (sorting) entry(list,'Sort','sort',sorting.current);
        entry(list,'Post type','text-post',this.typeLabel() || 'All');
        entry(list,'Flair','filter',this.activeFlair() || 'All');
        menu?.place();
      };
      render();
      menu = this.openPanel(this.options,root,{back});
      root.querySelector('[role="menuitem"]')?.focus({preventScroll:true});
    }

    openSearchMenu(button, key, title) {
      if (this.panel?.root.dataset.rtSearchMenu === key) { this.panel.close(); return; }
      const phone = isPhone();
      const root = make('div','rt-inline-menu rt-community-search-menu' + (phone ? ' rt-inline-sheet' : '') +
        (key === 'flair' ? ' rt-community-flair-menu' : ''));
      root.dataset.rtUi = 'community-filter-menu';
      root.dataset.rtSearchMenu = key;
      root.setAttribute('role',phone ? 'dialog' : 'menu');
      root.setAttribute('aria-label',title);
      let closeButton;
      if (phone) {
        root.setAttribute('aria-modal','true');
        closeButton = make('button','rt-inline-sheet-close');
        closeButton.type = 'button';
        closeButton.setAttribute('aria-label','Close');
        closeButton.append(filters.svgIcon('close',16));
        const header = make('div','rt-inline-sheet-head');
        const heading = make('span');
        heading.append(make('span','',title));
        header.append(heading);
        root.append(closeButton,header);
      }
      let flair;
      let list;
      if (key === 'flair') {
        flair = this.flairPanel({
          active:this.activeFlair(),
          onChoose:label => { this.go(withFlair(this.url,label)); this.panel?.close(); },
        });
        root.append(flair.panel);
      } else {
        list = make('ul','rt-inline-menu-list');
        list.setAttribute('role','menu');
        list.setAttribute('aria-label',title);
        root.append(list);
      }
      const row = ({label,selected,onSelect,check = false,value,icon = ''}) => {
        const item = make('li','relative list-none mt-0');
        item.setAttribute('role','presentation');
        const choice = make('div','rt-inline-menu-item');
        choice.tabIndex = -1;
        choice.setAttribute('role',check ? 'menuitemcheckbox' : 'menuitemradio');
        choice.setAttribute('aria-label',label);
        choice.setAttribute('aria-checked',String(Boolean(selected)));
        const mark = make('span','rt-inline-mark');
        mark.append(check ? make('span','rt-inline-check') : filters.svgIcon(selected ? 'radio-button-fill' : 'radio-button',phone ? 20 : 16));
        const lead = make('span','rt-community-search-lead');
        lead.append(mark);
        if (icon) lead.append(filters.svgIcon(icon,16));
        lead.append(make('span','rt-inline-menu-label',label));
        choice.append(lead);
        const choose = event => {
          event.preventDefault();
          event.stopPropagation();
          onSelect();
          if (!check) { this.panel?.close(); button.focus({preventScroll:true}); }
          else {
            renderMedia();
            list.querySelector('[data-rt-media-type="' + value + '"]')?.focus({preventScroll:true});
          }
        };
        choice.addEventListener('click',choose);
        choice.addEventListener('keydown',event => {
          if (event.key === 'Enter' || event.key === ' ') choose(event);
        });
        if (check) choice.dataset.rtMediaType = value;
        item.append(choice);
        list.append(item);
      };
      const renderMedia = () => {
        if (!list) return;
        list.replaceChildren();
        const types = this.selectedTypes();
        row({label:'All media',value:'all',icon:'show',selected:!types.length,check:true,onSelect:() => this.applyTypes([])});
        for (const [value,label] of mediaTypes) {
          row({label,value,icon:value === 'gif' ? 'gif-post-outline' : filters.typeIcons[value],selected:types.includes(value),check:true,onSelect:() => this.toggleType(value)});
        }
      };
      if (key === 'media') renderMedia();
      else if (key !== 'flair') {
        const sort = key === 'sort';
        const param = sort ? 'sort' : 't';
        const selected = this.url.searchParams.get(param) || (sort ? 'relevance' : 'all');
        for (const [value,label] of sort ? searchSorts : searchDates) {
          row({label,selected:selected === value,onSelect:() => this.go(setSearchOption(this.url,param,value))});
        }
        if (!sort && this.isMedia()) root.append(filters.sectionLabel('Media dates are handled by Reddit.'));
      }
      const menu = this.openPanel(button,root,{phone});
      closeButton?.addEventListener('click',() => menu.close());
      (list?.querySelector('[aria-checked="true"]') || list?.querySelector('.rt-inline-menu-item') ||
        flair?.search || closeButton)?.focus({preventScroll:true});
    }

    // Phones: a short first page (Sort, Post type, Flair, each with its current value) and a page for each, as in
    // Reddit's app; Top opens its time ranges one level further. Every choice runs through the desktop menu's handlers.
    buildPhoneFeed(ui) {
      const {sorting,range} = this.feedSorts || {};
      const top = sorting?.choices.find(choice => choice.key === 'top');
      const ranges = () => ({title:'Time range',build:(_body,page) => {
        for (const choice of range.choices) page.row({
          label:choice.label,selected:choice.selected,onSelect:() => this.chooseFeedSort(choice),
        });
      }});
      const sorts = () => ({title:'Sort by',build:(_body,page) => {
        for (const choice of sorting.choices) {
          const timed = choice === top && choice.selected && range;
          page.row({
            label:choice.label,icon:sortGlyph(choice,20),selected:choice.selected && !timed,
            subtitle:timed ? range.current : '',chevron:Boolean(timed),keepOpen:Boolean(timed),
            onSelect:() => { if (!timed) return this.chooseFeedSort(choice); page.push(ranges()); return {stay:true}; },
          });
        }
      }});
      if (sorting) {
        const current = sorting.choices.find(choice => choice.selected);
        ui.row({
          label:'Sort by',icon:current ? sortGlyph(current,20) : filters.svgIcon('sort',20),
          subtitle:[sorting.current,current === top && range?.current].filter(Boolean).join(' · '),
          chevron:true,keepOpen:true,onSelect:() => { ui.push(sorts()); return {stay:true}; },
        });
      }
      ui.row({
        label:'Post type',icon:(() => { const [one,...more] = this.selectedTypes(); return filters.svgIcon(one && !more.length ? (one === 'gif' ? 'gif-post-outline' : filters.typeIcons[one]) : 'text-post',20); })(),
        subtitle:this.typeLabel() || 'All types',
        chevron:true,keepOpen:true,onSelect:() => { ui.push({title:'Post type',build:(_body,page) => {
          sheet.postTypeRows(page,{selected:this.selectedTypes(),onClear:() => this.applyTypes([]),onToggle:type => this.toggleType(type)});
        }}); return {stay:true}; },
      });
      const active = this.activeFlair();
      ui.row({label:'Flair', icon:filters.svgIcon('filter',20), subtitle:active || 'All flairs', chevron:true, keepOpen:true, onSelect:() => {
        ui.push({title:'Flair',build:(body, page) => {
          const panel = this.flairPanel({
            active:this.activeFlair(),
            onChoose:label => { this.go(withFlair(this.url,label)); page.close(); },
          });
          body.append(panel.panel);
          return {stay:true};
        }});
        return {stay:true};
      }});
    }

    // The Flair picker follows the Community picker: a back header, a search field, and a
    // scrolling list capped to the menu height. Typing an unseen name offers to apply it.
    flairPanel({active, onBack = null, onChoose}) {
      const panel = make('div','rt-sub-panel');
      panel.dataset.rtUi = 'flair-panel';
      if (onBack) panel.append(filters.submenuHeader('Flair',onBack).head);
      const head = make('div','rt-sub-head');
      const field = make('div','rt-filter-field');
      const search = make('input','rt-filter-search');
      search.type = 'search';
      search.placeholder = 'Search flairs';
      search.setAttribute('aria-label','Search flairs');
      search.autocomplete = 'off';
      const clear = make('button','rt-filter-search-clear');
      clear.type = 'button';
      clear.setAttribute('aria-label','Clear flair search');
      clear.hidden = true;
      clear.append(filters.svgIcon('close',14));
      field.append(filters.svgIcon('search',16),search,clear);
      head.append(field);
      const list = make('div','rt-sub-list');
      list.dataset.rtSubList = 'true';
      list.setAttribute('role','group');
      list.setAttribute('aria-label','Flairs');
      panel.append(head,list);
      const ctx = filters.plainContext(name => filters.svgIcon(name,16),{role:'menuitemradio'});
      const labels = new Set(this.flairs.get(fold(this.scope.name)) || []);
      if (active) labels.add(active);
      const choices = [...labels].sort((a,b) => a.localeCompare(b));
      const render = () => {
        const term = search.value.trim();
        const wanted = fold(term);
        clear.hidden = !term;
        list.replaceChildren();
        const add = (label,selected,icon,value,onSelect) => {
          const row = filters.menuOption(ctx,{label,icon,checked:selected,value,slot:true,onSelect});
          row.dataset.rtUi = 'filter-option';
          row.dataset.rtFlairRow = label;
          list.append(row);
          return row;
        };
        add('All flairs',!active,'show','all',() => onChoose(''));
        for (const label of choices) {
          if (wanted && !fold(label).includes(wanted)) continue;
          add(label,label === active,'filter',label,() => onChoose(label));
        }
        if (term && !choices.some(label => fold(label) === wanted)) {
          add('Use “' + term + '”',false,'search','custom',() => onChoose(term));
        }
        if (!list.querySelector('[data-rt-flair-row]:not([data-rt-option="all"])') && !term) {
          list.append(make('div','rt-sub-empty text-12 text-neutral-content-weak','No flairs seen yet. Search for the exact flair name to apply it.'));
        }
      };
      search.addEventListener('input',render);
      search.addEventListener('keydown',event => {
        if (event.key !== 'Escape') event.stopPropagation();
      });
      clear.addEventListener('click',event => {
        event.preventDefault();
        event.stopPropagation();
        search.value = '';
        render();
        search.focus({preventScroll:true});
      });
      render();
      return {panel,list,search,render};
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
      this.finishReturn();
      this.releaseDeparture();
      this.clear();
      document.documentElement?.removeAttribute(sortBoot);
      this.observer.disconnect();
      window.removeEventListener('popstate',this.onHistory);
      window.navigation?.removeEventListener('navigate',this.onNavigate);
      window.navigation?.removeEventListener('currententrychange',this.onEntry);
      for (const type of returnInputs) window.removeEventListener(type,this.onReturnInput,true);
      document.removeEventListener('reddit:route',this.onRoute);
      document.removeEventListener('click',this.onPostClick,true);
      document.removeEventListener('keydown',this.onKeys,true);
      document.removeEventListener('focusin',this.onFocus,true);
      window.removeEventListener('scroll',this.onScroll);
    }
  }

  globalThis.RTLiveSubredditFilters = Object.freeze({Controller,route,searchUrl,withFlair});
  if (globalThis.chrome?.runtime?.id) {
    const controller = new Controller({enabled:false,waitingForSettings:true});
    globalThis.RTLiveSubredditFiltersDebug = controller;
    const update = settings => controller.setEnabled(settings?.postDiscovery !== false);
    let receivedChange = false;
    const failed = () => { if (!receivedChange) controller.setEnabled(false); };
    try {
      Promise.resolve(globalThis.RTProfileNoticeGuard?.settings || chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'})).then(result => {
        if (receivedChange) return;
        if (result?.ok) update(result.settings);
        else failed();
      },failed);
    } catch { failed(); }
    chrome.runtime.onMessage.addListener(message => {
      if (message?.scope === 'rt-posts' && message.action === 'settings-changed') {
        receivedChange = true;
        update(message.settings);
      }
    });
  }
})();
