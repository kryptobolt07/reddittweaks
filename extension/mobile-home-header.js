/* Restore the compact native navigation row when scrolling up on mobile Home. */
(() => {
  'use strict';
  if (window.top !== window || globalThis.RTMobileHomeHeader) return;
  const state = 'data-rt-home-nav';
  const directionThreshold = 8;

  class HomeHeader {
    constructor() {
      this.mobile = matchMedia('(max-width: 767.98px)');
      this.onRoute = () => this.sync();
      this.onScroll = () => {
        if (this.frame) return;
        this.frame = requestAnimationFrame(() => {
          this.frame = 0;
          this.update();
        });
      };
      this.observer = new MutationObserver(() => {
        if (this.header?.isConnected && this.row?.parentElement === this.header && this.activeRoute()) {
          if (!this.search?.isConnected) this.addSearch();
          return;
        }
        if (this.header || this.activeRoute()) this.sync();
      });
      this.observer.observe(document, {childList:true,subtree:true});
      this.mobile.addEventListener('change',this.onRoute);
      document.addEventListener('reddit:route',this.onRoute);
      window.addEventListener('popstate',this.onRoute);
      window.addEventListener('pageshow',this.onRoute);
      window.navigation?.addEventListener('currententrychange',this.onRoute);
      this.sync();
    }
    activeRoute() { return this.mobile.matches && location.pathname === '/'; }
    sync() {
      const header = this.activeRoute() ? document.querySelector('reddit-header-small:has(> prominent-search)') : null;
      const row = header?.querySelector(':scope > header');
      if (header === this.header && row === this.row) {
        if (row && !this.search?.isConnected) this.addSearch();
        return;
      }
      this.detach();
      if (!row) return;
      this.header = header;
      this.row = row;
      this.height = 56;
      this.measure();
      this.edge = Math.max(scrollY,0);
      this.shown = false;
      this.addSearch();
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
      const height = this.row?.offsetHeight || 56;
      this.height = height;
      this.header?.style.setProperty('--rt-home-nav-height',height+'px');
    }
    update() {
      if (!this.activeRoute() || !this.header?.isConnected) {this.sync();return;}
      const y = Math.max(scrollY,0);
      if (y < this.height) {
        this.shown = false;
        this.edge = y;
        this.header.removeAttribute(state);
        return;
      }
      this.edge = this.shown ? Math.min(this.edge,y) : Math.max(this.edge,y);
      if ((this.shown ? y-this.edge : this.edge-y) >= directionThreshold) {
        this.shown = !this.shown;
        this.edge = y;
      }
      const next = this.shown ? 'shown' : 'hidden';
      if (this.header.getAttribute(state) !== next) this.header.setAttribute(state,next);
    }
    detach() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.resize?.disconnect();
      window.removeEventListener('scroll',this.onScroll);
      this.header?.removeAttribute(state);
      this.header?.style.removeProperty('--rt-home-nav-height');
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
