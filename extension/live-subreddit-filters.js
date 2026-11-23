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
  // Reddit only renders these native links once Top is active. Use its measured
  // feed periods with the native Top destination before the first navigation.
  const topPeriods = [['hour','Now'],['day','Today'],['week','This Week'],['month','This Month'],['year','This Year'],['all','All Time']];
  const mediaTypes = new Map([['image','Photos'],['video','Videos'],['gif','GIFs'],['gallery','Galleries']]);
  const mediaUnits = 'search-media-feed search-telemetry-tracker[view-events="search/view/post"]';
  const videoHosts = /(^|\.)(youtube\.com|youtu\.be|vimeo\.com|streamable\.com|twitch\.tv|dailymotion\.com|dai\.ly|gfycat\.com|redgifs\.com|tiktok\.com|rumble\.com)$/i;
  const isPhone = () => Boolean(globalThis.matchMedia?.('(max-width: 767.98px)')?.matches);
  const nativeFeedSort = 'shreddit-sort-dropdown:not([hidden]),shreddit-layout-switcher:not([hidden])';
  const sortReplaced = 'data-rt-community-sort-replaced';
  const sortBoot = 'data-rt-community-sort-boot';
  const sortNative = 'data-rt-community-sort-native';
  const nsfwParam = 'rt_nsfw',nsfwGlyph = 'nsfw-fill-12';
  const menuLabel = 'Sort & filter';
  const subParam = 'rt_sub', hideParam = 'rt_hide';
  const nativeView = 'shreddit-sort-dropdown[sort-event="layout-view-change"]';
  const viewLabels = {cardView:'Card',compactView:'Compact'};
  // Signed out, Reddit serves its popular feed at / (reload-url /svc/shreddit/feeds/popular-feed).
  const signedOut = () => Boolean(document.querySelector('#login-button,#open-app-header-cta'));
  const shown = node => node?.isConnected && (typeof node.checkVisibility !== 'function' || node.checkVisibility());
  const subList = value => [...new Set(String(value || '').split(',').map(name => name.trim().replace(/^r\//i,'')).filter(name => /^[a-z0-9_]{2,21}$/i.test(name)))].slice(0,20);
  const parkAfter = 40;
  const revealNow = 12, revealPerFrame = 8;
  const nextFrame = fn => globalThis.requestAnimationFrame ? requestAnimationFrame(fn) : setTimeout(fn,16);
  const cancelFrame = id => globalThis.cancelAnimationFrame ? cancelAnimationFrame(id) : clearTimeout(id);
  const nsfwCard = card => ['nsfw','is-nsfw','over-18'].some(name => card.hasAttribute(name) && !/^(?:false|0)$/i.test(card.getAttribute(name))) ||
    Boolean(card.querySelector('[slot="ssr-post-content-header"] [icon-name="nsfw-fill-12"]'));
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

  const globalSorts = ['best','hot','new','top','rising','controversial'];
  const archiveRootAttrs = ['data-rt-subreddit-archive','data-rt-subreddit-archive-search'];
  const archiveSelectors = '[data-rt-ui="archive-subreddit"],[data-rt-ui="archive-search"]';
  const isArchiveActive = () => Boolean(
    archiveRootAttrs.some(attr => document.documentElement?.hasAttribute(attr)) ||
    document.querySelector(archiveSelectors)
  );
  const isArchiveNode = node => node?.nodeType === 1 && (
    node.matches(archiveSelectors) || Boolean(node.querySelector?.(archiveSelectors))
  );

  function route(url = location) {
    const home = /^\/(?:(best|hot|new|top|rising|controversial)\/?)?$/i.exec(url.pathname);
    if (home) return {surface:'home',global:true,name:'home',sort:fold(home[1]),kind:'feed'};
    const multi = /^\/user\/([a-z0-9_-]{1,20})\/m\/([a-z0-9_-]{1,50})(?:\/(hot|new|top|rising|search))?\/?$/i.exec(url.pathname);
    if(multi)return {surface:'custom',owner:multi[1],name:multi[2],sort:fold(multi[3]),kind:fold(multi[3])==='search'?'search':'feed'};
    const match = /^\/r\/([a-z0-9_]{2,21})(?:\/(best|hot|new|top|rising|controversial|search))?\/?$/i.exec(url.pathname);
    if (!match) return null;
    const sub = fold(match[1]), subSort = fold(match[2]);
    if (sub === 'all' || sub === 'popular') {
      if (subSort === 'search') return null;
      return {surface:sub,global:true,name:sub,sort:subSort,kind:'feed'};
    }
    return {surface:'subreddit',name:match[1],sort:subSort,kind:subSort==='search'?'search':'feed'};
  }
  const scopePath = scope => scope.owner ? '/user/'+scope.owner+'/m/'+scope.name+'/' : scope.surface === 'home' ? '/' : '/r/'+scope.name+'/';
  const scopeKey = scope => !scope ? '' : scope.owner ? fold(scopePath(scope)) : scope.global ? ':'+scope.surface : fold(scope.name);

  function inspectReloadUrl(reloadUrl, scope) {
    if (!reloadUrl) return 'unknown';
    let parsed;
    try { parsed = new URL(reloadUrl, location.href); } catch { return 'unknown'; }
    const path = fold(parsed.pathname), params = parsed.searchParams;
    const curator = params.get('curator'), multi = params.get('feedName'), name = params.get('name');
    const feedParam = fold(params.get('feed'));
    if (/\/profiles?\//.test(path)) return 'mismatch';
    const globalPath = /\/(?:feeds\/)?(home|popular|all)(?:[-_](?:feed|more-posts))?(?:\/|$)/.exec(path)?.[1] || '';
    const globalKind = globalPath || (['home','popular','all'].includes(feedParam) ? feedParam : '');
    const isCustom = Boolean(curator || multi || /\/custom-feed\b/.test(path));
    const isCommunity = Boolean(/\/community-more-posts\b|\/community-feed\b/.test(path));
    if (scope.owner) {
      if (name || globalKind || isCommunity) return 'mismatch';
      if (curator && fold(curator) !== fold(scope.owner)) return 'mismatch';
      if (multi && fold(multi) !== fold(scope.name)) return 'mismatch';
      return (curator && multi) || isCustom ? 'match' : 'unknown';
    }
    if (scope.global) {
      if (isCustom) return 'mismatch';
      if (name) return fold(name) === fold(scope.name) ? 'match' : 'mismatch';
      if (isCommunity) return 'mismatch';
      if (globalKind) return globalKind === scope.surface || scope.surface === 'home' && globalKind === 'popular' && signedOut() ? 'match' : 'mismatch';
      return 'unknown';
    }
    if (isCustom || globalKind) return 'mismatch';
    if (name) return fold(name) === fold(scope.name) ? 'match' : 'mismatch';
    return 'unknown';
  }

  function inspectFeedMeta(feed, scope) {
    const feedName = fold(feed.getAttribute('feed-name') || feed.getAttribute('page-type'));
    if (!feedName) return 'unknown';
    if (/^profile/.test(feedName)) return 'mismatch';
    if (['home','popular','all'].includes(feedName)) return scope.surface === feedName || scope.surface === 'home' && feedName === 'popular' && signedOut() ? 'match' : 'mismatch';
    if (['custom_feed','custom-feed','multireddit'].includes(feedName)) return scope.owner ? 'match' : 'mismatch';
    if (['subreddit','community'].includes(feedName)) return scope.surface === 'subreddit' ? 'match' : 'mismatch';
    return 'unknown';
  }

  function inspectSortBar(main, scope, url, links) {
    const dropDown = main.querySelector('shreddit-sort-dropdown[sort-event="feed-sort-change"]:not([hidden])');
    if (!dropDown) return 'unknown';
    let matched = 0, foreign = 0;
    for (const link of dropDown.querySelectorAll('a[href],rpl-menu-item[href]')) {
      const hrefNow = link.getAttribute('href');
      const patched = links?.get(link);
      const href = patched?.applied === hrefNow ? patched.original : hrefNow;
      let parsed;
      try { parsed = new URL(href, url); } catch { continue; }
      if (parsed.origin !== url.origin) continue;
      const target = route(parsed);
      if (!target) {
        if (/^\/user\/[^/]+\/?$/i.test(parsed.pathname)) foreign++;
        continue;
      }
      if (target.kind === 'feed' && scopeKey(target) === scopeKey(scope)) matched++;
      else foreign++;
    }
    if (matched) return 'match';
    if (foreign) return 'mismatch';
    return 'unknown';
  }

  function flairName(value) {
    const label = String(value || '').trim();
    return label.length <= 100 && !/[\u0000-\u001f]/.test(label) ? label : '';
  }

  const flairTones=['text-global-white','text-global-black','text-secondary'];
  const flairImages=new Set(['emoji.redditmedia.com','styles.redditmedia.com','i.redd.it','preview.redd.it']);
  function flairImage(value) {
    try {
      const url=new URL(value,location.href);
      if(url.protocol==='https:' && flairImages.has(url.hostname) && !url.username && !url.password)return url.href;
    } catch {}
    return '';
  }

  function flairPaint(content) {
    if(!content)return null;
    const pill=content.matches('.flair-content')?content.parentElement:content;
    const parts=[];
    const read=node=>{
      if(parts.length>=16)return;
      if(node.nodeType===Node.TEXT_NODE && node.textContent)parts.push(node.textContent.slice(0,100));
      else if(node.nodeName==='IMG'){
        const image=flairImage(node.getAttribute('src'));
        if(image)parts.push({image,alt:(node.getAttribute('alt') || '').slice(0,100)});
      } else if(node.nodeType===Node.ELEMENT_NODE && !node.matches('script,style,template'))for(const child of node.childNodes)read(child);
    };
    read(content);
    const {backgroundColor:background,color}=pill.style;
    const tone=flairTones.find(name=>pill.classList.contains(name)) || '';
    const border=pill.classList.contains('border-neutral-border-weak');
    return background || color || tone || border || parts.some(part=>typeof part==='object')?{background,color,tone,border,parts}:null;
  }

  function flairPill(label,paint) {
    const pill=make('span','rt-community-flair-pill bg-tone-4 inline-block max-w-full text-12 font-normal box-border px-[6px] rounded-5 leading-4');
    pill.setAttribute('aria-hidden','true');
    pill.title=label;
    pill.classList.add(flairTones.includes(paint.tone)?paint.tone:'text-secondary');
    if(paint.border)pill.classList.add('border-solid','border-sm','border-neutral-border-weak');
    pill.style.backgroundColor=paint.background || '';
    pill.style.color=paint.color || '';
    const content=make('span','flair-content');
    content.dir='auto';
    for(const part of Array.isArray(paint.parts)?paint.parts.slice(0,16):[]){
      if(typeof part==='string'){content.append(part.slice(0,100));continue;}
      const src=flairImage(part?.image);if(!src)continue;
      const image=make('img','flair-image');image.src=src;image.alt=String(part.alt || '').slice(0,100);content.append(image);
    }
    if(!content.textContent.trim() && !content.childElementCount)content.textContent=label;
    pill.append(content);
    return pill;
  }

  function feedFlair(url) {
    const text = url.searchParams.get('f') || '';
    const quoted = /^flair_name:("(?:[^"\\]|\\.)*")$/i.exec(text);
    if (!quoted) return '';
    try { return flairName(JSON.parse(quoted[1])); } catch { return ''; }
  }

  function cardFlair(node) {
    const link=node.querySelector('a[href*="flair_name"]');
    const label=link && feedFlair(new URL(link.href));
    return label || flairName((node.querySelector('.flair-content') || node).textContent);
  }

  function searchParts(url) {
    let query = (url.searchParams.get('q') || '').trim(),flair='';
    const match = /(?:^|\s)flair:("(?:[^"\\]|\\.)*")$/i.exec(query);
    if (match) {
      try {
        flair = flairName(JSON.parse(match[1]));
        if (flair) query = query.slice(0, match.index).trim();
      } catch {}
    }
    const nsfw = /(?:^|\s)nsfw:yes$/i.exec(query);
    return {query:nsfw ? query.slice(0,nsfw.index).trim() : query,flair,nsfw:Boolean(nsfw)};
  }

  function setSearchParts(url,scope,{query,flair,nsfw}) {
    url.searchParams.set('q',[query || (scope.owner?'':'subreddit:'+scope.name),nsfw ? 'nsfw:yes' : '',flair ? 'flair:' + JSON.stringify(flair) : ''].filter(Boolean).join(' '));
  }

  function withNsfw(url, enabled) {
    const next=new URL(url),scope=route(next);
    if(scope?.global)return next;
    if(scope?.kind==='feed') {
      if(enabled)next.searchParams.set(nsfwParam,'1');
      else next.searchParams.delete(nsfwParam);
    } else if(scope) setSearchParts(next,scope,{...searchParts(next),nsfw:enabled});
    return next;
  }

  function withFlair(url, label) {
    const next = new URL(url);
    const value = flairName(label);
    const scope = route(next);
    if (!scope || scope.global) return next;
    if (scope.kind === 'feed') {
      if (value) next.searchParams.set('f', 'flair_name:' + JSON.stringify(value));
      else next.searchParams.delete('f');
    } else {
      setSearchParts(next,scope,{...searchParts(next),flair:value});
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
    const source=route(url);
    if (source?.kind === 'search') return url;
    const result = new URL((source?.owner?scopePath(source):'/r/'+subreddit+'/')+'search/',url);
    result.searchParams.set('q',source?.owner?'':'subreddit:'+subreddit);
    result.searchParams.set('type', 'posts');
    result.searchParams.set('sort', 'new');
    const flair = feedFlair(url);
    const scoped = flair ? withFlair(result,flair) : result;
    return url.searchParams.get(nsfwParam)==='1'?withNsfw(scoped,true):scoped;
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
      const pathMatches=fold(value?.path).replace(/\/$/,'')===fold(scopePath(scope)).replace(/\/$/,'');
      if(pathMatches && (scope.owner?value?.type==='custom_feed':value?.type==='community' && fold(value.name)===fold(scope.name)))return input;
    } catch {}
    return null;
  }

  function loadFlairs() {
    try {
      const values = JSON.parse(sessionStorage.getItem(flairKey) || '[]');
      return new Map(values.filter(entry => Array.isArray(entry) && Array.isArray(entry[1])).slice(-8).map(([name,entries])=>
        [name,new Map(entries.slice(0,40).map(entry=>Array.isArray(entry)?entry:[entry,null]).filter(([label])=>typeof label==='string' && flairName(label)))]));
    } catch { return new Map(); }
  }

  class Controller {
    constructor({navigate: go = navigate, enabled = true, waitingForSettings = false} = {}) {
      this.navigate = go;
      this.enabled = enabled;
      this.waitingForSettings = waitingForSettings;
      this.hidden = new Set();
      const WeakElementMap = globalThis.RTPostModel?.WeakElementMap;
      this.parked = WeakElementMap ? new WeakElementMap() : new Map();
      // The parking threshold follows the filter lifecycle, independent of GC.
      this.parkedCount = 0;
      this.parkedMoves = new WeakMap();
      this.feedOwners = new WeakMap();
      this.flairs = loadFlairs();
      this.links = new Map();
      this.positions = new Map();
      this.onRoute = () => {
        this.panel?.close();
        const next = route();
        if (this.scope && (!next || this.scope.kind !== next.kind || this.scope.surface !== next.surface || scopeKey(this.scope) !== scopeKey(next))) {
          if (!this.holdDeparture(new URL(location.href)) && !this.holdOutgoing()) this.clear();
        }
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
          this.toolbar?.remove();this.chips?.remove();
          this.note?.remove();
          return;
        }
        let relevant = false, urgent = false;
        for (const record of records) {
          if (this.isParkingMutation(record) || globalThis.RTPostMenuDOM?.isMenuMutation(record) || record.target.closest?.('[data-rt-ui]')) continue;
          const nodes = [...record.addedNodes, ...record.removedNodes].filter(node =>
            node.nodeType === 1 && (!node.matches('[data-rt-ui]') || isArchiveNode(node)));
          if (!nodes.length) continue;
          relevant = true;
          // Inside a card that stays (its player, menus, hover content), unless a card itself comes or goes.
          const inCard = record.target.closest?.('shreddit-post,shreddit-ad-post') &&
            !nodes.some(node => node.matches('shreddit-post,shreddit-ad-post,article') || node.querySelector('shreddit-post,shreddit-ad-post'));
          if (!inCard) { urgent = true; break; }
        }
        if (relevant) this.schedule(urgent);
      });
      this.observer.observe(document, {childList:true, subtree:true});
      this.rootObserver = new MutationObserver(() => this.schedule());
      if (document.documentElement) this.rootObserver.observe(document.documentElement, {attributes:true, attributeFilter:archiveRootAttrs});
      window.addEventListener('popstate', this.onHistory);
      window.navigation?.addEventListener('navigate',this.onNavigate);
      window.navigation?.addEventListener('currententrychange',this.onEntry);
      for (const type of returnInputs) window.addEventListener(type,this.onReturnInput,{capture:true,passive:true});
      document.addEventListener('reddit:route', this.onRoute);
      document.addEventListener('click',this.onPostClick,true);
      document.addEventListener('keydown', this.onKeys, true);
      document.addEventListener('focusin', this.onFocus, true);
      window.addEventListener('scroll', this.onScroll, {passive:true});
      this.phoneLayout=globalThis.matchMedia?.('(max-width: 767.98px)');
      this.phoneLayout?.addEventListener?.('change',this.onRoute);
      this.refresh();
    }

    schedule(urgent = true) {
      if (this.dead) return;
      // A frame-deferred pass is promoted when something urgent arrives meanwhile.
      if (this.queued && !(urgent && this.queuedFrame)) return;
      this.queued = true;
      const run = () => {
        this.queued = false;
        if (!this.dead) this.refresh();
      };
      // Feed and route changes run in this microtask, before the frame (docs/feed-controls-ux-plan.md, F1-F3). Churn
      // inside cards that are already there (players, hover cards) waits for the next frame: it changes nothing a pass
      // decides, and each pass reads every card in the feed. A hidden tab runs no frames.
      if (!urgent && globalThis.requestAnimationFrame && document.visibilityState !== 'hidden') {
        this.queuedFrame = true;
        requestAnimationFrame(() => { if (this.queuedFrame) { this.queuedFrame = false; run(); } });
      } else { this.queuedFrame = false; queueMicrotask(run); }
    }

    clearHidden() {
      this.restoreParked();
      for (const node of this.hidden) node.removeAttribute(hidden);
      this.hidden.clear();
      this.flushReveal();
    }

    // Removing a filter after a long scroll used to unhide every card in one pass, and the next layout (the rail's
    // own measurement, then the frame) laid out hundreds of cards with media at once: 0.5-3 s before the click painted
    // (measured live, 2026-11-23). Cards next to the viewport come back at once; the rest follow nearest first, a few
    // per frame.
    reveal(nodes, anchor = null) {
      const queue = (this.revealQueue || []).filter(node => !this.hidden.has(node));
      queue.push(...nodes);
      this.revealQueue = null;
      if (this.revealFrame) cancelFrame(this.revealFrame);
      this.revealFrame = 0;
      if (queue.length <= revealNow) { for (const node of queue) node.removeAttribute(hidden); return; }
      anchor ||= this.revealAnchor();
      const below = [], above = [];
      for (const node of queue) {
        // Detached (a batch Reddit keeps for later) costs no layout.
        if (!node.isConnected) { node.removeAttribute(hidden); continue; }
        if (anchor && anchor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING) above.push(node);
        else below.push(node);
      }
      // Document order: the nearest cards above the viewport are the last ones before it.
      above.reverse();
      const ordered = [];
      for (let i = 0; i < Math.max(above.length,below.length); i++) {
        if (i < below.length) ordered.push(below[i]);
        if (i < above.length && i % 2 === 0) ordered.push(above[i]);
      }
      for (const node of above.filter((node,i) => i % 2 === 1)) ordered.push(node);
      for (const node of ordered.splice(0,revealNow)) node.removeAttribute(hidden);
      this.revealQueue = ordered;
      const step = () => {
        this.revealFrame = 0;
        const list = this.revealQueue;
        if (!list?.length || this.dead) { this.revealQueue = null; return; }
        for (const node of list.splice(0,revealPerFrame)) if (!this.hidden.has(node)) node.removeAttribute(hidden);
        if (list.length) this.revealFrame = nextFrame(step);
        else this.revealQueue = null;
      };
      this.revealFrame = nextFrame(step);
    }

    flushReveal() {
      if (this.revealFrame) cancelFrame(this.revealFrame);
      this.revealFrame = 0;
      for (const node of this.revealQueue || []) if (!this.hidden.has(node)) node.removeAttribute(hidden);
      this.revealQueue = null;
    }

    // The first feed card still on screen; cards before it in the document are above the viewport.
    revealAnchor() {
      const top = Math.max(0,document.querySelector('reddit-header-large,reddit-header-small')?.getBoundingClientRect().bottom || 0);
      for (const card of this.feed?.querySelectorAll('shreddit-post') || []) {
        const unit = card.closest('article') || card;
        if (unit.hasAttribute(hidden)) continue;
        const box = unit.getBoundingClientRect();
        if (box.height && box.bottom > top) return unit;
      }
      return null;
    }

    isParkingMutation({addedNodes,removedNodes}) {
      if (addedNodes.length !== 1 || removedNodes.length !== 1) return false;
      return this.parkedMoves.get(addedNodes[0]) === removedNodes[0] ||
        this.parkedMoves.get(removedNodes[0]) === addedNodes[0];
    }

    restoreParked() {
      for (const [unit,{card,marker}] of this.parked) {
        if (!unit.contains(marker)) continue;
        if (unit.querySelector('shreddit-post,shreddit-ad-post')) marker.remove();
        else marker.replaceWith(card);
      }
      this.parked.clear();
      this.parkedCount = 0;
      this.parkKey = '';
    }

    parkHiddenCards(candidates) {
      if (!this.parkedCount && candidates.length < parkAfter) return;
      // Keep Reddit's article, separator, and batch in the feed. A detached card's
      // subtree stays out of the native menu's document-wide style recalculation.
      for (const [unit,card] of candidates) {
        if (unit.querySelectorAll('shreddit-post').length !== 1) continue;
        const marker = document.createComment('filtered post');
        this.parkedMoves.set(marker,card);
        this.parked.set(unit,{card,marker});
        this.parkedCount++;
        card.replaceWith(marker);
      }
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
      if (!enabled) {
        this.positions.clear();
        document.documentElement?.removeAttribute('data-rt-unapproved-menu');
        globalThis.RTUnapprovedFilter?.useMenu?.(false);
      }
      this.refresh();
    }

    rememberPost(url, card = null) {
      const id = postId(url.pathname), feed = this.feed;
      if (!id || url.origin !== location.origin || !this.enabled || !feed?.isConnected ||
          this.url.href !== location.href || !(this.selectedTypes().length || this.activeNsfw() || this.scope.owner && this.activeFlair() || this.communityState().names.length)) return;
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
        this.toolbar?.remove();this.chips?.remove();
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

    // Opening a post or another community from the feed: Reddit changes the address first and keeps the outgoing feed
    // on screen until the destination renders. Sort & filter (and the native sort it hides) stay with that feed and
    // leave in the same pass as it (docs/feed-controls-ux-plan.md, F1-F2).
    holdOutgoing() {
      if (!this.feed || !this.toolbar?.isConnected || !shown(this.feed)) return false;
      this.leaving = {feed:this.feed};
      return true;
    }

    stillLeaving(current) {
      const leaving = this.leaving;
      if (!leaving) return false;
      if (current && this.scope && current.kind === this.scope.kind && scopeKey(current) === scopeKey(this.scope)) { this.leaving = null; return false; }
      const next = document.querySelector('main shreddit-feed');
      if (shown(leaving.feed) && (!next || next === leaving.feed)) return true;
      this.leaving = null;
      this.clear();
      return false;
    }

    giveUp() {
      this.clear();
      document.documentElement?.removeAttribute(sortBoot);
    }

    clear() {
      this.leaving = null;
      this.panel?.close();
      this.toolbar?.remove();this.chips?.remove();
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
      const archive = Boolean(current && isArchiveActive());
      const boot = Boolean((this.enabled || this.waitingForSettings) && current?.kind === 'feed' && !archive);
      // While the outgoing feed is still on screen, Reddit may re-render its sort and View switches for the new
      // address; the boot rule keeps them hidden next to the held Sort & filter until the feed leaves.
      if (this.holdDeparture(url) || (this.enabled && this.stillLeaving(current))) {
        document.documentElement?.toggleAttribute(sortBoot,boot || Boolean(this.toolbar?.isConnected));
        return;
      }
      document.documentElement?.toggleAttribute(sortBoot,boot);
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
      if (feed) {
        const reloadVerdict = inspectReloadUrl(feed.getAttribute('reload-url'), scope);
        if (reloadVerdict === 'mismatch') { this.giveUp(); return; }
        const metaVerdict = inspectFeedMeta(feed, scope);
        if (metaVerdict === 'mismatch') { this.giveUp(); return; }
        const confirmed = reloadVerdict === 'match' || metaVerdict === 'match';
        const previousOwner = this.feedOwners.get(feed);
        if (!confirmed) {
          if (previousOwner && previousOwner !== scopeKey(scope)) { this.giveUp(); return; }
          if (inspectSortBar(main, scope, url, this.links) === 'mismatch') { this.giveUp(); return; }
        }
        this.feedOwners.set(feed, scopeKey(scope));
      }
      if (this.main !== main || this.feed !== feed || this.scope?.kind !== scope.kind || scopeKey(this.scope) !== scopeKey(scope)) {
        this.clear();
        this.main = main;
        this.feed = feed;
        this.scope = scope;
      }
      this.url = url;
      if (!this.toolbar?.isConnected) { this.panel?.close(); this.mount(tabs); }
      this.collectFlairs();
      if (this.feed) this.placeFeedControls();
      else this.placeSearchControls(tabs);
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
        // Same name as the profile's menu, which this toolbar mirrors (docs/feed-controls-ux-plan.md, 1).
        const options = this.options = make('button','rt-search-inline-filter rt-community-button',menuLabel);
        options.type = 'button';
        options.dataset.rtFeedTrigger = '';
        options.dataset.rtCommunityOptions = '';
        options.setAttribute('aria-haspopup','true');
        options.setAttribute('aria-expanded','false');
        options.append(filters.svgIcon('caret-down',16));
        options.prepend(filters.svgIcon('filter',16));
        options.addEventListener('click', () => this.open());
        bar.append(options,this.chips);
        if (this.scope.surface === 'subreddit') {
          document.documentElement?.setAttribute('data-rt-unapproved-menu','');
          globalThis.RTUnapprovedFilter?.useMenu?.(true);
          this.watchAwaiting();
          if (!globalThis.RTUnapprovedFilter) document.addEventListener('rt-unapproved-ready',() => { this.awaitingFor = ''; this.watchAwaiting(); },{once:true});
        }
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
      const sort = this.feedSorts?.sorting?.node || this.feedSorts?.range?.node || this.main.querySelector(nativeFeedSort);
      const rail = !this.scope.owner || !isPhone() ? sort?.closest('div.flex.items-center') : null;
      const bar = this.toolbar;
      bar?.classList.toggle('rt-community-in-feed-rail',Boolean(rail));
      this.chips.toggleAttribute('data-rt-rail',Boolean(rail));
      if (rail) {
        if (bar.parentElement !== rail) rail.append(bar);
        this.placeFeedChips(rail);
      } else {
        if (this.chips.parentElement !== bar) bar.append(this.chips);
        if (this.feed && bar.nextElementSibling !== this.feed) this.feed.before(bar);
      }
    }

    // Applied-filter rail (docs/filter-pills-spec.md): a flex item of Reddit's full-width feed row, in its free space,
    // so Sort & filter never moves. Computers: Reddit's controls start the row, so the rail follows
    // them. Phones: the controls are right-aligned after the Feed / About tabs, so the rail sits between the two.
    placeFeedChips(rail) {
      let group = rail;
      while (group.parentElement && group.parentElement !== this.main && !group.parentElement.matches('div.flex.justify-between')) group = group.parentElement;
      const row = group.parentElement;
      if (!row || row === this.main) { if (this.chips.parentElement !== this.toolbar) this.toolbar.append(this.chips); return; }
      if (isPhone()) { if (this.chips.nextElementSibling !== group) group.before(this.chips); }
      else if (group.nextElementSibling !== this.chips) group.after(this.chips);
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
              scopeKey(target) !== scopeKey(this.scope)) continue;
          const sortKey = target.sort || (target.surface === 'home' && globalSorts.includes(fold(label)) ? fold(label) : '');
          const key = isTime ? url.searchParams.get('t') : sortKey;
          if (!key) continue;
          const currentKey = isTime ? this.url.searchParams.get('t') :
            this.scope.sort;
          const selected = currentKey ? key === currentKey : fold(label) === fold(current);
          choices.set(key,{key,label,selected,url,icon:isTime ? 'calendar' : feedSortIcons[key] || 'sort'});
        }
        if (!choices.size) return null;
        return {node,current:[...choices.values()].find(choice => choice.selected)?.label || current,choices:[...choices.values()]};
      };
      const sorting = read(sort);
      const top = sorting?.choices.find(choice => choice.key === 'top');
      let range = sorting ? read(time,true) : null;
      if (!range && top) {
        const current = top.selected ? this.url.searchParams.get('t') : null;
        const choices = topPeriods.map(([key,label]) => {
          const url = new URL(top.url);
          url.searchParams.set('t',key);
          return {key,label,selected:key === current,url,icon:'calendar'};
        });
        range = {current:choices.find(choice => choice.selected)?.label || '',choices};
      }
      this.feedSorts = {sorting,range};
      this.feedView = this.readView();
      this.setReplacedSorts([sorting?.node,range?.node,this.feedView?.node].filter(Boolean));
      this.setNativeSorts([sorting ? null : sort,range ? null : time].filter(Boolean));
    }

    // Reddit's Card / Compact switch moves into Sort & filter (docs/feed-controls-ux-plan.md, 2). Choosing activates
    // Reddit's own item, so Reddit keeps storing the layout.
    readView() {
      // Reddit renders the switch as a View dropdown (both choices) or, on some feeds, as a layout switcher that links
      // only to the other layout. Either way the row offers Card and Compact; a choice Reddit didn't render opens the
      // feed with its feedViewType, as Reddit's own links do.
      const node = this.main?.querySelector(nativeView + ':not([hidden])') || this.main?.querySelector('shreddit-layout-switcher:not([hidden])');
      if (!node || node.closest('[data-rt-ui],shreddit-feed')) return null;
      const keyOf = value => /compact/i.test(value || '') ? 'compactView' : /card/i.test(value || '') ? 'cardView' : '';
      const found = new Map();
      for (const link of node.querySelectorAll('a[href],rpl-menu-item[href]')) {
        let key = '';
        try { key = keyOf(new URL(link.getAttribute('href'),location.href).searchParams.get('feedViewType')); } catch {}
        const label = (link.querySelector('.text-body-2')?.textContent || link.textContent).trim();
        key ||= keyOf(label);
        if (!key || found.has(key)) continue;
        found.set(key,{key,link,label:label || viewLabels[key],selected:Boolean(link.closest('li')?.hasAttribute('rpl-selected')),icon:link.querySelector('svg')});
      }
      const switcher = node.localName === 'shreddit-layout-switcher';
      let current = keyOf(new URL(location.href).searchParams.get('feedViewType')) ||
        [...found.values()].find(choice => choice.selected)?.key ||
        keyOf((node.getAttribute('button-aria-label') || '').replace(/^View:?/i,'')) ||
        keyOf(node.querySelector('[slot="selected-item"]')?.textContent);
      // A switcher's one link is the layout you'd switch to.
      if (!current && switcher && found.size === 1) current = found.has('cardView') ? 'compactView' : 'cardView';
      current ||= 'cardView';
      const choices = Object.keys(viewLabels).map(key => {
        const choice = found.get(key) || {key,link:null,label:viewLabels[key],icon:null};
        return {...choice,selected:key === current};
      });
      return {node,choices,current:viewLabels[current]};
    }

    viewIcon(choice, size) {
      const icon = choice?.icon?.cloneNode(true);
      if (!icon) return filters.svgIcon(choice?.key === 'compactView' ? 'compact' : 'card',size) || filters.svgIcon('card',size);
      icon.setAttribute('width',String(size));icon.setAttribute('height',String(size));
      return icon;
    }

    chooseView(choice) {
      if (!choice) return;
      this.panel?.close();
      if (choice.link?.isConnected) { choice.link.click(); return; }
      if (choice.selected || !choice.key) return;
      const url = new URL(location.href);
      url.searchParams.set('feedViewType',choice.key);
      location.assign(url.href);
    }

    // Community filter on Home, Popular, All and custom feeds (docs/feed-controls-ux-plan.md, 7): show only, or hide,
    // chosen communities. rt_sub / rt_hide in the address; cards are hidden client-side like Post type.
    // Awaiting approval (docs/unmoderated-filter-spec.md, docs/feed-controls-ux-plan.md 10): a Post type option in any
    // community, run by RTUnapprovedFilter (mod queue for moderators, Arctic Shift otherwise). While Sort & filter is
    // on, the filter's standalone button stays hidden.
    awaitingApi() {
      const api = globalThis.RTUnapprovedFilter;
      return this.scope?.surface === 'subreddit' && this.feed && typeof api?.setActive === 'function' ? api : null;
    }

    watchAwaiting() {
      const api = this.awaitingApi();
      if (!api) return;
      const name = fold(this.scope.name);
      if (this.awaitingFor === name) return;
      this.awaitingFor = name;
      this.awaitingOff?.();
      this.awaitingOff = api.onChange?.(state => {
        if (fold(state?.subreddit || '') !== this.awaitingFor) return;
        this.awaitingState = {...this.awaitingState,...state};
        this.updateToolbar();
      });
      this.awaitingState = {subreddit:name,active:api.active?.() === true};
      Promise.resolve(api.availability?.(this.scope.name)).then(answer => {
        if (this.awaitingFor !== name || !answer) return;
        this.awaitingState = {...this.awaitingState,...answer,active:api.active?.() === true};
        this.updateToolbar();
      },() => {});
    }

    // null = hidden; otherwise the option's state. Unavailable for want of Use the archive stays visible and says so.
    awaitingOption() {
      const api = this.awaitingApi(), state = this.awaitingState;
      if (!api || !state || fold(state.subreddit || '') !== fold(this.scope.name)) return null;
      if (!state.available && state.reason !== 'archive-off') return null;
      const active = api.active?.() === true;
      return {
        active,disabled:!state.available,
        note:!state.available ? 'Needs Use the archive (Reddit Tweaks › Arctic Shift Archive)' : state.source === 'modqueue' ? 'From your mod queue' : 'Held for review, from Arctic Shift (last 7 days)',
        toggle:() => { if (state.available) Promise.resolve(api.setActive(!active)).then(() => this.updateToolbar(),() => {}); },
      };
    }

    hasCommunities() {return Boolean(this.feed && (this.scope?.global || this.scope?.owner));}

    communityState() {
      if (!this.hasCommunities()) return {mode:'show',names:[]};
      const show = subList(this.url.searchParams.get(subParam)), hide = subList(this.url.searchParams.get(hideParam));
      if (show.length) return {mode:'show',names:show};
      if (hide.length) return {mode:'hide',names:hide};
      return {mode:this.communityMode || 'show',names:[]};
    }

    communitySummary() {
      const {mode,names} = this.communityState();
      if (!names.length) return '';
      const text = names.length === 1 ? 'r/' + names[0] : names.length + ' communities';
      return mode === 'hide' ? 'Hiding ' + text : text;
    }

    applyCommunities(mode, names) {
      this.communityMode = mode;
      const url = new URL(location.href);
      url.searchParams.delete(subParam);url.searchParams.delete(hideParam);
      if (names.length) url.searchParams.set(mode === 'hide' ? hideParam : subParam,names.join(','));
      this.replaceLocalUrl(url);
    }

    toggleCommunity(name) {
      const {mode,names} = this.communityState();
      const has = names.some(value => fold(value) === fold(name));
      this.applyCommunities(mode,has ? names.filter(value => fold(value) !== fold(name)) : [...names,name].slice(0,20));
    }

    seenCommunities() {
      const counts = new Map();
      for (const card of this.feed?.querySelectorAll('shreddit-post') || []) {
        const name = (card.getAttribute('subreddit-prefixed-name') || '').replace(/^r\//i,'');
        if (!/^[a-z0-9_]{2,21}$/i.test(name)) continue;
        const key = fold(name), entry = counts.get(key) || {name,count:0};
        entry.count++;counts.set(key,entry);
      }
      for (const name of this.communityState().names) if (!counts.has(fold(name))) counts.set(fold(name),{name,count:0});
      return [...counts.values()].sort((a,b) => b.count - a.count || a.name.localeCompare(b.name));
    }

    communityPanel({onBack = null} = {}) {
      const panel = make('div','rt-sub-panel');
      panel.dataset.rtUi = 'community-panel';
      if (onBack) panel.append(filters.submenuHeader('Community',onBack).head);
      const head = make('div','rt-sub-head');
      const field = make('div','rt-filter-field');
      const search = make('input','rt-filter-search');
      search.type = 'search';search.placeholder = 'Search communities';search.autocomplete = 'off';
      search.setAttribute('aria-label','Search communities');
      field.append(filters.svgIcon('search',16),search);
      head.append(field);
      const list = make('div','rt-sub-list');
      list.dataset.rtSubList = 'true';list.setAttribute('role','group');list.setAttribute('aria-label','Communities');
      panel.append(head,list);
      const radio = filters.plainContext(name => filters.svgIcon(name,16),{role:'menuitemradio'});
      const toggle = filters.plainContext(name => filters.svgIcon(name,16),{role:'menuitemcheckbox'});
      const render = () => {
        const term = search.value.trim().replace(/^r\//i,''), wanted = fold(term);
        const {mode,names} = this.communityState(), picked = new Set(names.map(fold));
        list.replaceChildren();
        list.append(filters.menuOption(radio,{label:'Show only selected',icon:'show',checked:mode === 'show',slot:true,value:'show',
          onSelect:() => { this.applyCommunities('show',names); render(); }}));
        list.append(filters.menuOption(radio,{label:'Hide selected',icon:'close',checked:mode === 'hide',slot:true,value:'hide',
          onSelect:() => { this.applyCommunities('hide',names); render(); }}));
        list.append(filters.menuOption(radio,{label:'All communities',icon:'community',checked:!names.length,slot:true,value:'all',
          onSelect:() => { this.applyCommunities(mode,[]); render(); }}));
        const seen = this.seenCommunities();
        for (const {name,count} of seen) {
          if (wanted && !fold(name).includes(wanted)) continue;
          const row = filters.menuOption(toggle,{label:'r/' + name,icon:filters.communityIcon?.(name,16) || 'community',checked:picked.has(fold(name)),
            tail:count ? String(count) : '',slot:true,value:'r/' + name,onSelect:() => { this.toggleCommunity(name); render(); }});
          row.dataset.rtCommunityRow = name;
          list.append(row);
        }
        if (term && /^[a-z0-9_]{2,21}$/i.test(term) && !seen.some(entry => fold(entry.name) === wanted)) {
          list.append(filters.menuOption(toggle,{label:'Use r/' + term,icon:'search',slot:true,value:'custom',onSelect:() => { search.value = ''; this.toggleCommunity(term); render(); }}));
        }
      };
      search.addEventListener('input',render);
      search.addEventListener('keydown',event => { if (event.key !== 'Escape') event.stopPropagation(); });
      render();
      return {panel,list,search,render};
    }

    chooseFeedSort(choice) {
      const url = new URL(choice.url);
      const carry = this.scope?.global ? ['rt_type',subParam,hideParam,'feedViewType','t'] : this.scope?.owner ? ['rt_type',nsfwParam,'f',subParam,hideParam,'feedViewType','t'] : ['rt_type',nsfwParam,'f','feedViewType','t'];
      for (const name of carry) {
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
        flair:{value:[this.activeFlair(),this.activeNsfw()?'NSFW':''].filter(Boolean).join(' · ')},
        media:{hidden:!this.isMedia(),value:this.typeLabel()},
      };
      for (const [key,{button,text,title}] of this.searchButtons) {
        button.hidden = Boolean(state[key].hidden);
        const label = state[key].value || title;
        if(key==='flair'){
          const style=JSON.stringify([label,this.flairStyle(this.activeFlair())]);
          if(text.dataset.rtFlairStyle!==style){text.dataset.rtFlairStyle=style;text.replaceChildren(this.flairSummary() || title);}
        }else if (text.textContent !== label) text.textContent = label;
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
      if (this.scope?.global) return '';
      return this.feed ? feedFlair(this.url) : searchParts(this.url).flair;
    }

    activeNsfw() {
      if (this.scope?.global) return false;
      return this.feed ? this.url.searchParams.get(nsfwParam)==='1' : searchParts(this.url).nsfw;
    }

    flairStyle(label) {return this.flairs.get(scopeKey(this.scope))?.get(label);}

    flairSummary() {
      const label=this.activeFlair(),paint=this.flairStyle(label),nsfw=this.activeNsfw();
      if(!paint && !nsfw)return label;
      const summary=make('span','rt-community-flair-summary');
      if(label)summary.append(paint?flairPill(label,paint):label);
      if(nsfw){
        const tag=make('span','rt-community-nsfw-tag','NSFW');
        tag.prepend(filters.svgIcon(nsfwGlyph,12));summary.append(tag);
      }
      return summary;
    }

    toggleType(type) {
      const current = this.selectedTypes();
      this.applyTypes(current.includes(type) ? current.filter(value => value !== type) : [...current,type]);
    }

    collectFlairs() {
      if (this.scope?.global) return;
      const key = scopeKey(this.scope);
      const labels = new Map(this.flairs.get(key)), seen=new Set();
      const remember=(value,paint)=>{
        if(!value || seen.has(value) || !labels.has(value) && labels.size>=40)return;
        if(paint || !labels.has(value))labels.set(value,paint);
        if(paint)seen.add(value);
      };
      const links=[...document.querySelectorAll('a[href*="flair_name"]')];
      // Prefer the community's flair directory when it supplies a label also on individual posts.
      links.sort((a,b)=>Boolean(a.closest('shreddit-post'))-Boolean(b.closest('shreddit-post')));
      for (const link of links) {
        const url = new URL(link.href);
        if (url.origin !== location.origin || scopeKey(route(url)) !== key)continue;
        remember(feedFlair(url),flairPaint(link.querySelector('.flair-content,span[style]') || link));
      }
      if (this.feed) for (const node of this.feed.querySelectorAll('shreddit-post [slot="post-flair"]')) {
        const content=node.querySelector('.flair-content');
        const link=node.querySelector('a[href*="flair_name"]');
        remember(cardFlair(node),flairPaint(content || link?.querySelector('span[style]')));
      }
      if (JSON.stringify([...labels])===JSON.stringify([...(this.flairs.get(key) || [])])) return;
      this.flairs.delete(key);
      this.flairs.set(key,labels);
      while (this.flairs.size > 8) this.flairs.delete(this.flairs.keys().next().value);
      try { sessionStorage.setItem(flairKey,JSON.stringify([...this.flairs].map(([name,entries])=>[name,[...entries]]))); } catch {}
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
      // Feed controls start before the isolated-world post model. Upgrade on
      // the next pass once it loads, including cards already parked at startup.
      const WeakElementMap = globalThis.RTPostModel?.WeakElementMap;
      if (this.parked instanceof Map && WeakElementMap) {
        const parked = new WeakElementMap();
        for (const [unit, entry] of this.parked) parked.set(unit, entry);
        this.parked = parked;
      }
      const types = this.selectedTypes();
      const nsfw = this.feed && this.activeNsfw();
      const flair = this.feed && this.scope.owner && fold(this.activeFlair());
      const community = this.communityState();
      const subs = community.names.length ? {hide:community.mode === 'hide',names:new Set(community.names.map(fold))} : null;
      const active = Boolean(types.length || nsfw || flair || subs);
      const parkKey = this.feed && active ? JSON.stringify([types,Boolean(nsfw),flair,community]) : '';
      if (parkKey !== this.parkKey) {
        this.restoreParked();
        this.parkKey = parkKey;
      }
      const period = this.feed ? '' : this.url.searchParams.get('t');
      const date = period && filters.dateRange({date:{preset:period === 'day' ? '24h' : period}});
      const next = new Set();
      let matching = 0;
      if (this.feed && active) {
        const wanted = new Set(types);
        const candidates = [];
        const hide = unit => {
          next.add(unit);
          if (unit.nextElementSibling?.tagName === 'HR') next.add(unit.nextElementSibling);
        };
        for (const card of this.feed.querySelectorAll('shreddit-post')) {
          const unit = card.closest('article') || card;
          const parent = unit.parentElement;
          if (parent !== this.feed && !parent?.matches('faceplate-batch,faceplate-partial')) continue;
          if (card.parentElement?.closest('shreddit-post,shreddit-ad-post')) continue;
          const replaced = this.parked.get(unit);
          if (replaced) {
            replaced.marker.remove();
            if (this.parked.delete(unit)) this.parkedCount--;
          }
          const flairNode=flair && card.querySelector('[slot="post-flair"]');
          let matches=(!nsfw || nsfwCard(card)) && (!flair || flairNode && fold(cardFlair(flairNode))===flair);
          if (matches && subs) matches = subs.names.has(fold((card.getAttribute('subreddit-prefixed-name') || '').replace(/^r\//i,''))) !== subs.hide;
          if (matches && wanted.size) {
            const type=filters.inferType(card);
            matches=wanted.has(type) || (wanted.has('video') && type === 'embed' && externalVideo(card));
          }
          if (matches) matching++;
          else {
            hide(unit);
            if (unit.localName === 'article' && card.hasAttribute('post-type')) candidates.push([unit,card]);
          }
        }
        // Promoted units are not posts of the chosen type; hiding the posts around them
        // otherwise leaves the feed looking like an ad list.
        for (const ad of this.feed.querySelectorAll('shreddit-ad-post')) {
          const unit = ad.closest('article') || ad;
          const parent = unit.parentElement;
          if (parent !== this.feed && !parent?.matches('faceplate-batch,faceplate-partial')) continue;
          hide(unit);
        }
        for (const [unit,{marker}] of this.parked) {
          if (!unit.contains(marker)) { if (this.parked.delete(unit)) this.parkedCount--; }
          else if (this.feed.contains(unit)) hide(unit);
        }
        this.parkHiddenCards(candidates);
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
      const shown = [];
      for (const node of this.hidden) if (!next.has(node)) shown.push(node);
      // Measured before any card is hidden again, so finding the viewport costs no extra layout.
      const anchor = shown.length + (this.revealQueue?.length || 0) > revealNow ? this.revealAnchor() : null;
      for (const node of next) if (!this.hidden.has(node)) node.setAttribute(hidden,'');
      this.hidden = next;
      // A reveal already under way keeps going on its own; cards hidden again meanwhile are skipped.
      if (shown.length) this.reveal(shown,anchor);

      const feedPager = this.feed ? [...this.feed.querySelectorAll('faceplate-partial[slot="load-after"]')].at(-1) : null;
      const reachedEnd = this.syncFeedEnd(feedPager,active,matching,next.size);
      const needsMore = (active || date) && next.size && !matching;
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
      this.updateNote(date && !this.isMedia() ? 'No loaded results match this date range.' : nsfw || flair || subs ? 'No loaded posts match these filters.' : 'No loaded posts match these types.',waiting);
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
      const paint = this.flairStyle(flair);
      const nsfw = this.activeNsfw();
      const period = !this.feed && searchDates.find(([value]) => value !== 'all' && value === this.url.searchParams.get('t'));
      const community = this.communityState();
      const awaiting = this.awaitingOption();
      const key = JSON.stringify([types,flair,period,nsfw,paint,community,awaiting?.active === true]);
      if (this.chips.dataset.state === key) return;
      this.chips.dataset.state = key;
      this.chips.replaceChildren();
      const chip = (id, label, icon, onRemove) => {
        const element=filters.pill({id,label,icon},{make,glyph:name => filters.svgIcon(name,16),onRemove});
        if(id==='flair' && paint){
          element.querySelector('.rt-filter-chip-label').replaceChildren(flairPill(label,paint));
          element.querySelector('[slot="leading"]')?.remove();
        }
        this.chips.append(element);
      };
      for (const type of types) chip('type-' + type,this.feed ? filters.typeLabels[type] : mediaTypes.get(type),filters.typeIcons[type],
        () => this.applyTypes(types.filter(value => value !== type)));
      if (awaiting?.active) chip('awaiting','Awaiting approval','activity',() => awaiting.toggle());
      if (flair) chip('flair',flair,'tag',() => this.applyFlair(''));
      for (const name of community.names) {
        const element = filters.pill({id:'sub:' + fold(name),label:(community.mode === 'hide' ? 'Hide r/' : 'r/') + name,icon:'community-fill',community:name},
          {make,glyph:icon => filters.svgIcon(icon,16),onRemove:() => this.applyCommunities(community.mode,community.names.filter(value => value !== name))});
        this.chips.append(element);
      }
      if (nsfw) chip('nsfw','NSFW',nsfwGlyph,() => this.applyNsfw(false));
      if (period) chip('date',period[1],'calendar',() => this.go(setSearchOption(this.url,'t','all')));
      this.chips.hidden = !this.chips.childElementCount;
      if (this.chips.hasAttribute('data-rt-rail')) filters.fitRail?.(this.chips,{badgeFor:this.options || null});
    }

    updateLinks() {
      // Carry local types across native feed sort/view/flair changes, and
      // carry sort/date across native search result tabs.
      const used = new Set();
      const types = this.selectedTypes().join(',');
      const nsfw = this.activeNsfw();
      const flair = this.feed && this.scope.owner && this.url.searchParams.get('f');
      const community = this.feed ? this.communityState() : {names:[]};
      const candidates = this.feed
        ? document.querySelectorAll(this.scope.global ? 'shreddit-sort-dropdown a,shreddit-layout-switcher a' : 'a[href*="flair_name"],shreddit-sort-dropdown a,shreddit-layout-switcher a')
        : document.querySelectorAll('#search-results-page-tabgroup a[href],search-sort-dropdown-menu a[href]');
      for (const link of candidates) {
        const old = this.links.get(link);
        const href = link.getAttribute('href');
        const original = old?.applied === href ? old.original : href;
        if (!original) continue;
        const url = new URL(original,this.url);
        const target = route(url);
        if (url.origin !== this.url.origin || scopeKey(target) !== scopeKey(this.scope) || target.kind !== this.scope.kind) continue;
        if (this.feed) {
          if (!types && !nsfw && !flair && !community.names.length) continue;
          if(types)url.searchParams.set('rt_type',types);
          if(community.names.length)url.searchParams.set(community.mode === 'hide' ? hideParam : subParam,community.names.join(','));
          if(nsfw)url.searchParams.set(nsfwParam,'1');
          if(flair)url.searchParams.set('f',flair);
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
      this.replaceLocalUrl(url);
    }

    applyNsfw(enabled) {
      const url=withNsfw(this.url,enabled);
      if(this.feed)this.replaceLocalUrl(url);
      else{this.go(url);this.panel?.close();}
    }

    applyFlair(label) {
      const url=withFlair(this.url,label);
      if(this.feed && this.scope.owner)this.replaceLocalUrl(url);
      else this.go(url);
    }

    replaceLocalUrl(url) {
      if (url.href !== location.href) history.replaceState(history.state,'',url.pathname + url.search + url.hash);
      this.refresh();
    }

    go(url) {
      if (url.href !== location.href) this.navigate(url);
    }

    open(anchor = this.options) {
      if (!this.scope) return;
      if (this.panel) { this.panel.close(); return; }
      if (!isPhone()) { this.openFeedMenu(anchor); return; }
      const button = anchor;
      button.setAttribute('aria-expanded','true');
      this.panel = sheet.open({
        title:menuLabel, returnFocus:button,
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

    openFeedMenu(anchor = this.options) {
      const root = make('div','rt-inline-menu rt-community-feed-menu');
      root.dataset.rtUi = 'community-filter-menu';
      root.dataset.rtFeedOptions = '';
      root.setAttribute('role','menu');
      root.setAttribute('aria-label',menuLabel);
      const ctx = filters.plainContext(name => filters.svgIcon(name,16),{role:'menuitem'});
      const choices = filters.plainContext(name => filters.svgIcon(name,16));
      let section = '';
      let menu;
      const back = () => {
        if (!section) return false;
        const previous = section;
        render(previous === 'Time range' ? 'Sort' : '');
        root.querySelector('[aria-label="' + (previous === 'Time range' ? 'Top' : previous) + '"]')?.focus({preventScroll:true});
        return true;
      };
      const render = (view = '') => {
        section = view;
        root.replaceChildren();
        root.toggleAttribute('data-rt-drill',Boolean(view));
        const entry = (list,label,icon,value) => {
          const row = ctx.row(label,icon);
          row.setAttribute('aria-haspopup','menu');
          const trailing = make('span','rt-menu-value text-12 text-neutral-content-weak');
          trailing.append(value);
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
            const timed = view === 'Sort' && choice.key === 'top' && range;
            const row = filters.menuOption(radios,{
              label:choice.label,icon:sortGlyph(choice,16),checked:choice.selected,slot:true,
              onSelect:() => { if (timed) render('Time range'); else { this.chooseFeedSort(choice); menu.close(); } },
            });
            if (timed) {
              row.setAttribute('aria-haspopup','menu');
              row.firstElementChild.append(filters.svgIcon('chevron-right',16));
            }
            list.append(row);
          }
          menu?.place();
          header.back.focus({preventScroll:true});
          return;
        }
        if (view === 'View') {
          const header = filters.submenuHeader(view,back);
          const list = make('div','rt-community-menu-body');
          root.append(header.head,list);
          const radios = filters.plainContext(name => filters.svgIcon(name,16),{role:'menuitemradio'});
          for (const choice of this.feedView?.choices || []) list.append(filters.menuOption(radios,{
            label:choice.label,icon:this.viewIcon(choice,16),checked:choice.selected,slot:true,
            onSelect:() => { menu.close(false); this.chooseView(choice); },
          }));
          menu?.place();
          header.back.focus({preventScroll:true});
          return;
        }
        if (view === 'Community') {
          const panel = this.communityPanel({onBack:back});
          root.append(panel.panel);
          menu?.place();
          panel.search.focus({preventScroll:true});
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
          const awaiting = this.awaitingOption();
          if (awaiting) {
            list.append(filters.sectionLabel('Moderation'));
            const toggle = filters.plainContext(name => filters.svgIcon(name,16),{role:'menuitemcheckbox'});
            const row = filters.menuOption(toggle,{label:'Awaiting approval',icon:'activity',subtitle:'',checked:awaiting.active,slot:true,value:'awaiting',
              onSelect:() => { if (awaiting.disabled) return; menu.close(false); awaiting.toggle(); }});
            row.dataset.rtAwaiting = '';
            const note = make('span','rt-awaiting-note text-12 text-neutral-content-weak',awaiting.note);
            row.firstElementChild.firstElementChild?.append(note);
            if (awaiting.disabled) { row.setAttribute('aria-disabled','true'); row.classList.add('rt-awaiting-disabled'); }
            list.append(row);
          }
          menu?.place();
          header.back.focus({preventScroll:true});
          return;
        }
        if (view === 'Flair') {
          const panel = this.flairPanel({
            active:this.activeFlair(), onBack:back,
            onChoose:label => { this.applyFlair(label); menu.close(); },
          });
          root.append(panel.panel);
          menu?.place();
          panel.search.focus({preventScroll:true});
          return;
        }
        const list = make('div','rt-community-menu-body');
        root.append(list);
        root.prepend(filters.sectionLabel(menuLabel));
        const sorting = this.feedSorts?.sorting;
        if (sorting) entry(list,'Sort','sort',sorting.current);
        if (this.feedView) entry(list,'View',this.viewIcon(this.feedView.choices.find(choice => choice.selected),16),this.feedView.current || 'Card');
        entry(list,'Post type','text-post',this.typeLabel() || 'All');
        if (this.hasCommunities()) entry(list,'Community','community',this.communitySummary() || 'All');
        if (!this.scope.global) entry(list,'Flair','tag',this.flairSummary() || 'All');
        menu?.place();
      };
      render();
      menu = this.openPanel(anchor,root,{back});
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
          onChoose:label => { this.applyFlair(label); this.panel?.close(); },
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
      filters.appliedRow?.(ui,this.chips);
      const top = sorting?.choices.find(choice => choice.key === 'top');
      const ranges = () => ({title:'Time range',build:(_body,page) => {
        for (const choice of range.choices) page.row({
          label:choice.label,selected:choice.selected,onSelect:() => this.chooseFeedSort(choice),
        });
      }});
      const sorts = () => ({title:'Sort by',build:(_body,page) => {
        for (const choice of sorting.choices) {
          const timed = choice === top && range;
          page.row({
            label:choice.label,icon:sortGlyph(choice,20),selected:choice.selected && !timed,
            subtitle:timed && choice.selected ? range.current : '',chevron:Boolean(timed),keepOpen:Boolean(timed),
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
      if (this.feedView) {
        const current = this.feedView.choices.find(choice => choice.selected);
        ui.row({label:'View',icon:this.viewIcon(current,20),subtitle:this.feedView.current || 'Card',chevron:true,keepOpen:true,onSelect:() => {
          ui.push({title:'View',build:(_body,page) => {
            for (const choice of this.feedView?.choices || []) page.row({label:choice.label,icon:this.viewIcon(choice,20),selected:choice.selected,onSelect:() => this.chooseView(choice)});
          }});
          return {stay:true};
        }});
      }
      ui.row({
        label:'Post type',icon:(() => { const [one,...more] = this.selectedTypes(); return filters.svgIcon(one && !more.length ? (one === 'gif' ? 'gif-post-outline' : filters.typeIcons[one]) : 'text-post',20); })(),
        subtitle:this.typeLabel() || 'All types',
        chevron:true,keepOpen:true,onSelect:() => { ui.push({title:'Post type',build:(_body,page) => {
          sheet.postTypeRows(page,{selected:this.selectedTypes(),onClear:() => this.applyTypes([]),onToggle:type => this.toggleType(type)});
          const awaiting = this.awaitingOption();
          if (awaiting) {
            page.title?.('Moderation');
            page.row({label:'Awaiting approval',subtitle:awaiting.note,icon:filters.svgIcon('activity',20),selected:awaiting.active,toggle:true,keepOpen:false,
              onSelect:() => { if (!awaiting.disabled) awaiting.toggle(); }});
          }
        }}); return {stay:true}; },
      });
      if (this.hasCommunities()) ui.row({label:'Community',icon:filters.svgIcon('community',20),subtitle:this.communitySummary() || 'All communities',chevron:true,keepOpen:true,onSelect:() => {
        ui.push({title:'Community',build:(body) => { body.append(this.communityPanel().panel); return {stay:true}; }});
        return {stay:true};
      }});
      if (!this.scope.global) ui.row({label:'Flair', icon:filters.svgIcon('tag',20), subtitle:this.flairSummary() || 'All flairs', chevron:true, keepOpen:true, onSelect:() => {
        ui.push({title:'Flair',build:(body, page) => {
          const panel = this.flairPanel({
            active:this.activeFlair(),
            onChoose:label => { this.applyFlair(label); page.close(); },
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
      const toggle = filters.plainContext(name => filters.svgIcon(name,16),{role:'menuitemcheckbox'});
      const labels = new Map(this.flairs.get(scopeKey(this.scope)));
      if (active && !labels.has(active)) labels.set(active,null);
      const choices = [...labels.keys()].sort((a,b) => a.localeCompare(b));
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
        if (!wanted || 'nsfw'.includes(wanted)) list.append(filters.menuOption(toggle,{
          label:'NSFW',icon:nsfwGlyph,checked:this.activeNsfw(),slot:true,onSelect:() => { this.applyNsfw(!this.activeNsfw()); if(this.feed)render(); },
        }));
        for (const label of choices) {
          if (wanted && !fold(label).includes(wanted)) continue;
          const paint=labels.get(label);
          const row=add(label,label === active,paint?false:'tag',label,() => onChoose(label));
          if(paint)row.querySelector('.rt-menu-caption').replaceChildren(flairPill(label,paint));
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
      if (fold(base) !== (this.scope.owner?'':'subreddit:'+fold(this.scope.name))) return;
      for (const host of document.querySelectorAll('reddit-search-large,reddit-search-small')) {
        if (host.getAttribute('initial-query') !== query) continue;
        const root = host.shadowRoot || host;
        const field = root.querySelector('faceplate-search-input[name="q"]');
        const input = (field?.shadowRoot || root).querySelector('input[name="q"],textarea[name="q"]');
        if (input?.value === query && input !== input.getRootNode().activeElement) input.value = '';
      }
    }

    prepareInput(event) {
      if (isArchiveActive()) return;
      const url = new URL(location.href);
      const scope = this.enabled && route(url);
      if (scope?.kind !== 'search') return;
      const input = scopedField(event,scope);
      if (!input) return;
      const {query} = searchParts(url);
      if (fold(query) === (scope.owner?'':'subreddit:'+fold(scope.name)) && input.value === url.searchParams.get('q')) input.value = '';
    }

    handleKey(event) {
      if (!this.enabled || event.defaultPrevented || event.key !== 'Enter' || event.isComposing ||
          event.repeat || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const url = new URL(location.href);
      const scope = route(url);
      if (scope?.kind !== 'feed' || scope.global || !this.feed?.isConnected || scopeKey(this.scope) !== scopeKey(scope)) return;
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
      this.awaitingOff?.();
      document.documentElement?.removeAttribute(sortBoot);
      document.documentElement?.removeAttribute('data-rt-unapproved-menu');
      this.observer.disconnect();
      this.rootObserver?.disconnect();
      window.removeEventListener('popstate',this.onHistory);
      window.navigation?.removeEventListener('navigate',this.onNavigate);
      window.navigation?.removeEventListener('currententrychange',this.onEntry);
      for (const type of returnInputs) window.removeEventListener(type,this.onReturnInput,true);
      document.removeEventListener('reddit:route',this.onRoute);
      document.removeEventListener('click',this.onPostClick,true);
      document.removeEventListener('keydown',this.onKeys,true);
      document.removeEventListener('focusin',this.onFocus,true);
      window.removeEventListener('scroll',this.onScroll);
      this.phoneLayout?.removeEventListener?.('change',this.onRoute);
    }
  }

  globalThis.RTLiveSubredditFilters = Object.freeze({Controller,route,searchUrl,withFlair});
  if (globalThis.chrome?.runtime?.id) {
    const controller = new Controller({enabled:false,waitingForSettings:true});
    globalThis.RTLiveSubredditFiltersDebug = controller;
    // Popup: Sort & filter on feeds (docs/feed-controls-ux-plan.md, 9). Off keeps Reddit's own sort and View.
    const update = settings => controller.setEnabled(settings?.feedControls !== false);
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
