/* Pure URL builders, filter normalization, and defensive Turbo Stream parsing for Visual Search (infini.wtf).
   Shared by the worker broker and page UI. Never constructs or runs DOM HTML sinks, never uses gay/trans filters,
   and keeps 18+ results off by default. */
(() => {
  'use strict';
  if (globalThis.RTVisualSearchModel) return;

  const BASE = 'https://infini.wtf';
  const IMAGE_HOST = 'image.infini.wtf';
  const VIDEO_HOST = 'video.infini.wtf';
  const ORIGINS = Object.freeze([
    'https://infini.wtf/*',
    'https://video.infini.wtf/*'
  ]);
  const MEDIA_TYPES = Object.freeze(['images', 'gifs', 'videos']);
  const TIMES = Object.freeze(['year', 'month']);
  const RESULT_LIMIT = 10;
  const MAX_PAGE = 50;

  const UUID_RE = /^[A-Za-z0-9_-]{4,80}$/;
  const VIEW_RE = /^[A-Za-z0-9_-]{4,220}$/;
  const HASH_RE = /^[a-f0-9]{64}$/;
  const SUB_RE = /^[A-Za-z0-9_]{2,24}$/;
  const USER_RE = /^[A-Za-z0-9_-]{1,24}$/;
  const POST_ID_RE = /^[a-z0-9]{1,12}$/i;
  const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,180}$/i;

  const str = (value, max = 500) => typeof value === 'string'
    ? value.slice(0, max).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    : '';

  function decodeEntities(text) {
    return String(text || '').replace(
      /&(#\d+|#x[0-9a-f]+|quot|apos|amp|lt|gt|nbsp|#39);/gi,
      (full, code) => {
        const lower = code.toLowerCase();
        if (lower === 'quot') return '"';
        if (lower === 'apos' || lower === '#39') return "'";
        if (lower === 'amp') return '&';
        if (lower === 'lt') return '<';
        if (lower === 'gt') return '>';
        if (lower === 'nbsp') return ' ';
        const point = lower.startsWith('#x')
          ? parseInt(lower.slice(2), 16)
          : parseInt(lower.slice(1), 10);
        if (!Number.isInteger(point) || point <= 0 || point > 0x10ffff) return '';
        try { return String.fromCodePoint(point); } catch { return ''; }
      }
    );
  }

  function slugifyQuery(text) {
    const cleaned = decodeEntities(str(text, 300))
      .trim()
      .toLowerCase()
      .replace(/['’`]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120)
      .replace(/-+$/, '');
    return cleaned;
  }

  // Strip Reddit-only query operators (subreddit:, r/, flair:, nsfw:, author:, self:, site:, url:, title:, body:)
  // before building a keyword slug, surfacing what was scoped or stripped honestly.
  function normalizeQuery(raw) {
    let text = str(raw, 300).trim();
    const stripped = [];
    let scopedSubreddit = '';
    let scopedAuthor = '';
    if (text) {
      const patterns = [
        { re: /(?:^|\s)(?:-?subreddit:|\/?r\/)([A-Za-z0-9_]{2,24})(?=\s|$)/gi, kind: 'subreddit' },
        { re: /(?:^|\s)-?author:([A-Za-z0-9_-]{1,24})(?=\s|$)/gi, kind: 'author' },
        { re: /(?:^|\s)-?u\/([A-Za-z0-9_-]{1,24})(?=\s|$)/gi, kind: 'author' },
        { re: /(?:^|\s)-?flair:(?:"(?:[^"\\]|\\.)*"|\S+)/gi, kind: 'flair' },
        { re: /(?:^|\s)-?nsfw:(?:yes|no|true|false|1|0)\b/gi, kind: 'nsfw' },
        { re: /(?:^|\s)-?self:(?:yes|no|true|false|1|0)\b/gi, kind: 'self' },
        { re: /(?:^|\s)-?spoiler:(?:yes|no|true|false|1|0)\b/gi, kind: 'spoiler' },
        { re: /(?:^|\s)-?type:(?:[a-z]+)\b/gi, kind: 'type' },
        { re: /(?:^|\s)-?(?:site|url):\S+/gi, kind: 'site' }
      ];
      for (const { re, kind } of patterns) {
        text = text.replace(re, (match, cap) => {
          const token = match.trim();
          if (token) stripped.push(token);
          if (kind === 'subreddit' && cap && SUB_RE.test(cap) && !scopedSubreddit) scopedSubreddit = cap;
          if (kind === 'author' && cap && USER_RE.test(cap) && !scopedAuthor) scopedAuthor = cap;
          return ' ';
        });
      }
      text = text.replace(/\b(?:title|selftext|body):/gi, match => {
        stripped.push(match.trim());
        return '';
      });
      text = text.replace(/\s+/g, ' ').trim();
    }
    return {
      text,
      slug: slugifyQuery(text),
      stripped: [...new Set(stripped)],
      scopedSubreddit,
      scopedAuthor
    };
  }

  // Strictly permit only nsfw (default false), mediaType, and time.
  // Never store, accept, or emit gay or trans subcategories.
  function normalizeFilters(raw) {
    const mediaType = MEDIA_TYPES.includes(raw?.mediaType) ? raw.mediaType : '';
    const time = TIMES.includes(raw?.time) ? raw.time : '';
    return {
      nsfw: raw?.nsfw === true,
      mediaType,
      time
    };
  }

  function normalizePage(value) {
    const num = Number.parseInt(value, 10);
    return Number.isInteger(num) && num >= 1 && num <= MAX_PAGE ? num : 1;
  }

  function applyFilterParams(url, rawFilters, { includePage = true, allowFilters = true, page = 1 } = {}) {
    if (includePage) url.searchParams.set('page', String(normalizePage(page)));
    if (!allowFilters) return url;
    const filters = normalizeFilters(rawFilters);
    // Literal true only; omit for safe/default mode so safe results remain separate.
    if (filters.nsfw) url.searchParams.set('nsfw', 'true');
    if (filters.mediaType) url.searchParams.set('media_type', filters.mediaType);
    if (filters.time) url.searchParams.set('time', filters.time);
    return url;
  }

  function buildEndpoint(spec) {
    if (!spec || typeof spec !== 'object') return '';
    const kind = spec.kind;
    const page = normalizePage(spec.page);
    if (kind === 'search') {
      const slug = SLUG_RE.test(spec.slug || '') ? spec.slug.toLowerCase() : slugifyQuery(spec.target || spec.query || '');
      if (!slug || !SLUG_RE.test(slug)) return '';
      const url = new URL(BASE + '/search/' + encodeURIComponent(slug) + '.turbo_stream');
      return applyFilterParams(url, spec.filters, { page }).href;
    }
    if (kind === 'subreddit') {
      const sub = str(spec.target || spec.subreddit, 24).trim().replace(/^r\//i, '').toLowerCase();
      if (!SUB_RE.test(sub)) return '';
      const url = new URL(BASE + '/search/r/' + encodeURIComponent(sub));
      url.searchParams.set('format', 'turbo_stream');
      return applyFilterParams(url, spec.filters, { page }).href;
    }
    if (kind === 'user') {
      const user = str(spec.target || spec.username, 24).trim().replace(/^u\//i, '');
      if (!USER_RE.test(user)) return '';
      const url = new URL(BASE + '/search/u/' + encodeURIComponent(user));
      return applyFilterParams(url, spec.filters, { page }).href;
    }
    if (kind === 'popular') {
      const url = new URL(BASE + '/popular.turbo_stream');
      return applyFilterParams(url, spec.filters, { page }).href;
    }
    if (kind === 'view') {
      const viewId = str(spec.target || spec.viewId, 220).trim();
      if (!VIEW_RE.test(viewId)) return '';
      // /view/... does not support filter params (nsfw/media_type/time are ignored by infini.wtf).
      const url = new URL(BASE + '/view/' + encodeURIComponent(viewId) + '.turbo_stream');
      return applyFilterParams(url, null, { includePage: true, allowFilters: false, page }).href;
    }
    if (kind === 'upload') {
      const uuid = str(spec.target || spec.uuid, 80).trim();
      if (!UUID_RE.test(uuid)) return '';
      const url = new URL(BASE + '/search-by-upload/' + encodeURIComponent(uuid) + '.turbo_stream');
      return applyFilterParams(url, spec.filters, { page }).href;
    }
    if (kind === 'permalink') {
      // /r/<subreddit>/comments/<postId>/ was case-sensitive (lowercase works; mixed-case can redirect to /).
      const sub = str(spec.subreddit, 24).trim().replace(/^r\//i, '').toLowerCase();
      const postId = str(spec.postId, 16).trim().replace(/^t3_/i, '').toLowerCase();
      if (!SUB_RE.test(sub) || !POST_ID_RE.test(postId)) return '';
      return BASE + '/r/' + encodeURIComponent(sub) + '/comments/' + encodeURIComponent(postId) + '/';
    }
    if (kind === 'related') {
      const q = str(spec.target || spec.query, 200).trim();
      if (!q) return '';
      const url = new URL(BASE + '/related_searches');
      url.searchParams.set('query', q);
      return url.href;
    }
    if (kind === 'autocomplete') {
      const q = str(spec.target || spec.query, 200).trim();
      if (!q) return '';
      const url = new URL(BASE + '/autocomplete');
      url.searchParams.set('query', q);
      return url.href;
    }
    if (kind === 'image-query') {
      const hash = str(spec.hash || spec.target, 64).trim().toLowerCase();
      if (!HASH_RE.test(hash)) return '';
      return BASE + '/image-queries/' + hash;
    }
    if (kind === 'image-upload') {
      return BASE + '/image-queries';
    }
    return '';
  }

  // Cache keys always include every filter parameter and page (especially nsfw) so safe/18+ and pages never collide.
  function cacheKey(spec) {
    if (!spec || typeof spec !== 'object') return '';
    const kind = String(spec.kind || '');
    const filters = kind === 'view' ? { nsfw: false, mediaType: '', time: '' } : normalizeFilters(spec.filters);
    const target = String(spec.slug || spec.target || spec.viewId || spec.uuid || '').trim().toLowerCase();
    const page = normalizePage(spec.page);
    return [kind, target, filters.nsfw ? '1' : '0', filters.mediaType || '-', filters.time || '-', 'p' + page].join('|');
  }

  function safeImageUrl(value) {
    const raw = decodeEntities(str(value, 2048)).trim();
    if (!raw || raw.length > 2048) return '';
    try {
      const url = raw.startsWith('/') && !raw.startsWith('//') ? new URL(raw, BASE) : new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
      if (url.hostname === IMAGE_HOST) return url.href;
      if (url.hostname === 'infini.wtf' && /^\/download\/[A-Za-z0-9_-]{4,80}$/.test(url.pathname)) return url.href;
      return '';
    } catch { return ''; }
  }

  function safeSrcset(value) {
    const raw = decodeEntities(str(value, 4096)).trim();
    if (!raw) return '';
    const entries = [];
    for (const part of raw.split(',').slice(0, 12)) {
      const trimmed = part.trim();
      if (!trimmed) continue;
      const pieces = trimmed.split(/\s+/);
      const url = safeImageUrl(pieces[0]);
      if (!url) continue;
      const desc = pieces[1] || '';
      if (desc && !/^\d+(?:\.\d+)?[wx]$/i.test(desc)) continue;
      entries.push(desc ? url + ' ' + desc : url);
    }
    return entries.join(', ');
  }

  function safeVideoUrl(value) {
    const raw = decodeEntities(str(value, 2048)).trim();
    if (!raw || raw.length > 2048) return '';
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return '';
      if (url.hostname !== VIDEO_HOST) return '';
      if (!/\.mp4$/i.test(url.pathname)) return '';
      return url.href;
    } catch { return ''; }
  }

  function safeDownloadUrl(value, uuid = '') {
    const raw = decodeEntities(str(value, 1024)).trim();
    if (raw) {
      try {
        const url = raw.startsWith('/') && !raw.startsWith('//') ? new URL(raw, BASE) : new URL(raw);
        if (
          url.protocol === 'https:' &&
          url.hostname === 'infini.wtf' &&
          !url.username && !url.password && !url.port &&
          /^\/download\/[A-Za-z0-9_-]{4,80}$/.test(url.pathname)
        ) {
          return url.href;
        }
      } catch {}
    }
    if (UUID_RE.test(uuid)) return BASE + '/download/' + uuid + '?is_animated=false';
    return '';
  }

  function safeRedditPermalink(value) {
    const raw = decodeEntities(str(value, 4096));
    if (!raw) return null;
    const match = raw.match(/https?:\/\/(?:(?:www|old|new|sh|m)\.)?reddit\.com(\/(?:r\/([A-Za-z0-9_]{2,24})|u(?:ser)?\/([A-Za-z0-9_-]{1,24}))\/comments\/([A-Za-z0-9]{1,12})(?:\/[^\s"'<>?#\\]*)?)/i);
    if (match) {
      try {
        const url = new URL(match[1], 'https://www.reddit.com');
        if (url.protocol !== 'https:' || url.hostname !== 'www.reddit.com' || url.username || url.password || url.port) return null;
        return { permalink: url.href, subreddit: match[2] || (match[3] ? 'u_' + match[3] : ''), postId: match[4].toLowerCase() };
      } catch { return null; }
    }
    const bare = raw.match(/(?:^|[\s"'])(\/(?:r\/([A-Za-z0-9_]{2,24})|u(?:ser)?\/([A-Za-z0-9_-]{1,24}))\/comments\/([A-Za-z0-9]{1,12})(?:\/[^\s"'<>?#\\]*)?)/i);
    if (!bare) return null;
    try {
      const url = new URL(bare[1], 'https://www.reddit.com');
      if (url.hostname !== 'www.reddit.com') return null;
      return { permalink: url.href, subreddit: bare[2] || (bare[3] ? 'u_' + bare[3] : ''), postId: bare[4].toLowerCase() };
    } catch { return null; }
  }

  function parseViewUrl(value) {
    const raw = str(value, 1024).trim();
    if (!raw) return '';
    try {
      const url = raw.startsWith('/') && !raw.startsWith('//') ? new URL(raw, BASE) : new URL(raw);
      if (url.protocol !== 'https:' || url.hostname !== 'infini.wtf' || url.username || url.password || url.port) return '';
      const match = /^\/view\/([A-Za-z0-9_-]{4,220})(?:\.turbo_stream)?\/?$/.exec(url.pathname);
      return match ? match[1] : '';
    } catch { return ''; }
  }

  // Linear, quote-aware opening tag scanner: avoids regex backtracking and prevents '>' inside quoted
  // attributes like data-sub-html="<div ...>" from splitting an element tag early.
  function scanTags(html, onTag) {
    const text = String(html || '');
    const len = text.length;
    let i = 0;
    while (i < len) {
      const lt = text.indexOf('<', i);
      if (lt < 0) break;
      const next = text.charCodeAt(lt + 1);
      // Skip comments, declarations, closing tags.
      if (next === 33 || next === 47 || next === 63 || !(next >= 65 && next <= 90 || next >= 97 && next <= 122)) {
        i = lt + 1;
        continue;
      }
      let pos = lt + 1;
      let quote = 0;
      while (pos < len) {
        const ch = text.charCodeAt(pos);
        if (quote) {
          if (ch === quote) quote = 0;
        } else if (ch === 34 || ch === 39) {
          quote = ch;
        } else if (ch === 62) {
          break;
        }
        pos++;
      }
      if (pos >= len) break;
      const rawTag = text.slice(lt + 1, pos);
      const attrs = parseAttributes(rawTag);
      if (attrs && onTag(attrs, pos + 1, lt, text) === false) break;
      i = pos + 1;
    }
  }

  function parseAttributes(rawTag) {
    const space = rawTag.search(/[\s/]/);
    const tag = (space < 0 ? rawTag : rawTag.slice(0, space)).toLowerCase();
    const attrs = Object.create(null);
    let i = space < 0 ? rawTag.length : space;
    const len = rawTag.length;
    while (i < len) {
      while (i < len && (rawTag.charCodeAt(i) <= 32 || rawTag[i] === '/')) i++;
      if (i >= len) break;
      const nameStart = i;
      while (i < len && rawTag[i] !== '=' && rawTag.charCodeAt(i) > 32 && rawTag[i] !== '/') i++;
      const name = rawTag.slice(nameStart, i).toLowerCase();
      if (!name) { i++; continue; }
      while (i < len && rawTag.charCodeAt(i) <= 32) i++;
      let value = '';
      if (rawTag[i] === '=') {
        i++;
        while (i < len && rawTag.charCodeAt(i) <= 32) i++;
        if (rawTag[i] === '"' || rawTag[i] === "'") {
          const q = rawTag[i++];
          const start = i;
          while (i < len && rawTag[i] !== q) i++;
          value = decodeEntities(rawTag.slice(start, i));
          if (i < len) i++;
        } else {
          const start = i;
          while (i < len && rawTag.charCodeAt(i) > 32) i++;
          value = decodeEntities(rawTag.slice(start, i));
        }
      }
      attrs[name] = value;
    }
    return { tag, attrs };
  }

  function extractVideoFromAttr(raw) {
    const empty = { url: '', hasControls: false, isMuted: false };
    const decoded = decodeEntities(str(raw, 8192)).trim();
    if (!decoded) return empty;
    try {
      const parsed = JSON.parse(decoded);
      const sources = Array.isArray(parsed?.source) ? parsed.source
        : Array.isArray(parsed?.sources) ? parsed.sources : [];
      const attrs = parsed?.attributes && typeof parsed.attributes === 'object' ? parsed.attributes : {};
      for (const entry of sources.slice(0, 8)) {
        const url = safeVideoUrl(entry?.src || entry?.url);
        if (url) {
          return {
            url,
            hasControls: Boolean(attrs.controls),
            isMuted: Boolean(attrs.muted)
          };
        }
      }
    } catch {}
    return empty;
  }

  function extractDimensions(attrs) {
    let width = 0;
    let height = 0;
    let ratio = 0;
    const sizeMatch = /^(\d{1,5})[-x](\d{1,5})$/i.exec(str(attrs['data-lg-size'] || '', 32).trim());
    if (sizeMatch) {
      const w = Number(sizeMatch[1]);
      const h = Number(sizeMatch[2]);
      if (w > 0 && w <= 20000 && h > 0 && h <= 20000) {
        width = w;
        height = h;
        ratio = w / h;
      }
    }
    if (!ratio && attrs.style) {
      const arMatch = /aspect-ratio\s*:\s*([0-9]+(?:\.[0-9]+)?)(?:\s*\/\s*([0-9]+(?:\.[0-9]+)?))?/i.exec(String(attrs.style));
      if (arMatch) {
        const num = Number(arMatch[1]);
        const den = arMatch[2] ? Number(arMatch[2]) : 1;
        if (num > 0 && den > 0) ratio = num / den;
      }
    }
    const aspectRatio = ratio > 0 && Number.isFinite(ratio)
      ? Number(Math.min(2.4, Math.max(0.42, ratio)).toFixed(4))
      : 0;
    return { width, height, aspectRatio };
  }

  function parseNextPage(html, currentPage = 1) {
    const raw = String(html || '');
    const cur = normalizePage(currentPage);
    if (!raw) return { hasMore: false, nextPage: 0 };
    let nextPage = 0;
    scanTags(raw, ({ attrs }) => {
      const val = attrs['data-infinite-scroll-url-value'];
      if (!val) return;
      try {
        const url = new URL(decodeEntities(val), BASE);
        if (url.origin !== BASE) return;
        const p = Number.parseInt(url.searchParams.get('page') || '', 10);
        if (Number.isInteger(p) && p > cur && p <= MAX_PAGE) {
          nextPage = p;
          return false;
        }
      } catch {}
    });
    return { hasMore: nextPage > cur, nextPage };
  }

  function parseGridCells(html) {
    const raw = String(html || '');
    if (!raw) return { items: [], skippedCount: 0 };
    const cells = [];
    scanTags(raw, ({ attrs }, afterTag, tagStart) => {
      const cls = attrs.class ? ' ' + attrs.class + ' ' : '';
      const hasClass = /\sgrid-cell\s/i.test(cls);
      const hasUuid = Boolean(attrs['data-uuid'] && UUID_RE.test(attrs['data-uuid'].trim()));
      if (hasClass || (hasUuid && (attrs['data-src'] || attrs['data-poster'] || attrs['data-video'] || attrs['data-sub-html']))) {
        cells.push({ attrs, start: afterTag, tagStart });
      }
    });

    const items = [];
    const seen = new Set();
    let skippedCount = 0;

    for (let idx = 0; idx < cells.length && items.length < 40; idx++) {
      const { attrs, start } = cells[idx];
      const nextStart = cells[idx + 1] ? cells[idx + 1].tagStart : Math.min(raw.length, start + 4000);
      const snippet = raw.slice(start, nextStart);
      const uuid = str(attrs['data-uuid'] || '', 80).trim();
      if (!UUID_RE.test(uuid)) {
        skippedCount++;
        continue;
      }
      if (seen.has(uuid)) continue;

      const video = extractVideoFromAttr(attrs['data-video']);
      const videoUrl = video.url;
      const innerImg = snippet.match(/<img\b[^>]*\b(?:data-src|src)\s*=\s*["']([^"']+)["']/i)?.[1] || '';
      const thumb = safeImageUrl(attrs['data-poster'] || attrs['data-src'] || innerImg);
      const src = safeImageUrl(attrs['data-src'] || attrs['data-poster'] || innerImg);
      const srcset = safeSrcset(attrs['data-srcset']);
      if (!thumb && !src && !videoUrl) {
        skippedCount++;
        continue;
      }

      const title = decodeEntities(str(attrs['data-title'] || attrs.title || '', 500)).replace(/\s+/g, ' ').trim();
      const subHtml = str(attrs['data-sub-html'] || '', 4096);
      const linkInfo = safeRedditPermalink(subHtml) || safeRedditPermalink(snippet);
      if (!linkInfo) {
        skippedCount++;
        continue;
      }

      let viewId = '';
      const viewHref = snippet.match(/href\s*=\s*["']([^"']*\/view\/[^"']+)["']/i)?.[1] || '';
      if (viewHref) viewId = parseViewUrl(viewHref);
      if (!viewId) {
        const slug = slugifyQuery(title);
        viewId = slug ? slug + '-' + uuid : uuid;
      }
      if (!VIEW_RE.test(viewId)) viewId = uuid;

      const downloadRaw = attrs['data-download-url'] || '';
      // infini.wtf sets is_animated=true on both videos and GIFs; distinguish GIFs by muted autoplay without player controls.
      const isGif = Boolean(videoUrl && ((video.isMuted && !video.hasControls) || /\.gif(?:$|[?#])/i.test(attrs['data-src'] || '')));
      const downloadUrl = safeDownloadUrl(downloadRaw, uuid);
      const dims = extractDimensions(attrs);

      seen.add(uuid);
      items.push({
        uuid,
        title,
        thumb: thumb || src,
        src: src || thumb,
        srcset,
        videoUrl,
        isVideo: Boolean(videoUrl),
        isGif,
        width: dims.width,
        height: dims.height,
        aspectRatio: dims.aspectRatio,
        downloadUrl,
        permalink: linkInfo.permalink,
        subreddit: linkInfo.subreddit,
        postId: linkInfo.postId,
        viewId
      });
    }

    return { items, skippedCount };
  }

  function cleanSuggestionLabel(value) {
    const clean = decodeEntities(String(value || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
    return clean.length >= 2 && clean.length <= 80 && !/[\u0000-\u001f]/.test(clean) ? clean : '';
  }

  function parseSuggestions(raw, currentQuery = '', max = 12) {
    const text = str(raw, 200000).trim();
    if (!text) return [];
    const seen = new Set();
    const curFold = str(currentQuery, 200).trim().toLowerCase();
    const curSlug = slugifyQuery(currentQuery);
    const results = [];
    const push = candidate => {
      if (results.length >= max) return;
      const label = cleanSuggestionLabel(candidate);
      if (!label) return;
      const slug = slugifyQuery(label);
      if (!slug || (curFold && label.toLowerCase() === curFold) || (curSlug && slug === curSlug)) return;
      if (seen.has(slug)) return;
      seen.add(slug);
      results.push({ label, slug });
    };

    if (text[0] === '[' || text[0] === '{') {
      try {
        const data = JSON.parse(text);
        const list = Array.isArray(data) ? data
          : Array.isArray(data?.related_searches) ? data.related_searches
          : Array.isArray(data?.suggestions) ? data.suggestions
          : Array.isArray(data?.queries) ? data.queries
          : Array.isArray(data?.results) ? data.results : [];
        for (const entry of list.slice(0, max * 2)) {
          if (typeof entry === 'string') push(entry);
          else if (entry && typeof entry === 'object') push(entry.query || entry.term || entry.label || entry.title || entry.name);
        }
        return results;
      } catch {}
    }

    for (const match of text.matchAll(/<a\b[^>]*href\s*=\s*["']\/search\/([A-Za-z0-9_-]{1,120})[^"']*["'][^>]*>([\s\S]{1,200}?)<\/a>/gi)) {
      const label = cleanSuggestionLabel(match[2]) || match[1].replace(/-/g, ' ');
      push(label);
    }
    if (!results.length) {
      for (const match of text.matchAll(/<(?:li|button|span)\b[^>]*>([\s\S]{1,160}?)<\/(?:li|button|span)>/gi)) {
        push(match[1]);
      }
    }
    return results;
  }

  // Page route helpers for Reddit search pages + Visual Search URL parameters.
  function searchScopeFromUrl(urlLike = globalThis.location?.href) {
    let url;
    try { url = urlLike instanceof URL ? urlLike : new URL(String(urlLike || ''), 'https://www.reddit.com'); }
    catch { return null; }
    const multi = /^\/user\/([A-Za-z0-9_-]{1,20})\/m\/([A-Za-z0-9_-]{1,50})\/search\/?$/i.exec(url.pathname);
    if (multi) return { surface: 'custom', owner: multi[1], name: multi[2], path: '/user/' + multi[1] + '/m/' + multi[2] + '/search/' };
    const sub = /^\/r\/([A-Za-z0-9_]{2,24})\/search\/?$/i.exec(url.pathname);
    if (sub) {
      const name = sub[1];
      if (['all', 'popular'].includes(name.toLowerCase())) return { surface: name.toLowerCase(), global: true, name, path: '/search/' };
      return { surface: 'subreddit', name, path: '/r/' + name + '/search/' };
    }
    const user = /^\/user\/([A-Za-z0-9_-]{1,24})\/search\/?$/i.exec(url.pathname);
    if (user) return { surface: 'user', username: user[1], path: '/user/' + user[1] + '/search/' };
    if (/^\/search\/?$/i.test(url.pathname)) return { surface: 'global', global: true, path: '/search/' };
    return null;
  }

  function parseVisualUrl(urlLike = globalThis.location?.href) {
    let url;
    try { url = urlLike instanceof URL ? urlLike : new URL(String(urlLike || ''), 'https://www.reddit.com'); }
    catch { return null; }
    const scope = searchScopeFromUrl(url);
    if (!scope) return null;
    const params = url.searchParams;
    const active = params.get('rt_visual') === '1';
    const rawQ = (params.get('q') || '').trim().slice(0, 300);
    const vview = str(params.get('rt_vview') || '', 220).trim();
    const vupload = str(params.get('rt_vupload') || '', 80).trim();
    const vhash = str(params.get('rt_vhash') || '', 64).trim().toLowerCase();
    const vpost = str(params.get('rt_vpost') || '', 60).trim();
    const postMatch = /^([A-Za-z0-9_]{2,24})\/([A-Za-z0-9]{1,12})$/.exec(vpost);
    const vscope = ['sub', 'user', 'all'].includes(params.get('rt_vscope')) ? params.get('rt_vscope') : '';
    const vpopular = params.get('rt_vpopular') === '1';
    const filters = normalizeFilters({
      nsfw: params.get('rt_vnsfw') === '1',
      mediaType: params.get('rt_vmedia') || '',
      time: params.get('rt_vtime') || ''
    });

    const queryInfo = normalizeQuery(rawQ);
    let kind = 'popular';
    let target = '';
    if (VIEW_RE.test(vview)) {
      kind = 'view';
      target = vview;
    } else if (UUID_RE.test(vupload)) {
      kind = 'upload';
      target = vupload;
    } else if (HASH_RE.test(vhash)) {
      kind = 'pending-upload';
      target = vhash;
    } else if (postMatch) {
      kind = 'post';
      target = postMatch[1].toLowerCase() + '/' + postMatch[2].toLowerCase();
    } else if (vpopular) {
      kind = 'popular';
    } else if (scope.surface === 'subreddit' && !queryInfo.slug && vscope !== 'all') {
      kind = 'subreddit';
      target = scope.name.toLowerCase();
    } else if (scope.surface === 'user' && !queryInfo.slug && vscope !== 'all') {
      kind = 'user';
      target = scope.username;
    } else if (queryInfo.slug) {
      kind = 'search';
      target = queryInfo.slug;
    } else if (scope.surface === 'subreddit' && vscope !== 'all') {
      kind = 'subreddit';
      target = scope.name.toLowerCase();
    } else if (scope.surface === 'user' && vscope !== 'all') {
      kind = 'user';
      target = scope.username;
    } else {
      kind = 'popular';
    }

    return {
      active,
      scope,
      q: rawQ,
      queryInfo,
      kind,
      target,
      viewId: VIEW_RE.test(vview) ? vview : '',
      uploadUuid: UUID_RE.test(vupload) ? vupload : '',
      uploadHash: HASH_RE.test(vhash) ? vhash : '',
      postSeed: postMatch ? { subreddit: postMatch[1].toLowerCase(), postId: postMatch[2].toLowerCase() } : null,
      vscope,
      popular: vpopular,
      filters,
      spec: (kind === 'post' || kind === 'pending-upload') ? null : { kind, target, slug: kind === 'search' ? target : '', filters }
    };
  }

  function stripVisualParams(urlLike) {
    const url = urlLike instanceof URL ? new URL(urlLike.href) : new URL(String(urlLike || ''), 'https://www.reddit.com');
    for (const key of ['rt_visual', 'rt_vmedia', 'rt_vtime', 'rt_vnsfw', 'rt_vview', 'rt_vupload', 'rt_vhash', 'rt_vpost', 'rt_vscope', 'rt_vpopular']) {
      url.searchParams.delete(key);
    }
    return url;
  }

  function buildVisualUrl(baseUrl, updates = {}) {
    const current = stripVisualParams(baseUrl);
    const base = stripVisualParams(updates.basePath ? new URL(updates.basePath, current.origin) : current);
    if (Object.hasOwn(updates, 'q')) {
      const q = str(updates.q, 300).trim();
      if (q) base.searchParams.set('q', q);
      else base.searchParams.delete('q');
    }
    base.searchParams.set('type', 'media');
    base.searchParams.set('rt_visual', '1');
    // Remove Reddit navigation noise tokens when explicitly navigating to a fresh Visual mode.
    if (updates.cleanNav) {
      for (const noise of ['cId', 'iId']) base.searchParams.delete(noise);
    }
    const filters = normalizeFilters(updates.filters);
    if (filters.mediaType) base.searchParams.set('rt_vmedia', filters.mediaType);
    if (filters.time) base.searchParams.set('rt_vtime', filters.time);
    if (filters.nsfw) base.searchParams.set('rt_vnsfw', '1');
    if (updates.viewId && VIEW_RE.test(updates.viewId)) base.searchParams.set('rt_vview', updates.viewId);
    else if (updates.uploadUuid && UUID_RE.test(updates.uploadUuid)) base.searchParams.set('rt_vupload', updates.uploadUuid);
    else if (updates.uploadHash && HASH_RE.test(updates.uploadHash)) base.searchParams.set('rt_vhash', updates.uploadHash);
    else if (updates.postSeed?.subreddit && updates.postSeed?.postId) {
      const sub = String(updates.postSeed.subreddit).replace(/^r\//i, '').toLowerCase();
      const id = String(updates.postSeed.postId).replace(/^t3_/i, '').toLowerCase();
      if (SUB_RE.test(sub) && POST_ID_RE.test(id)) base.searchParams.set('rt_vpost', sub + '/' + id);
    } else if (updates.popular) base.searchParams.set('rt_vpopular', '1');
    if (['sub', 'user', 'all'].includes(updates.vscope)) base.searchParams.set('rt_vscope', updates.vscope);
    return base;
  }

  globalThis.RTVisualSearchModel = Object.freeze({
    BASE,
    IMAGE_HOST,
    VIDEO_HOST,
    ORIGINS,
    MEDIA_TYPES,
    TIMES,
    RESULT_LIMIT,
    UUID_RE,
    VIEW_RE,
    HASH_RE,
    SUB_RE,
    USER_RE,
    POST_ID_RE,
    decodeEntities,
    slugifyQuery,
    normalizeQuery,
    normalizeFilters,
    buildEndpoint,
    cacheKey,
    safeImageUrl,
    safeSrcset,
    safeVideoUrl,
    safeDownloadUrl,
    safeRedditPermalink,
    parseViewUrl,
    parseNextPage,
    parseGridCells,
    parseSuggestions,
    searchScopeFromUrl,
    parseVisualUrl,
    stripVisualParams,
    buildVisualUrl
  });
})();
