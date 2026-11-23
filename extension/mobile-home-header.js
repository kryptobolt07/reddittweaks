/* Reveal Reddit's mobile navigation row when scrolling up on Home or a post. */
(() => {
  'use strict';
  if (window.top !== window || globalThis.RTMobileHomeHeader) return;
  const homeState = 'data-rt-home-nav';
  const postState = 'data-rt-post-nav';
  const postPath = /^(?:(?:\/r\/|\/u(?:ser)?\/)[^/]+)?\/comments\/[a-z0-9]+(?:\/|$)/i;

  class HomeHeader {
    constructor() {
      this.mobile = matchMedia('(max-width: 767.98px)');
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
        if (this.header?.isConnected && this.row?.parentElement === this.header && route === this.route) {
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
      this.sync();
    }
    activeRoute() {
      if (!this.mobile.matches) return null;
      const path = location.pathname;
      return path === '/' || postPath.test(path) ? path : null;
    }
    sync() {
      const route = this.activeRoute();
      const home = route === '/';
      const header = route ? document.querySelector(home ? 'reddit-header-small:has(> prominent-search)' : 'reddit-header-small') : null;
      const row = header?.querySelector(':scope > header') ?? null;
      const sameRoute = route === this.route;
      if (header === this.header && row === this.row && sameRoute) {
        if (home && row && !this.search?.isConnected) this.addSearch();
        return;
      }
      this.detach();
      this.route = route;
      if (!sameRoute) this.edge = undefined;
      if (!row) return;
      this.header = header;
      this.row = row;
      this.state = home ? homeState : postState;
      row.addEventListener('focusin',this.onFocus);
      if (home || this.edge === undefined) {
        this.edge = Math.max(scrollY,0);
        this.shown = !home;
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
      if (home && y < this.height) {
        this.shown = false;
        this.edge = y;
        this.header.removeAttribute(this.state);
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
    }
    detach() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.resize?.disconnect();
      window.removeEventListener('scroll',this.onScroll);
      this.header?.removeAttribute(this.state);
      this.header?.style.removeProperty(this.state === homeState ? '--rt-home-nav-height' : '--rt-post-nav-height');
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
    }
  }

  globalThis.RTMobileHomeHeader = Object.freeze({HomeHeader});
  if (globalThis.chrome?.runtime?.id) new HomeHeader();
})();
