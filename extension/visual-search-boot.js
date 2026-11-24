/* Pre-paint route gate for Visual Search (matches the profile-discovery boot pattern):
   sets data-rt-visual-active before first paint when Visual Search is known active on this tab
   so Reddit's native search results / empty state never flash during initial load or Back traversal. */
(() => {
  'use strict';
  if (window.top !== window) return;
  const ENABLED_KEY = 'rt-visual-enabled-v1';
  const SEARCH_PATH_RE = /^\/(?:(?:r\/[A-Za-z0-9_]{2,24}|user\/[A-Za-z0-9_-]{1,24}(?:\/m\/[A-Za-z0-9_-]{1,50})?)\/)?search\/?$/i;

  function enabledInSession() {
    try { return sessionStorage.getItem(ENABLED_KEY) === '1'; }
    catch { return false; }
  }

  function isVisualUrl() {
    if (!SEARCH_PATH_RE.test(location.pathname)) return false;
    try { return new URLSearchParams(location.search).get('rt_visual') === '1'; }
    catch { return false; }
  }

  function activateIfNeeded() {
    if (!enabledInSession() || !isVisualUrl()) return;
    document.documentElement?.setAttribute('data-rt-visual-active', '');
  }

  // The lens in Reddit's search bars. Drawn from here (document_start) so it arrives in the same frame as the bar
  // instead of after visual-search.js (document_idle) and its settings round trip; visual-search.js handles clicks.
  const SVG = 'http://www.w3.org/2000/svg';
  function lensIcon(size = 20) {
    const svg = document.createElementNS(SVG, 'svg');
    for (const [k, v] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', height: String(size), width: String(size), viewBox: '0 0 20 20', 'aria-hidden': 'true', 'data-rt-icon': 'lens' })) svg.setAttribute(k, v);
    const corners = document.createElementNS(SVG, 'path');
    corners.setAttribute('d', 'M2.9 7.3V5.4a2.5 2.5 0 0 1 2.5-2.5h1.9M12.7 2.9h1.9a2.5 2.5 0 0 1 2.5 2.5v1.9M17.1 12.7v1.9a2.5 2.5 0 0 1-2.5 2.5h-1.9M7.3 17.1H5.4a2.5 2.5 0 0 1-2.5-2.5v-1.9');
    const lens = document.createElementNS(SVG, 'circle');
    for (const [k, v] of Object.entries({ cx: '10', cy: '10', r: '3.1' })) lens.setAttribute(k, v);
    svg.append(corners, lens);
    return svg;
  }
  function trigger(size) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rt-vs-header-btn';
    btn.dataset.rtUi = 'visual-search-trigger';
    btn.setAttribute('aria-label', 'Search with an image');
    btn.title = 'Search with an image';
    // Shadow roots isolate page CSS, so the slotted button carries its own style.
    btn.style.cssText = `display:inline-flex;align-items:center;justify-content:center;flex:none;width:${size}px;height:${size}px;padding:0;margin:0 4px 0 2px;border:0;border-radius:999px;background:transparent;color:var(--color-neutral-content-weak,#576f76);cursor:pointer;transition:background-color 120ms ease,color 120ms ease;`;
    btn.append(lensIcon(size >= 40 ? 22 : 20));
    btn.addEventListener('pointerenter', () => { btn.style.backgroundColor = 'var(--color-secondary-background-hover,rgba(0,0,0,0.06))'; btn.style.color = 'var(--color-neutral-content-strong,#181c1f)'; });
    btn.addEventListener('pointerleave', () => { btn.style.backgroundColor = 'transparent'; btn.style.color = 'var(--color-neutral-content-weak,#576f76)'; });
    btn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopImmediatePropagation();
      const controller = globalThis.RTVisualSearchInstance;
      if (controller?.enabled) controller.openUploadUi(btn);
      else lens.pending = btn; // visual-search.js opens it once it is ready
    });
    return btn;
  }
  const HOSTS = 'reddit-search-large, reddit-search-small, prominent-search';
  function attach() {
    for (const host of document.querySelectorAll(HOSTS)) {
      const root = host.shadowRoot || host;
      const field = root.querySelector?.('faceplate-search-input[name="q"]');
      if (field) {
        if (field.closest?.('[data-rt-ui]') || field.querySelector(':scope > [data-rt-ui="visual-search-trigger"]')) continue;
        const btn = trigger(32);
        btn.slot = 'trailingContent';
        field.append(btn);
        continue;
      }
      // Phone Home: prominent-search is one big "Search Reddit" button; the lens sits inside its right end.
      const fake = host.matches('prominent-search') ? host.querySelector('.prominent-search-button') : null;
      const box = fake?.parentElement;
      if (!fake || !box || box.querySelector(':scope > [data-rt-ui="visual-search-trigger"]')) continue;
      const btn = trigger(40);
      Object.assign(btn.style, { position: 'absolute', insetInlineEnd: '4px', top: '50%', transform: 'translateY(-50%)', zIndex: '1', margin: '0' });
      box.append(btn);
    }
  }
  function detach() {
    for (const host of document.querySelectorAll(HOSTS)) {
      for (const root of [host.shadowRoot, host]) root?.querySelectorAll?.('[data-rt-ui="visual-search-trigger"]').forEach(el => el.remove());
    }
  }
  // Watch the document and each search host's shadow root (where Reddit renders the input) until the controller
  // has taken over; a frame-batched check keeps this to one pass per frame.
  let queued = false, observer = null;
  const watched = new WeakSet();
  const check = () => {
    queued = false;
    if (!lens.on) return;
    for (const host of document.querySelectorAll(HOSTS)) {
      if (host.shadowRoot && !watched.has(host.shadowRoot)) { watched.add(host.shadowRoot); observer?.observe(host.shadowRoot, { childList: true, subtree: true }); }
    }
    attach();
  };
  // Observer callbacks run before the next paint, so checking right away puts the lens in the bar's own frame; the
  // frame callback covers a shadow root that had already rendered before it was observed.
  const schedule = () => { check(); if (!queued) { queued = true; requestAnimationFrame(check); } };
  const lens = globalThis.RTVisualLens = {
    on: false, pending: null, attach, detach, icon: lensIcon,
    set(enabled) {
      lens.on = Boolean(enabled);
      if (!lens.on) { detach(); observer?.disconnect(); observer = null; return; }
      if (!observer && typeof MutationObserver === 'function') {
        observer = new MutationObserver(schedule);
        observer.observe(document.documentElement || document, { childList: true, subtree: true });
      }
      schedule();
    }
  };
  if (enabledInSession()) lens.set(true);
  // A tab's first page has no session flag yet: ask for the setting now rather than wait for visual-search.js.
  else {
    try {
      const runtime = (globalThis.browser || globalThis.chrome)?.runtime;
      Promise.resolve(runtime?.sendMessage?.({ scope: 'rt-posts', action: 'get-settings' })).then(res => {
        if (res?.ok && res.settings?.visualSearch === true && !globalThis.RTVisualSearchInstance) lens.set(true);
      }, () => {});
    } catch {}
  }

  activateIfNeeded();
  window.addEventListener('popstate', activateIfNeeded, true);
  globalThis.navigation?.addEventListener('currententrychange', event => {
    if (event?.navigationType === 'traverse') activateIfNeeded();
  });
})();
