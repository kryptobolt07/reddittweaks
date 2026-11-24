/* Reddit's phone navigation bar, per page group (popup → Mobile Web → Navigation bar):
   'default' leaves Reddit's own; 'scroll' hides it while scrolling down and shows it on scrolling up; 'hidden' keeps it
   away, and pulling down at the very top of the page (or focusing it from the keyboard) shows it until you scroll on. */
(() => {
  'use strict';
  if (window.top !== window || globalThis.RTMobileHomeHeader) return;
  const homeState = 'data-rt-home-nav';
  const postState = 'data-rt-post-nav';
  const postPath = /^(?:(?:\/r\/|\/u(?:ser)?\/)[^/]+)?\/comments\/[a-z0-9]+(?:\/|$)/i;
  const NAV_DEFAULTS = {navHome:'scroll',navFeeds:'default',navCommunity:'default',navPost:'scroll',navProfile:'default',navSearch:'default'};
  const PULL = 64;
  // The page group a path belongs to, and its setting.
  const navKey = path => {
    if (postPath.test(path)) return 'navPost';
    if (path === '/' || /^\/(?:best|hot|new|top|rising|controversial)\/?$/i.test(path)) return 'navHome';
    if (/^(?:\/r\/[^/]+|\/u(?:ser)?\/[^/]+(?:\/m\/[^/]+)?)?\/search\/?$/i.test(path)) return 'navSearch';
    if (/^\/r\/(?:popular|all)(?:\/|$)/i.test(path) || /^\/(?:u|user)\/[^/]+\/m\//i.test(path)) return 'navFeeds';
    if (/^\/(?:u|user)\/[^/]+/i.test(path)) return 'navProfile';
    if (/^\/r\/[^/]+/i.test(path)) return 'navCommunity';
    return '';
  };

  class HomeHeader {
    constructor({settings = null} = {}) {
      this.mobile = matchMedia('(max-width: 767.98px)');
      this.modes = {...NAV_DEFAULTS};
      this.onTouchStart = event => { this.pullFrom = Math.max(scrollY,0) <= 0 && event.touches?.length === 1 ? event.touches[0].clientY : null; };
      this.onTouchMove = event => {
        if (this.pullFrom == null || this.mode !== 'hidden' || !this.header) return;
        if ((event.touches?.[0]?.clientY ?? 0) - this.pullFrom >= PULL) { this.pullFrom = null; this.shown = true; this.edge = Math.max(scrollY,0); this.header.setAttribute(this.state,'shown'); }
      };
      this.onTouchEnd = () => { this.pullFrom = null; };
      this.onRoute = () => this.sync();
      this.onFocus = event => {
        if (!this.header?.hasAttribute(this.state) || !event.composedPath()[0]?.matches?.(':focus-visible')) return;
        this.shown = true;
        this.edge = Math.max(scrollY,0);
        this.header.setAttribute(this.state,'shown');
      };
      this.onScroll = () => {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          this.update();
        });
      };
      this.observer = new MutationObserver(() => {
        const route = this.activeRoute();
        const wantedState = this.isHomeHeader(route) ? homeState : postState;
        if (this.header?.isConnected && this.row?.parentElement === this.header && route === this.route && this.state === wantedState) {
          if (this.state === homeState && !this.search?.isConnected) this.addSearch();
          return;
        }
        if (this.header || route) this.sync();
      });
      this.observer.observe(document, {childList:true,subtree:true});
      this.mobile.addEventListener('change',this.onRoute);
      document.addEventListener('reddit:route',this.onRoute);
      window.addEventListener('popstate',this.onRoute);
      window.addEventListener('pageshow',this.onRoute);
      window.navigation?.addEventListener('currententrychange',this.onRoute);
      window.addEventListener('touchstart',this.onTouchStart,{passive:true});
      window.addEventListener('touchmove',this.onTouchMove,{passive:true});
      window.addEventListener('touchend',this.onTouchEnd,{passive:true});
      window.addEventListener('touchcancel',this.onTouchEnd,{passive:true});
      this.sync();
      if (settings) Promise.resolve(settings).then(value => this.setModes(value),() => {});
    }
    setModes(value) {
      const next = {...NAV_DEFAULTS};
      for (const key of Object.keys(next)) if (['default','scroll','hidden'].includes(value?.[key])) next[key] = value[key];
      this.modes = next;
      // A changed mode re-applies on the current page.
      this.route = undefined;this.detach();this.sync();
    }
    modeFor(path) { const key = navKey(path); return key ? this.modes[key] || 'default' : 'default'; }
    isHomeHeader(route) {
      return Boolean(route) && navKey(route) === 'navHome' && Boolean(document.querySelector('reddit-header-small:has(> prominent-search)'));
    }
    activeRoute() {
      if (!this.mobile.matches) return null;
      const path = location.pathname;
      return this.modeFor(path) === 'default' ? null : path;
    }
    sync() {
      const route = this.activeRoute();
      const home = this.isHomeHeader(route);
      const wantedState = home ? homeState : postState;
      const header = route ? document.querySelector(home ? 'reddit-header-small:has(> prominent-search)' : 'reddit-header-small') : null;
      const row = header?.querySelector(':scope > header') ?? null;
      const sameRoute = route === this.route;
      if (header === this.header && row === this.row && sameRoute && this.state === wantedState) {
        if (home && row && !this.search?.isConnected) this.addSearch();
        return;
      }
      this.detach();
      this.route = route;
      if (!sameRoute) this.edge = undefined;
      if (!row) return;
      this.header = header;
      this.row = row;
      this.mode = this.modeFor(route);
      this.state = wantedState;
      this.header.toggleAttribute('data-rt-nav-hidden', this.mode === 'hidden');
      row.addEventListener('focusin',this.onFocus);
      if (home || this.edge === undefined || this.mode === 'hidden') {
        this.edge = Math.max(scrollY,0);
        this.shown = !home && this.mode !== 'hidden';
      }
      this.measure();
      if (home) this.addSearch();
      if (typeof ResizeObserver === 'function') {
        this.resize = new ResizeObserver(() => this.measure());
        this.resize.observe(row);
      }
      window.addEventListener('scroll',this.onScroll,{passive:true});
      this.update();
    }
    addSearch() {
      const nav = this.row.querySelector('nav');
      const before = nav?.querySelector('create-post-entry-point-wrapper,#notifications-inbox-button,#expand-user-drawer-button');
      const source = this.header.querySelector('prominent-search #expand-search-button');
      const glyph = globalThis.RTFeedFilters?.svgIcon('search',20);
      if (!before || !source || !glyph) return;
      const button = this.search = document.createElement('button');
      button.type = 'button';
      button.className = 'button button-medium button-plain icon inline-flex items-center justify-center';
      button.dataset.rtHomeSearch = '';
      button.setAttribute('aria-label','Search');
      button.append(glyph);
      button.addEventListener('click',() => this.header?.querySelector('prominent-search #expand-search-button')?.click());
      before.before(button);
    }
    measure() {
      const home = this.state === homeState;
      const height = this.row?.offsetHeight || (home ? 56 : 48);
      this.height = height;
      this.header?.style.setProperty(home ? '--rt-home-nav-height' : '--rt-post-nav-height',height+'px');
    }
    update() {
      if (this.activeRoute() !== this.route || !this.header?.isConnected) {this.sync();return;}
      const y = Math.max(scrollY,0);
      const home = this.state === homeState;
      if (this.mode === 'hidden') {
        // Shown only after a pull at the top (or keyboard focus), until the reader scrolls on.
        if (this.shown && y - this.edge >= 24) this.shown = false;
        const next = this.shown ? 'shown' : 'hidden';
        if (this.header.getAttribute(this.state) !== next) this.header.setAttribute(this.state,next);
        document.documentElement.style.setProperty('--rt-visible-header-height', (this.shown ? this.height : 0) + 'px');
        return;
      }
      if (home && y < this.height) {
        this.shown = false;
        this.edge = y;
        this.header.removeAttribute(this.state);
        document.documentElement.style.setProperty('--rt-visible-header-height', this.height + 'px');
        return;
      }
      if (y === 0) {
        this.shown = true;
        this.edge = 0;
      } else {
        this.edge = this.shown ? Math.min(this.edge,y) : Math.max(this.edge,y);
        // A slightly larger reversal is needed to dismiss an already revealing post navbar.
        const directionThreshold = home ? 8 : this.shown ? 24 : 12;
        if (Math.abs(y-this.edge) >= directionThreshold) {
          this.shown = !this.shown;
          this.edge = y;
        }
      }
      const next = this.shown ? 'shown' : 'hidden';
      if (this.header.getAttribute(this.state) !== next) this.header.setAttribute(this.state,next);
      document.documentElement.style.setProperty('--rt-visible-header-height', (this.shown ? this.height : 0) + 'px');
    }
    detach() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.resize?.disconnect();
      window.removeEventListener('scroll',this.onScroll);
      this.header?.removeAttribute(this.state);
      this.header?.removeAttribute('data-rt-nav-hidden');
      this.header?.style.removeProperty(this.state === homeState ? '--rt-home-nav-height' : '--rt-post-nav-height');
      document.documentElement.style.removeProperty('--rt-visible-header-height');
      this.row?.removeEventListener('focusin',this.onFocus);
      this.search?.remove();
      this.header = this.row = this.search = null;
    }
    destroy() {
      this.detach();
      this.observer.disconnect();
      this.mobile.removeEventListener('change',this.onRoute);
      document.removeEventListener('reddit:route',this.onRoute);
      window.removeEventListener('popstate',this.onRoute);
      window.removeEventListener('pageshow',this.onRoute);
      window.navigation?.removeEventListener('currententrychange',this.onRoute);
      window.removeEventListener('touchstart',this.onTouchStart);
      window.removeEventListener('touchmove',this.onTouchMove);
      window.removeEventListener('touchend',this.onTouchEnd);
      window.removeEventListener('touchcancel',this.onTouchEnd);
    }
  }

  globalThis.RTMobileHomeHeader = Object.freeze({HomeHeader,navKey,NAV_DEFAULTS});
  if (globalThis.RTCore?.settings) {
    const sync = globalThis.RTCore.settings.readSync();
    const header = new HomeHeader(sync ? {settings:sync} : {});
    const update = value => header.setModes(value && typeof value === 'object' ? value : {});
    let first = Boolean(sync);
    globalThis.RTCore.settings.subscribe((value, meta) => {
      if (first && meta?.sync) { first = false; return; }
      first = false;
      update(value);
    });
  } else if (globalThis.chrome?.runtime?.id) {
    let read;
    try { read = chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'}).then(answer => answer?.settings || null); } catch { read = Promise.resolve(null); }
    const header = new HomeHeader({settings:read});
    const update = value => header.setModes(value && typeof value === 'object' ? value : {});
    try {
      chrome.runtime.onMessage?.addListener(message => { if (message?.scope === 'rt-posts' && message.action === 'settings-changed' && message.settings) update(message.settings); });
      chrome.storage?.onChanged?.addListener((changes,area) => { if (area === 'local' && changes['rt-settings-v1']) update(changes['rt-settings-v1'].newValue); });
    } catch {}
  }
})();
