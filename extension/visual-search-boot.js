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

  activateIfNeeded();
  window.addEventListener('popstate', activateIfNeeded, true);
  globalThis.navigation?.addEventListener('currententrychange', event => {
    if (event?.navigationType === 'traverse') activateIfNeeded();
  });
})();
