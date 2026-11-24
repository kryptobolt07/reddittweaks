/* Credential-free Visual Search broker for infini.wtf (worker-side transport, bounds, backoff, and cache). */
(() => {
  'use strict';
  if (globalThis.RTVisualSearchBroker) return;

  const Model = globalThis.RTVisualSearchModel;
  const PostModel = globalThis.RTPostModel;
  const DownloadModel = globalThis.RTDownloadModel;
  if (!Model) return;

  const MAX_HTML_BYTES = 2_000_000;
  const MAX_IMAGE_BYTES = 10_000_000;
  const MAX_VIDEO_BYTES = 16_000_000;
  const QUERY_TIMEOUT_MS = 12_000;
  const UPLOAD_TIMEOUT_MS = 20_000;
  const RELATED_TIMEOUT_MS = 6_000;
  const VIDEO_TIMEOUT_MS = 20_000;
  const CACHE_TTL_MS = 300_000;
  const MISS_TTL_MS = 60_000;
  const MAX_CACHE_ENTRIES = 30;
  const MAX_CONCURRENT = 3;
  const BACKOFF_KEY = 'rt-visual-backoff-v1';
  const MAX_COOLDOWN_MS = 3_600_000;

  const REDDIT_PAGE_HOSTS = new Set(['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com', 'sh.reddit.com']);
  const REDDIT_IMAGE_HOSTS = new Set(['i.redd.it', 'preview.redd.it', 'cf.preview.redd.it', 'external-preview.redd.it']);
  const ALLOWED_IMAGE_TYPES = new Map([
    ['image/webp', 'webp'],
    ['image/jpeg', 'jpg'],
    ['image/jpg', 'jpg'],
    ['image/png', 'png'],
    ['image/gif', 'gif']
  ]);

  const cache = new Map();
  const pendingReads = new Map();
  const waiters = [];
  let activeCount = 0;
  let cooldownUntil = 0;
  let unavailableUntil = 0;
  let unavailableCount = 0;
  let backoffLoaded = null;

  const api = () => globalThis.browser || globalThis.chrome;
  const fail = (error, code = 'visual-error', extra = {}) => ({ ok: false, error, code, ...extra });

  function senderAuthorized(sender) {
    const extId = api()?.runtime?.id;
    if (!sender || (extId && sender.id !== extId) || (sender.frameId != null && sender.frameId !== 0)) return false;
    try {
      const url = new URL(sender.url || sender.tab?.url || '');
      return url.protocol === 'https:' && REDDIT_PAGE_HOSTS.has(url.hostname) && !url.port;
    } catch { return false; }
  }

  async function featureEnabled() {
    try {
      const stored = await api()?.storage?.local?.get?.('rt-settings-v1');
      const raw = stored?.['rt-settings-v1'];
      if (PostModel?.normalizeSettings) return PostModel.normalizeSettings(raw).visualSearch;
      return raw?.visualSearch === true;
    } catch { return false; }
  }

  function clearCache({ nsfwOnly = false } = {}) {
    if (!nsfwOnly) {
      cache.clear();
      return;
    }
    for (const key of cache.keys()) {
      if (key.includes('|1|')) cache.delete(key);
    }
  }

  try {
    api()?.storage?.onChanged?.addListener((changes, area) => {
      if (area !== 'local' || !changes?.['rt-settings-v1']) return;
      const raw = changes['rt-settings-v1'].newValue;
      const enabled = PostModel?.normalizeSettings ? PostModel.normalizeSettings(raw).visualSearch : raw?.visualSearch === true;
      if (!enabled) clearCache();
    });
  } catch {}

  function persistBackoff() {
    try {
      Promise.resolve(api()?.storage?.session?.set?.({
        [BACKOFF_KEY]: { cooldownUntil, unavailableUntil, unavailableCount }
      })).catch(() => {});
    } catch {}
  }

  async function loadBackoff() {
    try {
      const stored = await api()?.storage?.session?.get?.(BACKOFF_KEY);
      const saved = stored?.[BACKOFF_KEY];
      const now = Date.now();
      if (!saved || typeof saved !== 'object') return;
      const clamp = v => Number.isFinite(v) ? Math.min(Math.max(0, v), now + MAX_COOLDOWN_MS) : 0;
      cooldownUntil = Math.max(cooldownUntil, clamp(saved.cooldownUntil));
      unavailableUntil = Math.max(unavailableUntil, clamp(saved.unavailableUntil));
      if (Number.isInteger(saved.unavailableCount)) {
        unavailableCount = Math.max(unavailableCount, Math.min(Math.max(0, saved.unavailableCount), 20));
      }
    } catch {}
  }
  backoffLoaded = loadBackoff();

  async function withSlot(fn) {
    if (activeCount >= MAX_CONCURRENT) await new Promise(resolve => waiters.push(resolve));
    else activeCount++;
    try {
      return await fn();
    } finally {
      const next = waiters.shift();
      if (next) next();
      else activeCount--;
    }
  }

  function getCached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      cache.delete(key);
      return null;
    }
    cache.delete(key);
    cache.set(key, entry);
    return entry.value;
  }

  function setCached(key, value, ttlMs = CACHE_TTL_MS) {
    if (!key) return;
    cache.delete(key);
    cache.set(key, { expiresAt: Date.now() + ttlMs, value });
    while (cache.size > MAX_CACHE_ENTRIES) {
      cache.delete(cache.keys().next().value);
    }
  }

  function recordCooldown(response) {
    const now = Date.now();
    const retry = response.headers?.get?.('Retry-After');
    let until = 0;
    if (retry) {
      const seconds = Number(retry);
      until = Number.isFinite(seconds) ? now + Math.max(1, seconds) * 1000 : (Date.parse(retry) || 0);
    }
    if (response.status === 429 && until <= now) until = now + 60_000;
    until = Math.min(until, now + MAX_COOLDOWN_MS);
    if (response.status === 429 && until > cooldownUntil) {
      cooldownUntil = until;
      persistBackoff();
    }
  }

  function markUnavailable(probe = false) {
    if (probe || unavailableUntil <= Date.now()) {
      unavailableCount++;
      unavailableUntil = Date.now() + Math.min(30_000 * 2 ** (unavailableCount - 1), 300_000);
      persistBackoff();
    }
    return fail('infini.wtf is temporarily unavailable.', 'unavailable', { retryAt: unavailableUntil });
  }

  function markAvailable() {
    if (unavailableUntil || unavailableCount) {
      unavailableUntil = 0;
      unavailableCount = 0;
      persistBackoff();
    }
  }

  async function readBoundedText(response, controller, maxBytes = MAX_HTML_BYTES) {
    if (Number(response.headers?.get?.('Content-Length')) > maxBytes) return null;
    let text = '';
    if (response.body?.getReader && typeof TextDecoder !== 'undefined') {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) {
            controller.abort();
            await reader.cancel().catch(() => {});
            return null;
          }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        reader.releaseLock?.();
      }
    } else {
      text = await response.text();
    }
    return text.length > maxBytes ? null : text;
  }

  async function readBoundedBytes(response, controller, maxBytes) {
    if (Number(response.headers?.get?.('Content-Length')) > maxBytes) return null;
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > maxBytes) {
            controller.abort();
            await reader.cancel().catch(() => {});
            return null;
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock?.();
      }
      const out = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return out;
    }
    const buf = new Uint8Array(await response.arrayBuffer());
    return buf.byteLength > maxBytes ? null : buf;
  }

  function bytesToBase64(bytes) {
    const chunk = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    const clean = String(b64 || '').replace(/^data:[^;]+;base64,/, '').trim();
    if (!clean || clean.length > Math.ceil(MAX_IMAGE_BYTES * 1.4)) return null;
    const binary = atob(clean);
    if (binary.length > MAX_IMAGE_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
  }

  async function fetchInfini(url, init = {}, { timeoutMs = QUERY_TIMEOUT_MS, force = false } = {}) {
    await backoffLoaded;
    await loadBackoff();
    const now = Date.now();
    if (cooldownUntil > now) return { early: fail('infini.wtf rate limit reached. Try again shortly.', 'rate-limited', { retryAt: cooldownUntil }) };
    if (unavailableUntil > now && !force) return { early: fail('infini.wtf is temporarily unavailable.', 'unavailable', { retryAt: unavailableUntil }) };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        redirect: 'follow',
        ...init,
        signal: controller.signal
      });
      recordCooldown(response);
      if (response.status === 429) {
        return { early: fail('infini.wtf rate limit reached. Try again shortly.', 'rate-limited', { retryAt: cooldownUntil || Date.now() + 60_000 }) };
      }
      if ([502, 503, 504].includes(response.status)) {
        return { early: markUnavailable(force && unavailableUntil > now) };
      }
      markAvailable();
      return { response, controller };
    } catch {
      return {
        early: fail(
          controller.signal.aborted ? 'Visual search timed out.' : 'Unable to reach infini.wtf.',
          controller.signal.aborted ? 'timeout' : 'network-error'
        )
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function dedupeRead(dedupeKey, run) {
    if (pendingReads.has(dedupeKey)) return pendingReads.get(dedupeKey);
    const promise = withSlot(run).finally(() => pendingReads.delete(dedupeKey));
    pendingReads.set(dedupeKey, promise);
    return promise;
  }

  async function runQuery(message) {
    const kind = ['search', 'subreddit', 'user', 'popular', 'view', 'upload'].includes(message.kind) ? message.kind : '';
    if (!kind) return fail('Unsupported visual search mode.', 'invalid-request');
    const pageRaw = Number.parseInt(message.page, 10);
    const page = Number.isInteger(pageRaw) && pageRaw >= 1 && pageRaw <= 50 ? pageRaw : 1;
    const filters = kind === 'view' ? Model.normalizeFilters(null) : Model.normalizeFilters(message.filters);
    const spec = { kind, target: message.target || message.slug || message.viewId || message.uuid || '', filters, page };
    const endpoint = Model.buildEndpoint(spec);
    if (!endpoint) return fail('Invalid visual search query.', 'invalid-request');

    const key = Model.cacheKey(spec);
    if (!message.force) {
      const hit = getCached(key);
      if (hit) return { ...hit, cached: true };
    }

    return dedupeRead('q:' + key, async () => {
      const accept = kind === 'user' ? 'text/vnd.turbo-stream.html, text/html' : 'text/vnd.turbo-stream.html';
      const first = await fetchInfini(endpoint, { method: 'GET', headers: { Accept: accept } }, { timeoutMs: QUERY_TIMEOUT_MS, force: Boolean(message.force) });
      if (first.early) return first.early;

      let { response, controller } = first;
      if (response.status === 204) {
        const result = { ok: true, items: [], skippedCount: 0, page, hasMore: false, nextPage: 0, endpointKind: kind, filterable: kind !== 'view', cached: false };
        setCached(key, result);
        return result;
      }
      if (!response.ok) {
        await response.body?.cancel?.().catch(() => {});
        return fail('Visual search returned HTTP ' + response.status + '.', 'http-error', { status: response.status });
      }

      let text = await readBoundedText(response, controller, MAX_HTML_BYTES);
      if (text == null) return fail('Visual search response exceeded the size limit.', 'invalid-response');

      // /view/<uuid> can 301-redirect to /view/<slug>-<uuid> without preserving .turbo_stream; retry once on the canonical turbo stream.
      if (kind === 'view' && !text.includes('grid-cell')) {
        const canonical = Model.parseViewUrl(response.url);
        if (canonical && canonical !== spec.target && !String(response.url || '').includes('.turbo_stream')) {
          const retryUrl = Model.buildEndpoint({ kind: 'view', target: canonical, page });
          if (retryUrl) {
            const second = await fetchInfini(retryUrl, { method: 'GET', headers: { Accept: 'text/vnd.turbo-stream.html' } }, { timeoutMs: QUERY_TIMEOUT_MS, force: Boolean(message.force) });
            if (!second.early && second.response.ok && second.response.status !== 204) {
              const secondText = await readBoundedText(second.response, second.controller, MAX_HTML_BYTES);
              if (secondText != null) text = secondText;
            }
          }
        }
      }

      const parsed = Model.parseGridCells(text);
      let items = parsed.items;
      if (filters.mediaType === 'videos') items = items.filter(it => it.isVideo && !it.isGif);
      else if (filters.mediaType === 'gifs') items = items.filter(it => it.isGif);
      else if (filters.mediaType === 'images') items = items.filter(it => !it.isVideo);
      const paging = Model.parseNextPage ? Model.parseNextPage(text, page) : { hasMore: false, nextPage: 0 };
      const result = {
        ok: true,
        items,
        skippedCount: parsed.skippedCount,
        page,
        hasMore: paging.hasMore,
        nextPage: paging.nextPage,
        endpointKind: kind,
        filterable: kind !== 'view',
        cached: false
      };
      setCached(key, result);
      return result;
    });
  }

  async function runRelated(message) {
    const query = String(message.query || '').trim().slice(0, 200);
    if (!query) return { ok: true, items: [] };
    const endpoint = Model.buildEndpoint({ kind: 'related', query });
    if (!endpoint) return { ok: true, items: [] };
    const key = 'rel|' + query.toLowerCase();
    const hit = getCached(key);
    if (hit) return { ...hit, cached: true };

    return dedupeRead(key, async () => {
      const res = await fetchInfini(endpoint, { method: 'GET', headers: { Accept: 'text/vnd.turbo-stream.html, application/json, text/html' } }, { timeoutMs: RELATED_TIMEOUT_MS });
      if (res.early) return { ok: true, items: [] };
      const { response, controller } = res;
      if (!response.ok || response.status === 204) {
        await response.body?.cancel?.().catch(() => {});
        return { ok: true, items: [] };
      }
      const text = await readBoundedText(response, controller, 250_000);
      const items = Model.parseSuggestions(text || '', query, 12);
      const out = { ok: true, items, cached: false };
      setCached(key, out);
      return out;
    });
  }

  async function runAutocomplete(message) {
    const query = String(message.query || '').trim().slice(0, 200);
    if (!query) return { ok: true, items: [] };
    const endpoint = Model.buildEndpoint({ kind: 'autocomplete', query });
    if (!endpoint) return { ok: true, items: [] };
    const key = 'ac|' + query.toLowerCase();
    const hit = getCached(key);
    if (hit) return hit;

    return dedupeRead(key, async () => {
      const res = await fetchInfini(endpoint, { method: 'GET', headers: { Accept: 'text/vnd.turbo-stream.html, application/json, text/html' } }, { timeoutMs: RELATED_TIMEOUT_MS });
      if (res.early) return { ok: true, items: [] };
      const { response, controller } = res;
      if (!response.ok || response.status === 204) {
        await response.body?.cancel?.().catch(() => {});
        return { ok: true, items: [] };
      }
      const text = await readBoundedText(response, controller, 150_000);
      const items = Model.parseSuggestions(text || '', query, 8);
      const out = { ok: true, items };
      setCached(key, out);
      return out;
    });
  }

  async function resolvePost(message) {
    const sub = String(message.subreddit || '').replace(/^r\//i, '').trim().toLowerCase();
    const postId = String(message.postId || '').replace(/^t3_/i, '').trim().toLowerCase();
    const endpoint = Model.buildEndpoint({ kind: 'permalink', subreddit: sub, postId });
    if (!endpoint) return fail('Invalid Reddit post reference.', 'invalid-request');

    const key = 'post|' + sub + '|' + postId;
    if (!message.force) {
      const hit = getCached(key);
      if (hit) return { ...hit, cached: true };
    }

    return dedupeRead(key, async () => {
      let res = await fetchInfini(endpoint, { method: 'HEAD' }, { timeoutMs: QUERY_TIMEOUT_MS, force: Boolean(message.force) });
      if (!res.early && (res.response.status === 405 || res.response.status === 501)) {
        await res.response.body?.cancel?.().catch(() => {});
        res = await fetchInfini(endpoint, { method: 'GET', headers: { Accept: 'text/html' } }, { timeoutMs: QUERY_TIMEOUT_MS, force: Boolean(message.force) });
      }
      if (res.early) return res.early;
      const { response } = res;
      await response.body?.cancel?.().catch(() => {});
      const viewId = Model.parseViewUrl(response.url);
      if (viewId) {
        const result = { ok: true, indexed: true, viewId, cached: false };
        setCached(key, result, CACHE_TTL_MS);
        return result;
      }
      if (response.status === 404 || response.ok) {
        const result = { ok: true, indexed: false, cached: false };
        setCached(key, result, MISS_TTL_MS);
        return result;
      }
      return fail('Could not check this post on infini.wtf (HTTP ' + response.status + ').', 'http-error', { status: response.status });
    });
  }

  async function checkImageQuery(message) {
    const hash = String(message.hash || '').trim().toLowerCase();
    const endpoint = Model.buildEndpoint({ kind: 'image-query', hash });
    if (!endpoint) return fail('Invalid image hash.', 'invalid-request');

    return withSlot(async () => {
      const res = await fetchInfini(endpoint, { method: 'GET', headers: { Accept: 'application/json' } }, { timeoutMs: QUERY_TIMEOUT_MS, force: Boolean(message.force) });
      if (res.early) return res.early;
      const { response, controller } = res;
      if (response.status === 404) return { ok: true, exists: false, hasEmbedding: false, uuid: '' };
      if (!response.ok) {
        await response.body?.cancel?.().catch(() => {});
        return fail('Could not check upload status (HTTP ' + response.status + ').', 'http-error', { status: response.status });
      }
      const text = await readBoundedText(response, controller, 100_000);
      if (text == null) return fail('Upload status response too large.', 'invalid-response');
      let json;
      try { json = JSON.parse(text); } catch { return fail('Unreadable upload status response.', 'invalid-response'); }
      const uuid = typeof json?.uuid === 'string' && Model.UUID_RE.test(json.uuid) ? json.uuid : '';
      return {
        ok: true,
        exists: Boolean(uuid || json?.id != null || json?.has_embedding != null),
        hasEmbedding: json?.has_embedding === true && Boolean(uuid),
        uuid
      };
    });
  }

  function safeRedditImage(value) {
    try {
      const url = new URL(String(value || '').replace(/&amp;/gi, '&'));
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && REDDIT_IMAGE_HOSTS.has(url.hostname.toLowerCase())
        ? url.href : '';
    } catch { return ''; }
  }

  async function uploadImage(message) {
    let bytes = null;
    let mimeType = 'image/webp';
    let ext = 'webp';

    if (typeof message.dataBase64 === 'string' && message.dataBase64) {
      const mapped = ALLOWED_IMAGE_TYPES.get(String(message.mimeType || '').toLowerCase());
      if (!mapped) return fail('Unsupported image format.', 'invalid-request');
      mimeType = String(message.mimeType).toLowerCase() === 'image/jpg' ? 'image/jpeg' : String(message.mimeType).toLowerCase();
      ext = mapped;
      try { bytes = base64ToBytes(message.dataBase64); } catch { return fail('Invalid image data.', 'invalid-request'); }
      if (!bytes || !bytes.byteLength) return fail('Image file is empty or too large (max 10 MB).', 'invalid-request');
    } else if (message.redditImageUrl) {
      const redditUrl = safeRedditImage(message.redditImageUrl);
      if (!redditUrl) return fail('Only Reddit image URLs can be uploaded directly.', 'invalid-request');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
      try {
        const res = await fetch(redditUrl, { credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal });
        if (!res.ok) return fail('Could not read the Reddit image for visual search.', 'reddit-image-error');
        const ctype = String(res.headers?.get?.('Content-Type') || '').split(';', 1)[0].trim().toLowerCase();
        if (ctype && ALLOWED_IMAGE_TYPES.has(ctype)) {
          mimeType = ctype === 'image/jpg' ? 'image/jpeg' : ctype;
          ext = ALLOWED_IMAGE_TYPES.get(ctype);
        }
        bytes = await readBoundedBytes(res, controller, MAX_IMAGE_BYTES);
        if (!bytes || !bytes.byteLength) return fail('Post image exceeds the 10 MB visual search limit.', 'invalid-request');
      } catch {
        return fail('Could not read the Reddit image directly.', 'reddit-image-error');
      } finally {
        clearTimeout(timer);
      }
    } else {
      return fail('Provide an image file to search.', 'invalid-request');
    }

    const hash = await sha256Hex(bytes);
    return withSlot(async () => {
      // Hash check first: skip uploading completely when infini.wtf already indexed this image.
      const statusUrl = Model.buildEndpoint({ kind: 'image-query', hash });
      const checkRes = await fetchInfini(statusUrl, { method: 'GET', headers: { Accept: 'application/json' } }, { timeoutMs: QUERY_TIMEOUT_MS, force: Boolean(message.force) });
      if (!checkRes.early && checkRes.response.ok) {
        const checkText = await readBoundedText(checkRes.response, checkRes.controller, 100_000);
        try {
          const json = JSON.parse(checkText || '');
          const uuid = typeof json?.uuid === 'string' && Model.UUID_RE.test(json.uuid) ? json.uuid : '';
          if (uuid) {
            return { ok: true, hash, uuid, hasEmbedding: json?.has_embedding === true, uploaded: false };
          }
        } catch {}
      } else if (!checkRes.early) {
        await checkRes.response.body?.cancel?.().catch(() => {});
      }

      const form = new FormData();
      form.append('image', new Blob([bytes], { type: mimeType }), 'query.' + ext);
      form.append('image_hash', hash);

      const postUrl = Model.buildEndpoint({ kind: 'image-upload' });
      const uploadRes = await fetchInfini(postUrl, { method: 'POST', body: form, headers: { Accept: 'application/json, text/vnd.turbo-stream.html' } }, { timeoutMs: UPLOAD_TIMEOUT_MS, force: Boolean(message.force) });
      if (uploadRes.early) return uploadRes.early;

      const { response, controller } = uploadRes;
      if (!response.ok) {
        await response.body?.cancel?.().catch(() => {});
        return fail('Image upload failed (HTTP ' + response.status + ').', 'http-error', { status: response.status });
      }

      const bodyText = await readBoundedText(response, controller, 250_000);
      let uuid = '';
      let hasEmbedding = false;
      const uploadRedirect = /\/search-by-upload\/([A-Za-z0-9_-]{4,80})/.exec(response.url || '');
      if (uploadRedirect && Model.UUID_RE.test(uploadRedirect[1])) uuid = uploadRedirect[1];

      if (bodyText && (bodyText.trim()[0] === '{' || bodyText.includes('"uuid"'))) {
        try {
          const json = JSON.parse(bodyText);
          if (typeof json?.uuid === 'string' && Model.UUID_RE.test(json.uuid)) uuid = json.uuid;
          hasEmbedding = json?.has_embedding === true;
        } catch {}
      }
      if (!uuid && bodyText) {
        const match = bodyText.match(/\/search-by-upload\/([A-Za-z0-9_-]{4,80})/);
        if (match && Model.UUID_RE.test(match[1])) uuid = match[1];
      }
      if (!uuid) {
        const pollRes = await fetchInfini(statusUrl, { method: 'GET', headers: { Accept: 'application/json' } }, { timeoutMs: QUERY_TIMEOUT_MS });
        if (!pollRes.early && pollRes.response.ok) {
          const pollText = await readBoundedText(pollRes.response, pollRes.controller, 100_000);
          try {
            const json = JSON.parse(pollText || '');
            if (typeof json?.uuid === 'string' && Model.UUID_RE.test(json.uuid)) uuid = json.uuid;
            hasEmbedding = json?.has_embedding === true;
          } catch {}
        }
      }

      return { ok: true, hash, uuid, hasEmbedding: hasEmbedding && Boolean(uuid), uploaded: true };
    });
  }

  async function fetchVideo(message) {
    const videoUrl = Model.safeVideoUrl(message.url);
    if (!videoUrl) return fail('Invalid visual video URL.', 'invalid-request');
    return dedupeRead('vid|' + videoUrl, async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), VIDEO_TIMEOUT_MS);
      try {
        const response = await fetch(videoUrl, {
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          redirect: 'error',
          signal: controller.signal
        });
        if (!response.ok) {
          await response.body?.cancel?.().catch(() => {});
          return fail('Video preview unavailable (HTTP ' + response.status + ').', 'http-error');
        }
        const bytes = await readBoundedBytes(response, controller, MAX_VIDEO_BYTES);
        if (!bytes || !bytes.byteLength) return fail('Video preview exceeds size limit.', 'invalid-response');
        return { ok: true, base64: bytesToBase64(bytes), mimeType: 'video/mp4', bytes: bytes.byteLength };
      } catch {
        return fail('Video preview failed to load.', 'network-error');
      } finally {
        clearTimeout(timer);
      }
    });
  }

  function cleanDownloadFilename(value, fallback = 'visual-result.webp') {
    if (DownloadModel?.safeFilename) {
      const base = String(value || '').replace(/[\\/]/g, '-');
      return DownloadModel.safeFilename(base, fallback);
    }
    const clean = String(value || '').replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '-').trim().slice(0, 140);
    return clean || fallback;
  }

  async function downloadMedia(message) {
    const rawUrl = message.url;
    const safeUrl = Model.safeDownloadUrl(rawUrl) || Model.safeImageUrl(rawUrl) || Model.safeVideoUrl(rawUrl);
    if (!safeUrl) return fail('Invalid visual media download URL.', 'invalid-request');
    const filename = cleanDownloadFilename(message.filename, safeUrl.includes('.mp4') ? 'visual-result.mp4' : 'visual-result.webp');
    const runtime = api();
    if (!runtime?.downloads?.download) return fail('Downloads are unavailable.', 'unavailable');
    try {
      await new Promise((resolve, reject) => {
        let settled = false;
        const done = (id, err) => {
          if (settled) return;
          settled = true;
          if (err) reject(err);
          else if (Number.isInteger(id) && id > 0) resolve(id);
          else reject(Error('Download did not start.'));
        };
        const out = runtime.downloads.download({ url: safeUrl, filename, conflictAction: 'uniquify', saveAs: false }, id => {
          const err = runtime.runtime?.lastError;
          done(id, err ? Error(err.message || 'Download failed.') : null);
        });
        if (out && typeof out.then === 'function') out.then(id => done(id), err => done(null, err));
        else if (out !== undefined) done(out);
      });
      return { ok: true };
    } catch (error) {
      return fail(error?.message || 'Unable to download visual media.', 'download-error');
    }
  }

  async function hostAccess() {
    const perms = api()?.permissions;
    if (!perms?.contains) return true;
    try { return await perms.contains({ origins: ['https://infini.wtf/*', 'https://video.infini.wtf/*'] }); }
    catch { return true; }
  }

  async function handle(message, sender) {
    if (!senderAuthorized(sender)) return fail('Visual search must start from a Reddit page.', 'forbidden');
    if (message?.action === 'clear-cache') {
      clearCache({ nsfwOnly: message.nsfwOnly === true });
      return { ok: true, cleared: true };
    }
    if (!await featureEnabled()) {
      clearCache();
      return fail('Enable Visual search in Reddit Tweaks settings.', 'disabled');
    }
    // Site access can be withheld after install (Chrome site access, Firefox optional host permissions).
    if (message?.action !== 'download' && !await hostAccess()) {
      return fail('Reddit Tweaks can’t reach infini.wtf. Open the extension popup, turn Visual search off and on, and choose Allow.', 'permission-required');
    }
    switch (message?.action) {
      case 'query': return runQuery(message);
      case 'related': return runRelated(message);
      case 'autocomplete': return runAutocomplete(message);
      case 'resolve-post': return resolvePost(message);
      case 'check-image-query': return checkImageQuery(message);
      case 'upload-image': return uploadImage(message);
      case 'fetch-video': return fetchVideo(message);
      case 'download': return downloadMedia(message);
      default: return fail('Unknown visual search action.', 'invalid-request');
    }
  }

  try {
    api()?.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
      if (message?.scope !== 'rt-visual-search') return;
      handle(message, sender).then(
        result => sendResponse(result),
        () => sendResponse(fail('Visual search request failed.', 'network-error'))
      );
      return true;
    });
  } catch {}

  globalThis.RTVisualSearchBroker = Object.freeze({ handle, clearCache });
})();
