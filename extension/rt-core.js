/* Shared Reddit Tweaks isolated-world runtime core: 0ms settings mirror + single IPC,
   pooled document MutationObserver, unified SPA route bus, and adoptedStyleSheets helper. */
(() => {
  'use strict';
  if (window.top !== window || globalThis.RTCore) return;

  const BOOT_KEY = 'rt-boot-cfg-v1';
  const BOOT_SETTING_KEYS = new Set([
    'postDiscovery', 'feedControls', 'blockedProfiles', 'signedOutSearch', 'archiveDiscovery',
    'restoreDeletedContent', 'subredditArchive', 'subredditArchiveAutomatic',
    'visualSearch', 'visualSearchPostMenu', 'visualClick', 'visualSearchMediaButton', 'visualNsfw',
    'cleanShareLinks', 'stopAutoTranslation',
    'commentThreadlines', 'commentThreadlinesCvd', 'commentJump', 'commentJumpSide',
    'backToTop', 'collapseAutoMod', 'collapseChildComments', 'autoLoadMoreComments', 'betterComposer',
    'modUnapprovedFilter', 'raffles', 'downloadMedia', 'ownRemoval', 'removalNotifications',
    'historyLimit',
    'smoothFeeds', 'smoothHome', 'smoothSubreddits', 'smoothProfiles', 'smoothSearch', 'smoothComments',
    'hideMatureOverlay', 'revealNsfwPostMedia', 'chatSearch',
    'navHome', 'navFeeds', 'navCommunity', 'navPost', 'navProfile', 'navSearch',
    'videoStart', 'embedStart', 'gifStart', 'mediaClickAction', 'clickAudio', 'embedBlockLinks',
    'singleVideo', 'volumeMemory', 'videoScrollAway', 'videoOpenPost', 'cardClickAudio',
    'videoDirectOpen', 'holdFor2x', 'loopPolicy', 'streamQuality'
  ]);

  const api = () => globalThis.browser || globalThis.chrome;
  const raf = callback => (globalThis.requestAnimationFrame || (fn => setTimeout(fn, 16)))(callback);

  function allowlistedPrimitives(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const out = {};
    let count = 0;
    for (const key of Object.keys(raw)) {
      if (!BOOT_SETTING_KEYS.has(key)) continue;
      const value = raw[key];
      if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && value.length <= 40)) {
        out[key] = value;
        count++;
      }
    }
    return count ? out : null;
  }

  function readSync() {
    try {
      const parsed = JSON.parse(localStorage.getItem(BOOT_KEY) || 'null');
      return allowlistedPrimitives(parsed);
    } catch {
      return null;
    }
  }

  function writeSync(raw) {
    const clean = allowlistedPrimitives(raw);
    if (!clean) return false;
    try {
      localStorage.setItem(BOOT_KEY, JSON.stringify(clean));
      return true;
    } catch {
      return false;
    }
  }

  // Shared single-IPC settings client + live cross-tab subscription.
  const settingsListeners = new Set();
  let currentSettings = null;
  let workerLoaded = false;
  let settingsRevision = 0;
  let settingsPromise = null;
  let settingsEventsBound = false;

  function sameSettings(left, right) {
    if (left === right) return true;
    if (!left) return false;
    const keys = Object.keys(right);
    return keys.length === Object.keys(left).length && keys.every(key => {
      if (!Object.hasOwn(left, key)) return false;
      const a = left[key], b = right[key];
      return a === b || (a && b && typeof a === 'object' && typeof b === 'object' && JSON.stringify(a) === JSON.stringify(b));
    });
  }

  function applyIncomingSettings(next, meta) {
    if (!next || typeof next !== 'object' || Array.isArray(next)) return;
    if (sameSettings(currentSettings, next)) return;
    settingsRevision++;
    currentSettings = next;
    writeSync(next);
    for (const listener of [...settingsListeners]) {
      try { listener(next, meta); } catch {}
    }
  }

  function bindSettingsEvents() {
    if (settingsEventsBound) return;
    settingsEventsBound = true;
    const ext = api();
    try {
      ext?.runtime?.onMessage?.addListener((message, sender) => {
        const ownId = ext?.runtime?.id;
        if (sender?.id && ownId && sender.id !== ownId) return;
        if (message?.scope === 'rt-posts' && message.action === 'settings-changed' && message.settings) {
          applyIncomingSettings(message.settings, { sync: false, source: 'change' });
        }
      });
      ext?.storage?.onChanged?.addListener((changes, area) => {
        if (area === 'local' && changes?.['rt-settings-v1']?.newValue) {
          applyIncomingSettings(changes['rt-settings-v1'].newValue, { sync: false, source: 'change' });
        }
      });
    } catch {}
  }

  function getResponse() {
    if (currentSettings) return Promise.resolve({ ok: true, settings: currentSettings });
    if (settingsPromise) return settingsPromise;
    bindSettingsEvents();
    const ext = api();
    if (typeof ext?.runtime?.sendMessage !== 'function') {
      return Promise.resolve({ ok: false, settings: null });
    }
    const initialRev = settingsRevision;
    let req;
    try {
      req = Promise.resolve(ext.runtime.sendMessage({ scope: 'rt-posts', action: 'get-settings' }));
    } catch {
      return Promise.resolve({ ok: false, settings: null });
    }
    settingsPromise = req.then(response => {
      if (response?.ok && response.settings && typeof response.settings === 'object') {
        workerLoaded = true;
        if (settingsRevision === initialRev) {
          currentSettings = response.settings;
          writeSync(currentSettings);
        }
        return { ...response, settings: currentSettings };
      }
      return { ok: Boolean(currentSettings), settings: currentSettings };
    }, () => ({ ok: Boolean(currentSettings), settings: currentSettings })).finally(() => { settingsPromise = null; });
    return settingsPromise;
  }

  const getSettings = () => getResponse().then(res => (res?.ok ? res.settings : null));

  function subscribeSettings(fn) {
    if (typeof fn !== 'function') return () => {};
    bindSettingsEvents();
    settingsListeners.add(fn);
    const subRev = settingsRevision;
    let deliveredSync = false;

    if (currentSettings) {
      deliveredSync = true;
      try { fn(currentSettings, { sync: true, source: workerLoaded ? 'worker' : 'cache' }); } catch {}
    } else {
      const mirrored = readSync();
      if (mirrored) {
        deliveredSync = true;
        try { fn(mirrored, { sync: true, source: 'mirror' }); } catch {}
      }
    }

    if (!currentSettings) {
      getSettings().then(resolved => {
        if (!settingsListeners.has(fn) || settingsRevision !== subRev) return;
        if (resolved) {
          try { fn(resolved, { sync: false, source: 'worker' }); } catch {}
        } else if (!deliveredSync) {
          try { fn(null, { sync: false, source: 'worker' }); } catch {}
        }
      });
    }

    return () => { settingsListeners.delete(fn); };
  }

  const settings = Object.freeze({
    readSync,
    writeSync,
    getResponse,
    get: getSettings,
    subscribe: subscribeSettings
  });

  // Pooled MutationObserver hub with per-frame batching.
  const observerSubscribers = new Set();
  const pendingAdded = new Set();
  const pendingRemoved = new Set();
  let rootObserver = null;
  let flushScheduled = false;

  function flushObserver() {
    flushScheduled = false;
    const added = [];
    for (const node of pendingAdded) if (node.nodeType === 1 && node.isConnected) added.push(node);
    const removed = [];
    for (const node of pendingRemoved) if (node.nodeType === 1 && !node.isConnected) removed.push(node);
    pendingAdded.clear();
    pendingRemoved.clear();

    if (routeSubscribers.size && location.href !== lastHref) notifyRoute({ navType: 'mutation' });
    if (!added.length && !removed.length) return;
    const batch = { added, removed };
    for (const fn of [...observerSubscribers]) {
      try { fn(batch); } catch {}
    }
  }

  function ensureRootObserver() {
    if (rootObserver || typeof MutationObserver !== 'function') return;
    const target = document;
    rootObserver = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.nodeType === 1) {
            pendingAdded.add(node);
            pendingRemoved.delete(node);
          }
        }
        for (const node of record.removedNodes) {
          if (node.nodeType === 1) pendingRemoved.add(node);
        }
      }
      if (!flushScheduled && (pendingAdded.size || pendingRemoved.size)) {
        flushScheduled = true;
        raf(flushObserver);
      }
    });
    rootObserver.observe(target, { childList: true, subtree: true });
  }

  function teardownRootObserverIfIdle() {
    if (observerSubscribers.size || routeSubscribers.size) return;
    if (rootObserver) {
      rootObserver.disconnect();
      rootObserver = null;
    }
    pendingAdded.clear();
    pendingRemoved.clear();
    flushScheduled = false;
  }

  function subscribeObserver(fn) {
    if (typeof fn !== 'function') return () => {};
    observerSubscribers.add(fn);
    ensureRootObserver();
    return () => {
      observerSubscribers.delete(fn);
      teardownRootObserverIfIdle();
    };
  }

  function watchSelector(selector, { onAdd, onRemove, existing = true } = {}) {
    if (typeof selector !== 'string' || !selector) return () => {};
    const seen = new WeakSet();
    const visitAdd = el => {
      if (!el?.isConnected || seen.has(el)) return;
      seen.add(el);
      if (typeof onAdd === 'function') {
        try { onAdd(el); } catch {}
      }
    };
    const visitRemove = el => {
      if (!seen.has(el)) return;
      seen.delete(el);
      if (typeof onRemove === 'function') {
        try { onRemove(el); } catch {}
      }
    };
    if (existing && document.querySelectorAll) {
      for (const el of document.querySelectorAll(selector)) visitAdd(el);
    }
    return subscribeObserver(({ added, removed }) => {
      if (onAdd) {
        for (const root of added) {
          if (root.matches?.(selector)) visitAdd(root);
          for (const el of root.querySelectorAll?.(selector) || []) visitAdd(el);
        }
      }
      if (onRemove) {
        for (const root of removed) {
          if (root.matches?.(selector)) visitRemove(root);
          for (const el of root.querySelectorAll?.(selector) || []) visitRemove(el);
        }
      }
    });
  }

  const observer = Object.freeze({
    subscribe: subscribeObserver,
    watchSelector
  });

  // Unified SPA route bus layered over Baseline Navigation API + popstate + reddit:route.
  const routeSubscribers = new Set();
  let lastHref = location.href;
  let routeEventsBound = false;

  const onNavEvent = event => notifyRoute({ navType: event?.navigationType || '' });
  const onPopState = () => notifyRoute({ navType: 'traverse' });
  const onPageShow = event => notifyRoute({ force: Boolean(event?.persisted), navType: 'pageshow' });
  const onRedditRoute = () => notifyRoute({ force: true, navType: 'reddit' });

  function notifyRoute({ force = false, navType = '' } = {}) {
    const href = location.href;
    if (href === lastHref && !force) return;
    const prevHref = lastHref;
    lastHref = href;
    const detail = {
      href,
      pathname: location.pathname,
      search: location.search,
      hash: location.hash,
      prevHref,
      navType
    };
    for (const fn of [...routeSubscribers]) {
      try { fn(detail); } catch {}
    }
  }

  function bindRouteEvents() {
    if (routeEventsBound) return;
    routeEventsBound = true;
    lastHref = location.href;
    window.navigation?.addEventListener?.('currententrychange', onNavEvent);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('reddit:route', onRedditRoute);
  }

  function unbindRouteEventsIfIdle() {
    if (routeSubscribers.size || !routeEventsBound) return;
    routeEventsBound = false;
    try {
      if (typeof window !== 'undefined') {
        window?.navigation?.removeEventListener?.('currententrychange', onNavEvent);
        window?.removeEventListener?.('popstate', onPopState);
        window?.removeEventListener?.('pageshow', onPageShow);
      }
      if (typeof document !== 'undefined') {
        document?.removeEventListener?.('reddit:route', onRedditRoute);
      }
    } catch {}
    teardownRootObserverIfIdle();
  }

  function subscribeRoutes(fn) {
    if (typeof fn !== 'function') return () => {};
    if (!routeSubscribers.size) lastHref = location.href;
    routeSubscribers.add(fn);
    bindRouteEvents();
    ensureRootObserver();
    return () => {
      routeSubscribers.delete(fn);
      unbindRouteEventsIfIdle();
    };
  }

  const routes = Object.freeze({
    subscribe: subscribeRoutes
  });

  // Toggleable adoptedStyleSheets with automatic <style> element fallback.
  const docSheets = new WeakMap();

  function adoptStyles(doc, id, cssText) {
    const targetDoc = doc || document;
    if (!targetDoc || !id) return null;
    let map = docSheets.get(targetDoc);
    if (!map) {
      map = new Map();
      docSheets.set(targetDoc, map);
    }
    const existing = map.get(id);
    const empty = typeof cssText !== 'string' || !cssText.trim();

    if (empty) {
      if (!existing) return null;
      if (existing.type === 'sheet' && Array.isArray(targetDoc.adoptedStyleSheets)) {
        targetDoc.adoptedStyleSheets = targetDoc.adoptedStyleSheets.filter(s => s !== existing.node);
      } else if (existing.type === 'style') {
        existing.node.remove();
      }
      map.delete(id);
      return null;
    }

    if (existing) {
      if (existing.type === 'sheet') {
        existing.node.replaceSync(cssText);
        if (Array.isArray(targetDoc.adoptedStyleSheets) && !targetDoc.adoptedStyleSheets.includes(existing.node)) {
          targetDoc.adoptedStyleSheets = [...targetDoc.adoptedStyleSheets, existing.node];
        }
        return existing.node;
      }
      existing.node.textContent = cssText;
      return existing.node;
    }

    try {
      if (typeof CSSStyleSheet === 'function' && Array.isArray(targetDoc.adoptedStyleSheets) && typeof CSSStyleSheet.prototype?.replaceSync === 'function') {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(cssText);
        targetDoc.adoptedStyleSheets = [...targetDoc.adoptedStyleSheets, sheet];
        map.set(id, { type: 'sheet', node: sheet });
        return sheet;
      }
    } catch {}

    const style = targetDoc.createElement('style');
    style.setAttribute('data-rt-sheet', String(id));
    style.textContent = cssText;
    (targetDoc.head || targetDoc.documentElement || targetDoc).append(style);
    map.set(id, { type: 'style', node: style });
    return style;
  }

  globalThis.RTCore = Object.freeze({
    BOOT_KEY,
    settings,
    observer,
    routes,
    adoptStyles
  });
})();
