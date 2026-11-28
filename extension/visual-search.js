/* Visual Search UI (infini.wtf) — Visual tab beside Media, header image upload/paste trigger,
   post ⋯ "Find visually similar" shortcut, 1:1 Reddit media grid, and flicker-free SPA transitions. */
(() => {
  'use strict';
  if (globalThis.RTVisualSearch || window.top !== window) return;

  const Model = globalThis.RTVisualSearchModel;
  const Filters = globalThis.RTFeedFilters;
  const Sheet = globalThis.RTFeedSheet;
  const MenuDOM = globalThis.RTPostMenuDOM;
  const DownloadModel = globalThis.RTDownloadModel;
  const CommunityIcons = globalThis.RTCommunityIcons;
  const Overlay = globalThis.RTVideoOverlay;
  if (!Model) return;

  const SVG = 'http://www.w3.org/2000/svg';
  const SETTINGS_KEY = 'rt-settings-v1';
  const ENABLED_SESSION_KEY = 'rt-visual-enabled-v1';
  const UPLOAD_META_PREFIX = 'rt-visual-upload:';
  const POST_SEED_PREFIX = 'rt-visual-seed:';
  const SUPPORTED_POST_TYPES = new Set(['image', 'gallery', 'video', 'gif']);
  const PARK_TTL_MS = 15 * 60_000;
  const MAX_PARKS = 6;
  const MAX_VIDEO_BLOBS = 4;
  const POLL_INTERVAL_MS = 1600;
  const MAX_POLLS = 18;
  const MAX_IMAGE_DIM = 1280;
  const LEAVE_FAILSAFE_MS = 6000;
  const RETURN_RESTORE_MS = 900;
  const POST_SCROLL_WAIT_MS = 1200;
  const HOVER_PREVIEW_MS = 200;
  // Touch: pressing and holding a clip plays it, muted, for as long as the finger stays down.
  const HOLD_PREVIEW_MS = 300;
  const RETRY_CODES = new Set(['timeout', 'network-error']);
  const AUTO_PREVIEW_MS = 150;
  const DWELL_PREVIEW_MS = 600;

  const PATHS = {
    camera: [
      'M5.5 2.5h9A3 3 0 0 1 17.5 5.5v9a3 3 0 0 1-3 3h-9a3 3 0 0 1-3-3v-9a3 3 0 0 1 3-3Zm0 1.8a1.2 1.2 0 0 0-1.2 1.2v9c0 .66.54 1.2 1.2 1.2h9c.66 0 1.2-.54 1.2-1.2v-9c0-.66-.54-1.2-1.2-1.2h-9ZM10 6.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7Zm0 1.8a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4ZM14.2 5.2a.8.8 0 1 1 0 1.6.8.8 0 0 1 0-1.6Z'
    ],
    caret: ['M10 13.7a.897.897 0 0 1-.636-.264l-4.6-4.6a.9.9 0 1 1 1.272-1.273L10 11.526l3.964-3.963a.9.9 0 1 1 1.272 1.273l-4.6 4.6A.897.897 0 0 1 10 13.7Z'],
    close: ['m11.273 10 5.363-5.363a.9.9 0 1 0-1.273-1.273L10 8.727 4.637 3.364a.9.9 0 1 0-1.273 1.273L8.727 10l-5.363 5.363a.9.9 0 1 0 1.274 1.273L10 11.273l5.363 5.363a.897.897 0 0 0 1.274 0 .9.9 0 0 0 0-1.273L11.275 10Z'],
    play: ['M6.8 4.4a.8.8 0 0 1 1.22-.68l7.6 4.6a.8.8 0 0 1 0 1.36l-7.6 4.6A.8.8 0 0 1 6.8 13.6V4.4Z'],
    expand: ['M3.5 8V4.2A.7.7 0 0 1 4.2 3.5H8a.9.9 0 0 1 0 1.8H5.3V8a.9.9 0 0 1-1.8 0ZM12 3.5h3.8a.7.7 0 0 1 .7.7V8a.9.9 0 0 1-1.8 0V5.3H12a.9.9 0 0 1 0-1.8ZM4.4 11.1a.9.9 0 0 1 .9.9v2.7H8a.9.9 0 0 1 0 1.8H4.2a.7.7 0 0 1-.7-.7V12a.9.9 0 0 1 .9-.9ZM15.6 11.1a.9.9 0 0 1 .9.9v3.8a.7.7 0 0 1-.7.7H12a.9.9 0 0 1 0-1.8h2.7V12a.9.9 0 0 1 .9-.9Z'],
    // An image frame with a magnifier: search with this picture.
    similar: [
      'M4.6 2.5h10.8a2.1 2.1 0 0 1 2.1 2.1v4.1h-1.8V4.6a.3.3 0 0 0-.3-.3H4.6a.3.3 0 0 0-.3.3v10.8c0 .17.13.3.3.3h4.1v1.8H4.6a2.1 2.1 0 0 1-2.1-2.1V4.6a2.1 2.1 0 0 1 2.1-2.1Z',
      'M6.3 12.9 8.6 10l1.6 2 .1-.1a4.9 4.9 0 0 0-.5 1.9H6.3v-.9ZM12.75 6.6a1.35 1.35 0 1 1-2.7 0 1.35 1.35 0 0 1 2.7 0Z',
      'M14.1 10a3.6 3.6 0 0 1 3.01 5.58l1.63 1.63a.9.9 0 1 1-1.27 1.27l-1.63-1.63A3.6 3.6 0 1 1 14.1 10Zm0 1.8a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z'
    ],
    overflow: ['M4.25 11.75a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm5.75 0a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Zm5.75 0a1.75 1.75 0 1 0 0-3.5 1.75 1.75 0 0 0 0 3.5Z'],
    image: ['M15.5 2.5h-11a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-11a2 2 0 0 0-2-2Zm.2 13a.2.2 0 0 1-.2.2h-11a.2.2 0 0 1-.2-.2v-1.33l3.3-3.96 2.2 2.64 3.1-3.72 2.8 3.36v3.01Zm0-5.82-2.8-3.36-3.1 3.72-2.2-2.64-3.3 3.96V4.5c0-.11.09-.2.2-.2h11c.11 0 .2.09.2.2v5.18ZM7.75 8.25a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z'],
    download: [
      'M9.1 2.5h1.8v6.6l2.55-2.55 1.27 1.27L10 12.57 5.28 7.82 6.55 6.55 9.1 9.1V2.5Z',
      'M3.9 12.5h1.8v2.8h8.6v-2.8h1.8v3.5c0 .5-.4.9-.9.9H4.8a.9.9 0 0 1-.9-.9v-3.5Z'
    ],
    upload: ['M10 2.5a.9.9 0 0 1 .64.26l4 4a.9.9 0 1 1-1.28 1.28L10.9 5.58v7.82a.9.9 0 0 1-1.8 0V5.58L6.64 8.04a.9.9 0 1 1-1.28-1.28l4-4A.9.9 0 0 1 10 2.5ZM3.4 15.2h13.2a.9.9 0 0 1 0 1.8H3.4a.9.9 0 0 1 0-1.8Z']
  };
  const NSFW_PATH = 'M6.506 5.119a.641.641 0 01.002-.723.74.74 0 01.31-.244 1.16 1.16 0 01.874 0 .695.695 0 01.306.244.647.647 0 01-.001.723.768.768 0 01-.303.259 1.008 1.008 0 01-.439.095 1.01 1.01 0 01-.44-.095.765.765 0 01-.309-.259Zm1.255 1.406a1.176 1.176 0 00-.507-.106c-.189 0-.36.036-.508.106a.854.854 0 00-.348.279.647.647 0 00-.127.386.6.6 0 00.13.382.87.87 0 00.353.266c.154.063.317.096.5.096s.352-.034.5-.1a.895.895 0 00.35-.27.625.625 0 00.123-.378.632.632 0 00-.124-.382.85.85 0 00-.342-.279Zm3.918.668c-.359.671-.958 1.57-1.937 2.55-.979.98-1.879 1.579-2.55 1.937-.749.4-1.637.4-2.386 0-.67-.358-1.57-.958-2.55-1.937-.98-.979-1.579-1.879-1.938-2.55-.4-.749-.4-1.637 0-2.387.36-.671.958-1.57 1.937-2.55.98-.98 1.88-1.579 2.55-1.937.75-.4 1.637-.4 2.386 0 .671.358 1.57.958 2.55 1.937.98.98 1.58 1.879 1.938 2.55.4.749.4 1.637 0 2.387ZM4 3.2H2.8v5.6H4V3.2Zm5.5 4.01a1.39 1.39 0 00-.246-.794 1.776 1.776 0 00-.6-.544c.168-.144.3-.312.395-.501.108-.21.163-.44.163-.682 0-.315-.089-.597-.266-.836a1.73 1.73 0 00-.712-.556A2.387 2.387 0 007.26 3.1c-.35 0-.677.065-.976.195-.298.13-.54.316-.72.555-.18.238-.27.521-.27.836 0 .243.054.472.163.684.096.189.228.357.394.501a1.788 1.788 0 00-.6.547 1.393 1.393 0 00.046 1.651c.192.255.465.46.806.608.341.148.727.223 1.151.223.416 0 .8-.074 1.14-.217.341-.145.613-.348.81-.605.197-.258.297-.549.297-.867l-.003-.001Z';

  const MEDIA_LABELS = [
    ['', 'All media'],
    ['images', 'Images'],
    ['gifs', 'GIFs'],
    ['videos', 'Videos']
  ];
  const TIME_LABELS = [
    ['', 'All time'],
    ['year', 'Past year'],
    ['month', 'Past month']
  ];
  const MENU_ROW_CLS = 'flex justify-between relative px-md gap-xs text-secondary-plain hover:text-secondary-plain-hover active:bg-interactive-pressed hover:bg-neutral-background-hover hover:no-underline cursor-pointer py-2xs -outline-offset-1';
  const NATIVE_TAB_SELECTED_CLS = ['bg-secondary-background-selected', '!text-neutral-content-strong', 'tab-selected'];
  const DEFAULT_TAB_CLS = 'flex hover:no-underline button-medium px-[calc(var(--rem12)-var(--button-border-width,0px))] button-tertiary items-center justify-center button inline-flex';

  const make = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  };

  function icon(name, size = 16) {
    const svg = document.createElementNS(SVG, 'svg');
    for (const [k, v] of Object.entries({ fill: 'currentColor', height: String(size), width: String(size), viewBox: '0 0 20 20', 'aria-hidden': 'true' })) {
      svg.setAttribute(k, v);
    }
    for (const d of PATHS[name] || []) {
      const p = document.createElementNS(SVG, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }

  // Visual search's mark: viewfinder corners around a lens, drawn with strokes so it stays crisp at 16–24 px.
  function lensIcon(size = 20) {
    const svg = document.createElementNS(SVG, 'svg');
    for (const [k, v] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', height: String(size), width: String(size), viewBox: '0 0 20 20', 'aria-hidden': 'true', 'data-rt-icon': 'lens' })) {
      svg.setAttribute(k, v);
    }
    const corners = document.createElementNS(SVG, 'path');
    corners.setAttribute('d', 'M2.9 7.3V5.4a2.5 2.5 0 0 1 2.5-2.5h1.9M12.7 2.9h1.9a2.5 2.5 0 0 1 2.5 2.5v1.9M17.1 12.7v1.9a2.5 2.5 0 0 1-2.5 2.5h-1.9M7.3 17.1H5.4a2.5 2.5 0 0 1-2.5-2.5v-1.9');
    const lens = document.createElementNS(SVG, 'circle');
    for (const [k, v] of Object.entries({ cx: '10', cy: '10', r: '3.1' })) lens.setAttribute(k, v);
    svg.append(corners, lens);
    return svg;
  }

  function nsfwIcon(size = 14) {
    const existing = Filters?.svgIcon?.('nsfw-fill-12', size);
    if (existing) return existing;
    const svg = document.createElementNS(SVG, 'svg');
    for (const [k, v] of Object.entries({ fill: 'currentColor', height: String(size), width: String(size), viewBox: '0 0 12 12', 'icon-name': 'nsfw-fill-12', 'aria-hidden': 'true' })) {
      svg.setAttribute(k, v);
    }
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', NSFW_PATH);
    svg.append(p);
    return svg;
  }

  const isPhone = () => Boolean(globalThis.matchMedia?.('(max-width: 767.98px)')?.matches);
  const canHover = () => Boolean(globalThis.matchMedia?.('(hover: hover) and (pointer: fine)')?.matches);
  const reducedMotion = () => Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  const historyEntry = () => globalThis.navigation?.currentEntry?.key || (location.pathname + location.search);
  const urlKey = (href = location.href) => {
    try { const u = new URL(href, location.origin); return u.pathname + u.search; }
    catch { return String(href || ''); }
  };

  // Longest wait per request before the page gives up on the worker (each is above the broker's own fetch timeout,
  // so the broker's answer normally arrives first; this catches a worker that never answers).
  const SEND_TIMEOUT_MS = { query: 25_000, related: 10_000, autocomplete: 10_000, 'resolve-post': 25_000, 'check-image-query': 25_000, 'fetch-still': 25_000, 'upload-image': 45_000, 'fetch-video': 40_000, download: 20_000 };

  async function defaultSend(message) {
    const runtime = (globalThis.browser || globalThis.chrome)?.runtime;
    let timer;
    try {
      const response = runtime.sendMessage({ scope: 'rt-visual-search', ...message });
      const result = await Promise.race([response, new Promise(resolve => {
        timer = setTimeout(() => resolve({
          ok: false, error: 'Visual search took too long to answer.', code: 'timeout'
        }), SEND_TIMEOUT_MS[message.action] || 25_000);
      })]);
      if (result) return result;
    } catch {} finally {
      clearTimeout(timer);
    }
    return { ok: false, error: 'Visual search did not answer.', code: 'network-error' };
  }

  async function defaultReadSettings() {
    const runtime = (globalThis.browser || globalThis.chrome)?.runtime;
    if (!runtime?.sendMessage) return null;
    const response = await runtime.sendMessage({ scope: 'rt-posts', action: 'get-settings' });
    return response?.ok ? response.settings : null;
  }

  function base64ToBlob(base64, mimeType) {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mimeType });
  }

  // Re-encode uploaded/pasted images on an offscreen canvas to cap dimensions and strip EXIF/GPS metadata.
  async function prepareImageBlob(blob) {
    if (!blob || !(blob.type?.startsWith('image/') || blob.size > 0)) {
      throw Error('Select a valid image file (PNG, JPG, WebP, or GIF).');
    }
    if (blob.size > 25 * 1024 * 1024) {
      throw Error('Image file is larger than 25 MB.');
    }
    let previewUrl = '';
    try {
      const objectUrl = URL.createObjectURL(blob);
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(Error('Could not read that image.'));
        el.src = objectUrl;
      }).finally(() => URL.revokeObjectURL(objectUrl));

      const natW = img.naturalWidth || img.width || 1;
      const natH = img.naturalHeight || img.height || 1;
      const scale = Math.min(1, MAX_IMAGE_DIM / Math.max(natW, natH));
      const width = Math.max(1, Math.round(natW * scale));
      const height = Math.max(1, Math.round(natH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw Error('Could not prepare that image.');
      ctx.drawImage(img, 0, 0, width, height);

      const encode = type => new Promise(resolve => canvas.toBlob(resolve, type, 0.88));
      const outBlob = await encode('image/webp') || await encode('image/jpeg');
      if (!outBlob) throw Error('Could not prepare that image.');
      const mimeType = outBlob.type;
      // Read encoded bytes as a string. Firefox's canvas Blob can return a page-owned ArrayBuffer,
      // whose typed-array views may throw on operations such as subarray in a content script.
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Error('Could not read the prepared image.'));
        reader.readAsDataURL(outBlob);
      });
      const dataBase64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
      previewUrl = URL.createObjectURL(outBlob);
      let thumbDataUrl = '';
      try {
        const thumbScale = Math.min(1, 160 / Math.max(width, height));
        const tc = document.createElement('canvas');
        tc.width = Math.max(1, Math.round(width * thumbScale));
        tc.height = Math.max(1, Math.round(height * thumbScale));
        tc.getContext('2d')?.drawImage(canvas, 0, 0, tc.width, tc.height);
        const url = tc.toDataURL('image/jpeg', 0.72);
        if (url.length < 30_000) thumbDataUrl = url;
      } catch {}
      return { dataBase64, mimeType, previewUrl, thumbDataUrl, width, height };
    } catch (error) {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      throw error;
    }
  }

  const NATIVE_MEDIA_TILE = Overlay.searchTile;
  const redditMedia = u => {
    try {
      const url = new URL(String(u || '').replace(/&amp;/gi, '&'));
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && /(^|\.)redd\.it$/i.test(url.hostname) ? url : null;
    } catch { return null; }
  };
  function directVideo(value) {
    const url = redditMedia(value);
    return url && /\.(?:mp4|webm)$/i.test(url.pathname) ? url.href : '';
  }
  // Prefer the tallest packaged MP4 up to 720p. Keep the other direct sources for playback errors.
  function nativeVideoSources(player) {
    let list = [];
    try { list = JSON.parse(player?.getAttribute?.('packaged-media-json') || '{}')?.playbackMp4s?.permutations || []; } catch {}
    const usable = (Array.isArray(list) ? list : []).map(p => {
      const source = p?.source || p;
      return { url: directVideo(source?.url), h: Number(source?.dimensions?.height) || 0 };
    }).filter(p => p.url);
    usable.sort((a, b) => (a.h > 720) - (b.h > 720) || b.h - a.h);
    const video = player.shadowRoot?.querySelector('video');
    const preview = player.shadowRoot?.querySelector('shreddit-media-ui')?.getAttribute('preview');
    return [...new Set([...usable.map(p => p.url), ...[
      video?.currentSrc, video?.getAttribute('src'), player.getAttribute('src'), preview
    ].map(directVideo).filter(Boolean)])];
  }
  function nativeTileTime(tile) {
    const video = tile?.querySelector(Overlay.searchPlayer)?.shadowRoot?.querySelector('video');
    return video && !video.paused && Number.isFinite(video.currentTime) ? video.currentTime : 0;
  }
  // One of Reddit's Media tab tiles as a viewer item.
  function nativeMediaItem(tile) {
    const link = tile?.querySelector?.('a[href*="/comments/"]');
    let url;
    try { url = new URL(link?.href); } catch { return null; }
    if (url.origin !== location.origin) return null;
    const permalink = url.pathname + url.search;
    const m = /^\/(r|user)\/([A-Za-z0-9_-]{2,24})\/comments\/([a-z0-9]{1,12})(?:\/|$)/i.exec(url.pathname);
    if (!m) return null;
    const img = tile.querySelector('img[data-post-media-primary]') || tile.querySelector('img:not(.post-background-image-filter)');
    // A gallery can contain its own hidden video. Only a search-results player is the tile's video preview.
    const player = tile.querySelector(Overlay.searchPlayer);
    if ((player || img)?.closest('shreddit-blurred-container[blurred]')) return null;
    const poster = redditMedia(player?.getAttribute('poster'))?.href || redditMedia(img?.currentSrc || img?.getAttribute('src'))?.href || '';
    const sources = player ? nativeVideoSources(player) : [];
    if (!poster && !player) return null;
    let context = null;
    try { context = JSON.parse(tile.querySelector('[data-faceplate-tracking-context]')?.getAttribute('data-faceplate-tracking-context') || 'null'); } catch {}
    const title = String(context?.post?.title || link.querySelector('faceplate-screen-reader-content')?.textContent || '').trim().slice(0, 300);
    const subreddit = m[1].toLowerCase() === 'user' ? 'u_' + m[2] : m[2];
    return { native: true, tile, uuid: 'native:' + m[3].toLowerCase(), postId: m[3].toLowerCase(), permalink, title, subreddit, src: poster, thumb: poster, sources, isVideo: Boolean(player), isGif: Boolean(player?.closest(Overlay.gif)), fallbackImageUrl: poster };
  }
  function nativeMediaItems(feed) {
    return [...(feed?.querySelectorAll?.(NATIVE_MEDIA_TILE) || [])].map(nativeMediaItem).filter(Boolean);
  }

  const REDDIT_STILL_HOSTS = new Set(['i.redd.it', 'preview.redd.it', 'cf.preview.redd.it', 'external-preview.redd.it']);
  function redditImage(value) {
    try {
      const url = new URL(String(value || '').replace(/&amp;/gi, '&'));
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && REDDIT_STILL_HOSTS.has(url.hostname) ? url.href : '';
    } catch { return ''; }
  }

  // Read Reddit's own copy of an embed's still from one post's JSON or feed partial.
  async function postStill(postId) {
    const id = String(postId || '').replace(/^t3_/i, '').toLowerCase();
    if (!/^[a-z0-9]{1,12}$/.test(id)) return '';
    const pick = list => list.map(redditImage).find(Boolean) || '';
    try {
      const res = await fetch(new URL('/comments/' + id + '.json?limit=1&depth=1&raw_json=1', location.origin).href, { credentials: 'include', headers: { Accept: 'application/json' } });
      if (res.ok) {
        const d = (await res.json())?.[0]?.data?.children?.[0]?.data;
        const image = d?.preview?.images?.[0];
        const still = pick([(image?.resolutions || []).find(r => r.width >= 480)?.url, image?.source?.url, d?.secure_media?.oembed?.thumbnail_url, d?.media?.oembed?.thumbnail_url]);
        if (still) return still;
      }
    } catch {}
    try {
      const res = await fetch(new URL('/svc/shreddit/partial-feed-post/t3_' + id, location.origin).href, { credentials: 'include', headers: { Accept: 'text/vnd.reddit.partial+html, text/html;q=0.9' } });
      if (res.ok) {
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const urls = [];
        for (const node of doc.querySelectorAll('[poster],[thumbnail-url],[thumbnail],[preview-image],[preview-url]')) for (const name of ['poster', 'thumbnail-url', 'thumbnail', 'preview-image', 'preview-url']) urls.push(node.getAttribute(name));
        for (const img of doc.querySelectorAll('img[src]')) if (!/(?:\/avatars\/|snoovatar|icon|\.svg(?:$|\?))/i.test(img.getAttribute('src'))) urls.push(img.getAttribute('src'));
        return pick(urls);
      }
    } catch {}
    return '';
  }

  // Reddit renders an embed's player lazily inside its own shadow root, but every shreddit-embed carries the
  // provider's player address in its html attribute from the start. YouTube's still comes from the video id
  // and embedly widgets name their still in an image parameter.
  function embedAddressStills(html) {
    const src = /\bsrc=["']([^"']+)["']/i.exec(String(html || ''))?.[1]?.replace(/&amp;/gi, '&') || '';
    let url;
    try { url = new URL(src); } catch { return []; }
    const youtube = /(^|\.)(youtube(?:-nocookie)?\.com)$/i.test(url.hostname) && /^\/embed\/([A-Za-z0-9_-]{6,20})$/.exec(url.pathname)?.[1];
    if (youtube) return ['https://i.ytimg.com/vi/' + youtube + '/hqdefault.jpg'];
    if (url.hostname === 'cdn.embedly.com' && url.searchParams.get('image')) return [url.searchParams.get('image')];
    return [];
  }

  function extractPostMedia(post) {
    const postId = String(post?.getAttribute?.('id') || post?.getAttribute?.('post-id') || '').replace(/^t3_/i, '').toLowerCase();
    const rawPermalink = post?.getAttribute?.('permalink') || '';
    const subMatch = /^\/r\/([A-Za-z0-9_]{2,24})\//i.exec(rawPermalink);
    const subAttr = String(post?.getAttribute?.('subreddit-prefixed-name') || '').replace(/^r\//i, '').replace(/^u\//i, 'u_');
    const subreddit = (subMatch?.[1] || subAttr || '').toLowerCase();
    const title = String(post?.getAttribute?.('post-title') || post?.querySelector?.('[slot="title"]')?.textContent || '').trim().slice(0, 300);

    let fallbackImageUrl = '';
    const type = String(post?.getAttribute?.('post-type') || '').toLowerCase();
    if (DownloadModel?.mediaFor && (type === 'image' || type === 'gallery')) {
      const info = DownloadModel.mediaFor(post);
      const imgUrl = info?.items?.[0]?.url;
      fallbackImageUrl = redditImage(imgUrl);
    }
    if (!fallbackImageUrl) {
      const player = post?.querySelector?.('shreddit-player, shreddit-player-2');
      const poster = player?.getAttribute?.('poster') || player?.shadowRoot?.querySelector?.('video')?.getAttribute?.('poster') || '';
      fallbackImageUrl = redditImage(poster);
    }
    if (!fallbackImageUrl) {
      const container = post?.querySelector?.('[slot="post-media-container"]') || post;
      for (const img of container?.querySelectorAll?.('img') || []) {
        if (img.classList?.contains('rt-media-backdrop')) continue;
        const candidate = img.currentSrc || img.getAttribute('src') || img.getAttribute('data-src') || '';
        fallbackImageUrl = redditImage(candidate);
        if (fallbackImageUrl) break;
      }
    }
    // Embedded media (YouTube, Vimeo, Streamable and others): infini.wtf only indexes Reddit-hosted media, so these are
    // searched with their still. Reddit's own copy of it (external-preview.redd.it) first, then the provider's.
    const embed = !fallbackImageUrl ? post?.querySelector?.('shreddit-embed') : null;
    if (embed) {
      const httpsImage = u => { try { const parsed = new URL(String(u || '').replace(/&amp;/gi, '&')); return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : ''; } catch { return ''; } };
      const lite = embed.querySelector?.('lite-youtube,lite-vimeo') || embed.shadowRoot?.querySelector?.('lite-youtube,lite-vimeo');
      const candidates = [
        ...[...(post.querySelectorAll?.('img[slot="thumbnail"],img[data-post-media-primary]') || [])].map(img => img.currentSrc || img.getAttribute('src') || ''),
        ...['poster', 'thumbnail-url', 'thumbnail', 'preview-image', 'preview-url'].flatMap(name => [embed.getAttribute?.(name), lite?.getAttribute?.(name)]),
        lite?.shadowRoot?.querySelector?.('img')?.getAttribute?.('src'),
        /url\(['"]?(https:\/\/[^'"()\s]+)['"]?\)/.exec(lite?.getAttribute?.('style') || '')?.[1],
        // Stills the extension's own embed handling already drew over the player.
        ...[...(embed.shadowRoot?.querySelectorAll?.('img[data-rt-pre-still],img[data-rt-parked-still]') || [])].map(img => img.currentSrc || img.getAttribute('src') || ''),
        ...embedAddressStills(embed.getAttribute?.('html') || '')
      ].filter(Boolean);
      fallbackImageUrl = candidates.map(redditImage).find(Boolean) || candidates.map(httpsImage).find(Boolean) || '';
    }
    return { postId, subreddit, title, fallbackImageUrl, embed: Boolean(embed) };
  }

  class VisualSearchController {
    constructor({
      send = defaultSend,
      readSettings = defaultReadSettings,
      prepareImage = prepareImageBlob,
      observe = true
    } = {}) {
      this.send = send;
      this.readSettings = readSettings;
      this.prepareImage = prepareImage;
      this.dead = false;
      this.enabled = false;
      this.postMenuEnabled = false;
      this.mediaLensEnabled = false;
      this.settingsRevision = 0;
      this.settingsRetry = 0;
      this.gen = 0;
      this.pollTimer = 0;
      this.scrollTimer = 0;
      this.restoreFrame = 0;
      this.postScrollTimer = 0;
      this.progressTimer = 0;
      this.progressBar = null;
      this.queued = false;
      this.queuedFrame = false;

      this.host = null;
      this.mountedMain = null;
      this.activeKey = '';
      this.activeSpecKey = '';
      this.lastUrl = location.href;
      this.state = null;
      this.hiddenNodes = new Map();
      this.tabOriginals = new WeakMap();
      this.tabShadowObserver = null;
      this.tabShadowTarget = null;
      this.visualTabScrolled = null;
      this.nativeTabBackup = new WeakMap();
      this.nativeTabLinks = new WeakMap();
      this.parks = new Map();
      this.urlParks = new Map();
      this.outgoing = null;
      this.waitingForReplacedMain = null;
      this.waitingTimer = 0;
      this.dispatchingRoute = false;
      this.returningFromOther = false;
      this.pendingPostScrollReset = false;
      this.userScrolledRecently = false;
      this.baseNativeUrl = urlKey(location.href);

      this.openDropdown = null;
      this.uploadPopover = null;
      this.lightbox = null;
      this.hoveredPreview = null;
      this.videoBlobs = new Map();
      this.videoFetches = new Map();
      this.players = new Map();
      this.playerSeq = 0;
      this.framePlayback = null;
      this.clickChoice = { visualClick: 'post', clickAudio: 'muted', videoOpenPost: 'default' };
      this.mediaChoice = { video: 'default', gif: 'default' };
      this.settleTimer = 0;
      this.localPreviewUrls = new Set();

      this.fileInput = null;
      this.returnInputHandler = () => {
        this.userScrolledRecently = true;
        this.stopScrollRestore();
        this.pendingPostScrollReset = false;
      };

      this.onDocClick = event => this.handleDocClick(event);
      this.onDocPointerDown = event => this.handlePointerDown(event);
      this.onHoldMove = event => {
        const hold = this.hold;
        if (hold && !hold.engaged && Math.hypot(event.clientX - hold.x, event.clientY - hold.y) > 10) this.endHold(false);
      };
      this.onHoldEnd = event => this.endHold(event.type === 'pointerup');
      // A held clip is a preview, not a long press: no link menu or text selection.
      this.onHoldMenu = event => { if (this.hold) event.preventDefault(); };
      this.onDocKeydown = event => this.handleKeydown(event);
      this.onDocOver = event => this.handlePointerOver(event);
      this.onDocOut = event => this.handlePointerOut(event);
      this.onDocSubmit = event => this.handleSearchSubmit(event);
      this.onDocPaste = event => this.handlePaste(event);
      this.onVisibility = () => this.handleVisibility();
      this.onRoute = event => this.handleRoute(event);
      this.onPlayerMessage = event => this.handlePlayerMessage(event);
      this.onMediaChange = () => {
        this.closeDropdown();
        this.closeUploadPopover();
        if (this.host?.isConnected && this.state?.status === 'ready') this.renderHost();
      };
      this.onScrollPause = () => {
        if (this.hoveredPreview) this.checkVideoVisibility();
        if (this.host?.isConnected) this.settlePreviews();
        // Embeds draw their players inside their own shadow roots, which the page observer can't see: look again for
        // posts that had no picture yet once scrolling rests.
        if (this.mediaLensEnabled) {
          clearTimeout(this.lensTimer);
          this.lensTimer = setTimeout(() => { if (!this.dead && this.mediaLensEnabled) this.syncMediaLenses(); }, 300);
        }
      };

      this.phoneMedia = globalThis.matchMedia?.('(max-width: 767.98px)');
      this.phoneMedia?.addEventListener?.('change', this.onMediaChange);

      this.moreIO = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(entries => {
            if (entries.some(e => e.isIntersecting)) this.loadMore();
          }, { rootMargin: '600px 0px' })
        : null;

      this.videoIO = typeof IntersectionObserver === 'function'
        ? new IntersectionObserver(entries => {
            for (const entry of entries) {
              if (!entry.isIntersecting || entry.intersectionRatio < 0.25) {
                if (this.hoveredPreview?.media === entry.target) this.stopVideoPreview();
              }
            }
          }, { threshold: [0, 0.25] })
        : null;

      document.addEventListener('pointerdown', this.onDocPointerDown, true);
      document.addEventListener('pointermove', this.onHoldMove, true);
      for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, this.onHoldEnd, true);
      document.addEventListener('contextmenu', this.onHoldMenu, true);
      document.addEventListener('click', this.onDocClick, true);
      document.addEventListener('keydown', this.onDocKeydown, true);
      document.addEventListener('mouseover', this.onDocOver, true);
      document.addEventListener('mouseout', this.onDocOut, true);
      document.addEventListener('submit', this.onDocSubmit, true);
      document.addEventListener('paste', this.onDocPaste, true);
      document.addEventListener('visibilitychange', this.onVisibility);
      document.addEventListener('reddit:route', this.onRoute);
      window.addEventListener('message', this.onPlayerMessage);
      window.addEventListener('popstate', this.onRoute);
      globalThis.navigation?.addEventListener('currententrychange', this.onRoute);
      window.addEventListener('scroll', this.onScrollPause, { passive: true });
      for (const evt of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
        window.addEventListener(evt, this.returnInputHandler, { capture: true, passive: true });
      }

      if (observe) {
        this.observer = new MutationObserver(records => this.handleMutations(records));
        this.observer.observe(document.documentElement || document, { childList: true, subtree: true });

        const runtime = (globalThis.browser || globalThis.chrome)?.runtime;
        const storage = (globalThis.browser || globalThis.chrome)?.storage;
        this.onStorage = (changes, area) => {
          if (area === 'local' && changes?.[SETTINGS_KEY]) this.applySettings(changes[SETTINGS_KEY].newValue);
        };
        this.onSettingsMsg = (message, sender) => {
          if (sender?.id && runtime?.id && sender.id !== runtime.id) return;
          if (message?.scope === 'rt-posts' && message.action === 'settings-changed') {
            if (message.settings) this.applySettings(message.settings);
            else this.loadSettings();
          }
        };
        try { storage?.onChanged?.addListener(this.onStorage); } catch {}
        try { runtime?.onMessage?.addListener(this.onSettingsMsg); } catch {}
      }

      this.ready = this.loadSettings();
    }

    applySettings(raw) {
      if (this.dead) return;
      const postModel = globalThis.RTPostModel;
      const s = postModel?.normalizeSettings ? postModel.normalizeSettings(raw) : (raw || {});
      const nextEnabled = s.visualSearch === true;
      const nextMenu = nextEnabled && s.visualSearchPostMenu !== false;
      this.mediaChoice = { video: s.videoStart || 'default', gif: s.gifStart || 'default' };
      this.clickChoice = { visualClick: s.visualClick || 'post', clickAudio: s.clickAudio || 'muted', videoOpenPost: s.videoOpenPost || 'default' };
      if (this.hoveredPreview && !this.hoveredPreview.manual && this.previewMode(this.hoveredPreview.media) === 'none') this.stopVideoPreview();
      const nextLens = nextEnabled && s.visualSearchMediaButton === true;
      const nsfwChanged = (s.visualNsfw === true) !== this.nsfwDefault;
      this.nsfwDefault = s.visualNsfw === true;
      Model.setNsfwDefault?.(this.nsfwDefault);
      const changed = nextEnabled !== this.enabled || nextMenu !== this.postMenuEnabled || nextLens !== this.mediaLensEnabled || nsfwChanged;
      this.enabled = nextEnabled;
      this.postMenuEnabled = nextMenu;
      this.mediaLensEnabled = nextLens;
      this.settingsRevision++;
      try { sessionStorage.setItem(ENABLED_SESSION_KEY, nextEnabled ? '1' : '0'); } catch {}

      if (!nextEnabled) {
        this.teardownActive();
        return;
      }
      if (!nextMenu) this.teardownPostMenus();
      if (!nextLens) this.teardownMediaLenses();
      if (changed) this.sync();
    }

    async loadSettings(attempt = 0) {
      if (this.dead) return;
      clearTimeout(this.settingsRetry);
      let settings = null;
      try { settings = await this.readSettings(); } catch {}
      if (this.dead) return;
      if (settings) {
        this.applySettings(settings);
      } else {
        // Default OFF until confirmed enabled; retry quietly if service worker was waking/reloading.
        this.enabled = false;
        this.postMenuEnabled = false;
        this.teardownActive();
        if (attempt < 6) {
          this.settingsRetry = setTimeout(() => this.loadSettings(attempt + 1), Math.min(30_000, 1000 * 2 ** attempt));
        }
      }
    }

    handleMutations(records) {
      if (this.dead || !this.enabled) return;
      if (MenuDOM?.onlyMenuChanges(records)) {
        if (this.postMenuEnabled) {
          for (const menu of new Set(records.map(r => r.target.closest?.(MenuDOM.inline)).filter(Boolean))) {
            const post = menu.closest('shreddit-post');
            if (post && menu.isConnected) this.syncPostMenuItem(menu, post);
          }
          this.dedupePostSheet();
        }
        return;
      }
      let urgent = false;
      for (const record of records) {
        if (record.target?.closest?.('[data-rt-ui]') || MenuDOM?.isMenuMutation?.(record)) continue;
        const nodes = [...record.addedNodes, ...record.removedNodes];
        if (!nodes.length) continue;
        if (nodes.every(n => n.nodeType === 1 && n.dataset?.rtUi && !n.dataset.rtUi.startsWith('visual-'))) continue;
        urgent = true;
        break;
      }
      if (!urgent) return;
      this.schedule(true);
    }

    schedule(urgent = true) {
      if (this.dead || !this.enabled) return;
      if (this.queued && !(urgent && this.queuedFrame)) return;
      this.queued = true;
      const run = () => {
        this.queued = false;
        this.queuedFrame = false;
        if (!this.dead) this.sync();
      };
      if (!urgent && globalThis.requestAnimationFrame && document.visibilityState !== 'hidden') {
        this.queuedFrame = true;
        requestAnimationFrame(run);
      } else {
        this.queuedFrame = false;
        queueMicrotask(run);
      }
    }

    handleRoute(event) {
      if (this.dead || !this.enabled || this.dispatchingRoute) return;
      if (event?.navigationType === 'replace' && urlKey(location.href) === this.activeKey) {
        this.lastUrl = location.href;
        return;
      }
      const parsed = Model.parseVisualUrl(location.href);
      const main = document.querySelector('main');
      const prevUrl = this.lastUrl;
      this.lastUrl = location.href;
      if (parsed?.active) {
        document.documentElement?.setAttribute('data-rt-visual-active', '');
        const isPostMain = Boolean(main?.querySelector?.('shreddit-post[view-context="CommentsPage"]'));
        const cameFromNonSearch = Boolean(prevUrl && !Model.searchScopeFromUrl(prevUrl));
        if ((event?.type === 'popstate' || event?.navigationType === 'traverse') && (isPostMain || cameFromNonSearch)) {
          if (main && !main.contains(this.host) && this.waitingForReplacedMain !== main) {
            this.waitingForReplacedMain = main;
            clearTimeout(this.waitingTimer);
            this.waitingTimer = setTimeout(() => {
              if (this.waitingForReplacedMain === main) {
                this.waitingForReplacedMain = null;
                this.waitingTimer = 0;
                this.schedule(true);
              }
            }, 3000);
          }
        }
      } else {
        this.waitingForReplacedMain = null;
        clearTimeout(this.waitingTimer);
        this.waitingTimer = 0;
      }
      this.sync();
    }

    // Main synchronization pass: handles departures, Back returns, search tabs, header camera trigger, and post menus.
    sync() {
      if (this.dead || !this.enabled) return;
      const parsed = Model.parseVisualUrl(location.href);
      const activeVisual = Boolean(parsed?.active);
      const main = document.querySelector('main');
      if (this.lightbox && this.lightbox.route !== urlKey()) this.closeLightbox({ restoreFocus: false });

      // Track the latest native URL rendered inside <main> so Visual <-> Media fast swap knows if hidden native Media matches.
      if (main && main !== this.mountedMain && !activeVisual) {
        this.baseNativeUrl = urlKey(location.href);
      }

      // Track leaving Visual without a click inside host (e.g., browser Back/Forward from Visual to Media/Posts/Home).
      // Returning to baseNativeUrl (same <main> with hidden native Media) unmounts right away; real <main> transitions hold until swapped.
      if (!activeVisual && !this.outgoing && this.host?.isConnected && this.mountedMain?.isConnected) {
        if (urlKey(location.href) === this.baseNativeUrl) {
          this.savePark();
          this.unmountVisualHost();
        } else {
          this.startDeparture();
        }
      }

      // 1. Outgoing Visual View: user clicked a result tile or switched to another search tab while <main> hasn't swapped yet.
      if (this.outgoing) {
        if (activeVisual) {
          this.releaseOutgoing({ keepHost: true });
        } else {
          const sameMain = this.outgoing.main && this.outgoing.main.isConnected;
          const postArrivedInsideSameMain = sameMain && Boolean(this.outgoing.main.querySelector('shreddit-post[view-context="CommentsPage"]'));
          if (!sameMain || postArrivedInsideSameMain) {
            this.releaseOutgoing({ keepHost: false });
            if (this.pendingPostScrollReset && !this.userScrolledRecently) {
              this.scrollOpenedPostToTop();
            }
          } else {
            // Still transitioning inside Reddit's outgoing <main>: keep our grid mounted and native content suppressed!
            document.documentElement?.setAttribute('data-rt-visual-active', '');
            document.documentElement?.setAttribute('data-rt-visual-ready', '');
            return;
          }
        }
      }

      // If returning via Back to Visual while the outgoing page's <main> hasn't swapped out yet, hold off mounting until search DOM or a new <main> arrives.
      if (activeVisual && main && main === this.waitingForReplacedMain && main.isConnected && !main.querySelector('#search-results-page-tabgroup, search-media-feed, [data-testid="search-sdui-post"], [data-testid="search-error-message"]')) {
        document.documentElement?.setAttribute('data-rt-visual-active', '');
        return;
      }
      if (this.waitingForReplacedMain) {
        this.waitingForReplacedMain = null;
        clearTimeout(this.waitingTimer);
        this.waitingTimer = 0;
      }

      // 2. Active Visual Search route inside <main>
      if (activeVisual) {
        this.ensureActiveVisual(parsed, main);
      } else {
        this.unmountVisualHost();
        if (document.documentElement?.hasAttribute('data-rt-visual-active')) {
          document.documentElement.removeAttribute('data-rt-visual-active');
          document.documentElement.removeAttribute('data-rt-visual-ready');
          this.notifyOtherModules();
        }
      }

      // 3. Global entry points: Visual tab on search routes, Header camera trigger, Post ⋯ menu.
      this.syncSearchTabGroup(parsed);
      this.syncHeaderTriggers();
      if (this.postMenuEnabled) this.syncPostMenus();
      if (this.mediaLensEnabled) this.syncMediaLenses();
      this.syncNativeMediaViewer();
    }

    notifyOtherModules() {
      this.dispatchingRoute = true;
      try { document.dispatchEvent(new Event('reddit:route')); } catch {}
      finally { this.dispatchingRoute = false; }
    }

    ensureActiveVisual(parsed, main) {
      const wasActive = document.documentElement?.hasAttribute('data-rt-visual-active');
      document.documentElement?.setAttribute('data-rt-visual-active', '');
      document.documentElement?.setAttribute('data-rt-visual-ready', '');

      if (!main) {
        if (!wasActive) this.notifyOtherModules();
        return;
      }
      const entryKey = historyEntry();
      const currentUrl = urlKey(location.href);

      if (main !== this.mountedMain) {
        this.baseNativeUrl = urlKey(Model.stripVisualParams(location.href).href);
      }

      // Hide Reddit's native children in <main> (excluding our own host and scoped switcher/tabgroup).
      this.suppressNativeInMain(main);

      // If our active host already matches this route & is in main, keep it attached and done.
      if (this.host && this.activeKey === currentUrl) {
        if (this.host.parentElement !== main || main.firstElementChild !== this.host) {
          main.prepend(this.host);
        }
        this.mountedMain = main;
        if (!['hashing', 'uploading', 'embedding', 'fetching'].includes(this.state?.status)) {
          this.finishProgress();
        }
        if (!wasActive) this.notifyOtherModules();
        return;
      }

      // Check parked view first (Back/Forward from post or native tab): zero refetch, synchronous adoption!
      const park = this.takePark(entryKey, currentUrl);
      if (park && park.settingsRev === this.settingsRevision) {
        this.adoptPark(park, main, parsed);
        this.finishProgress();
        if (!wasActive) this.notifyOtherModules();
        return;
      }

      // Fresh view for this route.
      this.mountFreshVisual(main, parsed, currentUrl);
      if (!wasActive) this.notifyOtherModules();
    }

    suppressNativeInMain(main) {
      if (!main) return;
      for (const child of [...main.children]) {
        if (child === this.host || child.matches?.('[data-rt-ui="visual-search"], #search-results-page-tabgroup')) continue;
        if (child.querySelector?.('#search-results-page-tabgroup')) continue;
        if (!this.hiddenNodes.has(child)) this.hiddenNodes.set(child, child.hidden);
        child.hidden = true;
        child.setAttribute('data-rt-visual-hidden', '');
      }
    }

    restoreHiddenNodes() {
      for (const [node, wasHidden] of this.hiddenNodes) {
        if (node.isConnected) {
          node.hidden = Boolean(wasHidden);
          node.removeAttribute('data-rt-visual-hidden');
        }
      }
      this.hiddenNodes.clear();
    }

    isHostParked(host) {
      if (!host) return false;
      for (const p of this.parks.values()) if (p.host === host) return true;
      for (const p of this.urlParks.values()) if (p.host === host) return true;
      return false;
    }

    mountFreshVisual(main, parsed, currentUrl) {
      this.stopVideoPreview();
      this.stopPolling();
      this.stopScrollRestore();
      this.moreIO?.disconnect();
      this.mountedMain = main;
      this.activeKey = currentUrl;
      this.activeSpecKey = parsed.spec ? Model.cacheKey(parsed.spec) : '';

      const host = (this.host && !this.isHostParked(this.host)) ? this.host : this.buildHost();
      if (this.host && this.host !== host) this.host.remove();
      for (const stray of main.querySelectorAll('[data-rt-ui="visual-search"]')) {
        if (stray !== host) stray.remove();
      }
      this.host = host;
      if (host.parentElement !== main || main.firstElementChild !== host) main.prepend(host);
      this.state = {
        status: 'idle',
        items: [],
        related: [],
        error: '',
        code: '',
        retryAt: 0,
        skippedCount: 0,
        page: 1,
        hasMore: false,
        nextPage: 0,
        loadingMore: false,
        loadMoreError: '',
        seenUuids: new Set(),
        subIconNodes: new Map(),
        masonryEl: null,
        masonryCols: [],
        colHeights: [],
        footEl: null,
        pollAttempt: 0,
        uploadStatusText: '',
        uploadPreviewUrl: this.readUploadPreview(parsed.uploadUuid || parsed.uploadHash),
        postSeed: parsed.postSeed ? this.readPostSeed(parsed.postSeed) : null,
        indexedViewId: parsed.viewId || '',
        parsed
      };
      this.renderHost();
      this.startLoad(parsed);
    }

    adoptPark(park, main, parsed) {
      this.stopVideoPreview();
      this.stopPolling();
      this.stopScrollRestore();
      this.moreIO?.disconnect();
      if (this.host && this.host !== park.host) this.host.remove();
      for (const stray of main.querySelectorAll('[data-rt-ui="visual-search"]')) {
        if (stray !== park.host) stray.remove();
      }
      this.host = park.host;
      this.state = park.state;
      this.state.parsed = parsed;
      this.mountedMain = main;
      this.activeKey = urlKey(location.href);
      this.activeSpecKey = parsed.spec ? Model.cacheKey(parsed.spec) : '';

      this.suppressNativeInMain(main);
      if (this.host.parentElement !== main || main.firstElementChild !== this.host) {
        main.prepend(this.host);
      }
      if (this.state.status === 'ready' && this.state.masonryCols?.length !== (isPhone() ? 2 : 3)) {
        this.renderHost();
      } else {
        this.observeMoreSentinel();
      }

      if (park.scrollY > 0 || park.clickedUuid) {
        this.restoreScrollAfterReturn(park);
      }
      this.settlePreviews();
      // If interrupted during active polling or loading, resume instead of leaving a dead spinner.
      if (['hashing', 'uploading', 'embedding', 'fetching'].includes(this.state.status)) {
        this.startLoad(parsed);
      }
    }

    restoreScrollAfterReturn(park) {
      this.stopScrollRestore();
      const host = this.host;
      if (!host) return;
      this.userScrolledRecently = false;
      host.setAttribute('data-rt-visual-restoring', '');
      const deadline = performance.now() + RETURN_RESTORE_MS;
      let stable = 0;

      const step = () => {
        if (this.dead || this.host !== host || !host.isConnected || this.userScrolledRecently || performance.now() >= deadline) {
          this.stopScrollRestore();
          return;
        }
        const tile = park.clickedUuid
          ? host.querySelector(`.rt-vs-tile[data-uuid="${globalThis.CSS?.escape ? globalThis.CSS.escape(park.clickedUuid) : String(park.clickedUuid).replace(/[^A-Za-z0-9_-]/g, '\\$&')}"]`)
          : null;
        const box = tile?.getBoundingClientRect?.();
        if (tile && box?.height > 0) {
          const delta = box.top - park.clickedOffset;
          if (Math.abs(delta) >= 2) {
            stable = 0;
            window.scrollBy({ top: delta, behavior: 'instant' });
          } else if (++stable >= 2) {
            this.stopScrollRestore();
            return;
          }
        } else if (park.scrollY > 0) {
          const max = Math.max(0, document.documentElement.scrollHeight - innerHeight);
          const target = Math.min(park.scrollY, max);
          if (Math.abs(window.scrollY - target) >= 2) {
            stable = 0;
            window.scrollTo({ top: target, behavior: 'instant' });
          } else if (++stable >= 2) {
            this.stopScrollRestore();
            return;
          }
        } else {
          this.stopScrollRestore();
          return;
        }
        this.restoreFrame = requestAnimationFrame(step);
      };
      step();
    }

    stopScrollRestore() {
      if (this.restoreFrame) {
        cancelAnimationFrame(this.restoreFrame);
        this.restoreFrame = 0;
      }
      this.host?.removeAttribute?.('data-rt-visual-restoring');
    }

    scrollOpenedPostToTop() {
      this.pendingPostScrollReset = false;
      clearTimeout(this.postScrollTimer);
      const started = performance.now();
      const step = () => {
        if (this.dead || this.userScrolledRecently || performance.now() - started > POST_SCROLL_WAIT_MS) return;
        if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'instant' });
        if (document.querySelector('shreddit-post[view-context="CommentsPage"]')) return;
        this.postScrollTimer = setTimeout(step, 50);
      };
      step();
    }

    savePark({ clickedUuid = '', clickedOffset = 0 } = {}) {
      if (!this.host || !this.state || !this.activeKey) return null;
      const entry = historyEntry();
      const key = this.activeKey;
      const park = {
        host: this.host,
        urlKey: key,
        state: { ...this.state },
        scrollY: window.scrollY || 0,
        clickedUuid,
        clickedOffset,
        parkedAt: Date.now(),
        settingsRev: this.settingsRevision
      };
      this.parks.delete(entry);
      this.parks.set(entry, park);
      this.urlParks.delete(key);
      this.urlParks.set(key, park);
      while (this.parks.size > MAX_PARKS) {
        const oldKey = this.parks.keys().next().value;
        this.parks.delete(oldKey);
      }
      while (this.urlParks.size > MAX_PARKS) {
        const oldKey = this.urlParks.keys().next().value;
        this.urlParks.delete(oldKey);
      }
      return park;
    }

    takePark(entryKey, currentUrl) {
      let park = this.parks.get(entryKey);
      if (park && park.urlKey !== currentUrl) park = null;
      if (!park) park = this.urlParks.get(currentUrl);
      if (!park) return null;
      if (Date.now() - park.parkedAt > PARK_TTL_MS) {
        this.parks.delete(entryKey);
        this.urlParks.delete(currentUrl);
        return null;
      }
      this.parks.delete(entryKey);
      this.urlParks.delete(currentUrl);
      return park;
    }

    startDeparture({ clickedUuid = '', clickedOffset = 0, expectPost = false } = {}) {
      if (!this.host?.isConnected || !this.mountedMain) return;
      this.stopVideoPreview();
      this.stopPolling();
      this.closeDropdown();
      this.savePark({ clickedUuid, clickedOffset });
      if (expectPost) {
        this.pendingPostScrollReset = true;
        this.userScrolledRecently = false;
      }
      const main = this.mountedMain;
      const host = this.host;
      clearTimeout(this.outgoing?.timer);
      const timer = setTimeout(() => {
        if (this.outgoing?.host === host) this.releaseOutgoing({ keepHost: false });
      }, LEAVE_FAILSAFE_MS);
      this.outgoing = { main, host, timer };
    }

    releaseOutgoing({ keepHost = false } = {}) {
      const out = this.outgoing;
      if (!out) return;
      this.outgoing = null;
      clearTimeout(out.timer);
      if (!keepHost) {
        this.moreIO?.disconnect();
        this.finishProgress();
        if (out.host === this.host) this.host = null;
        if (out.main?.isConnected) this.restoreHiddenNodes();
        out.host?.remove();
        this.mountedMain = null;
        this.activeKey = '';
        this.activeSpecKey = '';
        if (!Model.parseVisualUrl(location.href)?.active) {
          document.documentElement?.removeAttribute('data-rt-visual-active');
          document.documentElement?.removeAttribute('data-rt-visual-ready');
          this.notifyOtherModules();
        }
      }
    }

    unmountVisualHost() {
      if (!this.host && !this.hiddenNodes.size) return;
      this.stopVideoPreview();
      this.stopPolling();
      this.stopScrollRestore();
      this.moreIO?.disconnect();
      this.finishProgress();
      this.closeDropdown();
      this.host?.remove();
      this.host = null;
      this.mountedMain = null;
      this.activeKey = '';
      this.activeSpecKey = '';
      this.restoreHiddenNodes();
    }

    // ---- Top Orange Progress Bar -------------------------------------------------------------------------------

    ensureProgressBar() {
      if (this.progressBar?.isConnected) return this.progressBar;
      const bar = make('div', 'rt-vs-progress');
      bar.dataset.rtUi = 'visual-progress';
      bar.setAttribute('role', 'progressbar');
      bar.setAttribute('aria-label', 'Loading visual search results');
      (document.body || document.documentElement)?.append(bar);
      this.progressBar = bar;
      return bar;
    }

    startProgress() {
      clearTimeout(this.progressTimer);
      clearTimeout(this.settleTimer);
      const bar = this.ensureProgressBar();
      bar.classList.remove('is-finishing');
      bar.dataset.state = 'loading';
    }

    finishProgress() {
      const bar = this.progressBar;
      if (!bar) return;
      clearTimeout(this.progressTimer);
      bar.classList.add('is-finishing');
      this.progressTimer = setTimeout(() => {
        if (this.progressBar === bar) {
          bar.remove();
          this.progressBar = null;
        }
      }, 260);
    }

    // ---- Data Loading, Pagination & Upload Polling -------------------------------------------------------------

    stopPolling() {
      clearTimeout(this.pollTimer);
      this.pollTimer = 0;
    }

    async startLoad(parsed, { force = false } = {}) {
      const myGen = ++this.gen;
      this.stopPolling();
      this.moreIO?.disconnect();
      this.state.error = '';
      this.state.code = '';
      this.state.retryAt = 0;
      this.state.skippedCount = 0;
      this.state.page = 1;
      this.state.hasMore = false;
      this.state.nextPage = 0;
      this.state.loadingMore = false;
      this.state.loadMoreError = '';

      if (parsed.kind === 'post' && parsed.postSeed) {
        await this.loadSimilarFromPost(parsed, myGen, force);
        return;
      }

      if (parsed.kind === 'pending-upload' && parsed.uploadHash) {
        this.state.status = 'embedding';
        this.state.uploadStatusText = 'Finding images that look like yours…';
        this.state.pollHash = parsed.uploadHash;
        this.state.pollFilters = parsed.filters;
        this.state.pollAttempt = 0;
        this.renderHost();
        this.runPollStep(myGen);
        return;
      }

      if (!parsed.spec) {
        this.finishProgress();
        this.state.status = 'empty';
        this.renderHost();
        return;
      }

      this.startProgress();
      this.state.status = 'fetching';
      this.renderHost();

      const relatedPromise = (parsed.kind === 'search' && parsed.queryInfo.text)
        ? this.send({ action: 'related', query: parsed.queryInfo.text }).catch(() => ({ ok: true, items: [] }))
        : Promise.resolve({ ok: true, items: [] });

      try {
        const ask = () => this.send({
          action: 'query',
          kind: parsed.spec.kind,
          target: parsed.spec.target,
          slug: parsed.spec.slug,
          filters: parsed.spec.filters,
          page: 1,
          force
        });
        let result = await ask();
        if (this.dead || myGen !== this.gen) return;
        // A slow or dropped answer gets one quiet retry while the placeholders stay up.
        if (!result?.ok && RETRY_CODES.has(result?.code)) {
          await new Promise(r => setTimeout(r, 1500));
          if (this.dead || myGen !== this.gen) return;
          result = await ask();
          if (this.dead || myGen !== this.gen) return;
        }

        const rel = await relatedPromise;
        if (this.dead || myGen !== this.gen) return;
        this.state.related = Array.isArray(rel?.items) ? rel.items : [];

        if (!result?.ok) {
          this.state.status = result?.code === 'permission-required' ? 'permission-required' : 'error';
          this.state.error = result?.error || 'Could not load visual search results.';
          this.state.code = result?.code || 'visual-error';
          this.state.retryAt = result?.retryAt || 0;
          this.renderHost();
          return;
        }

        this.state.items = Array.isArray(result.items) ? [...result.items] : [];
        this.state.skippedCount = Number(result.skippedCount) || 0;
        this.state.page = Number(result.page) || 1;
        this.state.hasMore = Boolean(result.hasMore);
        this.state.nextPage = Number(result.nextPage) || 0;
        this.state.status = this.state.items.length ? 'ready' : 'empty';
        this.renderHost();
      } catch (err) {
        if (this.dead || myGen !== this.gen) return;
        this.state.status = 'error';
        this.state.error = err?.message || 'Unable to load visual search results.';
        this.renderHost();
      } finally {
        if (myGen === this.gen) this.finishProgress();
      }
    }

    async loadMore() {
      const st = this.state;
      if (this.dead || !this.enabled || !this.host?.isConnected || !st || st.status !== 'ready' || !st.hasMore || st.loadingMore || !st.parsed?.spec) return;
      const myGen = this.gen;
      const page = st.nextPage || (st.page + 1);
      st.loadingMore = true;
      st.loadMoreError = '';
      this.updateFooter();

      try {
        const res = await this.send({
          action: 'query',
          kind: st.parsed.spec.kind,
          target: st.parsed.spec.target,
          slug: st.parsed.spec.slug,
          filters: st.parsed.spec.filters,
          page
        });
        if (this.dead || myGen !== this.gen || this.state !== st) return;
        st.loadingMore = false;
        if (!res?.ok) {
          st.loadMoreError = res?.error || 'Could not load more results.';
          this.updateFooter();
          return;
        }
        const added = [];
        for (const it of res.items || []) {
          if (!st.seenUuids?.has(it.uuid)) {
            added.push(it);
            st.items.push(it);
          }
        }
        st.page = Number(res.page) || page;
        st.hasMore = Boolean(res.hasMore && res.nextPage > st.page);
        st.nextPage = res.hasMore ? Number(res.nextPage) || 0 : 0;
        st.skippedCount += Number(res.skippedCount) || 0;
        if (added.length) this.appendMasonryItems(added, st);
        this.updateFooter();
        this.settlePreviews();
      } catch (err) {
        if (this.dead || myGen !== this.gen || this.state !== st) return;
        st.loadingMore = false;
        st.loadMoreError = err?.message || 'Could not load more results.';
        this.updateFooter();
      }
    }

    async loadSimilarFromPost(parsed, myGen, force) {
      const { subreddit, postId } = parsed.postSeed;
      this.startProgress();
      this.state.status = 'fetching';
      this.renderHost();

      try {
        const res = await this.send({ action: 'resolve-post', subreddit, postId, force });
        if (this.dead || myGen !== this.gen) return;

        if (!res?.ok) {
          this.state.status = res?.code === 'permission-required' ? 'permission-required' : 'error';
          this.state.error = res?.error || 'Could not look up that post on infini.wtf.';
          this.state.code = res?.code || 'visual-error';
          this.renderHost();
          return;
        }

        if (res.indexed && res.viewId) {
          this.state.indexedViewId = res.viewId;
          this.state.parsed = { ...parsed, spec: { kind: 'view', target: res.viewId, filters: {} } };
          const queryRes = await this.send({ action: 'query', kind: 'view', target: res.viewId, page: 1, force });
          if (this.dead || myGen !== this.gen) return;
          if (!queryRes?.ok) {
            this.state.status = 'error';
            this.state.error = queryRes?.error || 'Could not load similar visual results.';
            this.renderHost();
            return;
          }
          this.state.items = Array.isArray(queryRes.items) ? [...queryRes.items] : [];
          this.state.skippedCount = Number(queryRes.skippedCount) || 0;
          this.state.page = Number(queryRes.page) || 1;
          this.state.hasMore = Boolean(queryRes.hasMore);
          this.state.nextPage = Number(queryRes.nextPage) || 0;
          this.state.status = this.state.items.length ? 'ready' : 'empty';
          this.renderHost();
          return;
        }

        // When the page has no still or only a provider's copy, prefer Reddit's copy from the post data.
        // The source image and YouTube thumbnails already have supported read paths.
        const pageStill = this.state.postSeed?.fallbackImageUrl || '';
        if (!pageStill || !(redditImage(pageStill) || /^https:\/\/i\.ytimg\.com\//.test(pageStill))) {
          const still = await postStill(postId);
          if (this.dead || myGen !== this.gen) return;
          if (still) {
            this.state.postSeed = { ...(this.state.postSeed || { subreddit, postId, title: '' }), fallbackImageUrl: still };
            this.savePostSeed(this.state.postSeed);
          }
        }
        // From the media lens the reader asked to search with this picture, so it is uploaded (resized, metadata
        // stripped) as an image search; from the ⋯ menu they choose.
        if (this.state.postSeed?.autoUpload && this.state.postSeed.fallbackImageUrl) {
          this.uploadAndSearch(this.state.postSeed.fallbackImageUrl, { filters: parsed.filters });
          return;
        }
        this.state.status = 'not-indexed';
        this.renderHost();
      } catch (err) {
        if (this.dead || myGen !== this.gen) return;
        this.state.status = 'error';
        this.state.error = err?.message || 'Could not resolve that post.';
        this.renderHost();
      } finally {
        if (myGen === this.gen) this.finishProgress();
      }
    }

    async uploadAndSearch(fileOrUrl, { filters = null } = {}) {
      if (this.dead || !this.enabled) return;
      const onVisual = Boolean(Model.parseVisualUrl(location.href)?.active);
      const nextFilters = filters || Model.parseVisualUrl(location.href)?.filters || {};
      const myGen = ++this.gen;
      this.stopPolling();

      let thumbDataUrl = '';
      let previewUrl = '';
      if (onVisual) {
        this.closeUploadPopover();
        Sheet?.close?.();
        if (!this.host || !this.state) {
          const main = document.querySelector('main');
          if (main) this.mountFreshVisual(main, Model.parseVisualUrl(location.href), urlKey(location.href));
        }
      }

      try {
        let blob = fileOrUrl;
        if (onVisual && this.state) {
          this.state.status = 'hashing';
          this.state.uploadStatusText = 'Preparing your image…';
          this.renderHost();
        }
        if (typeof fileOrUrl === 'string') {
          try {
            const url = new URL(fileOrUrl.replace(/&amp;/gi, '&'));
            if (url.protocol === 'https:' && !url.username && !url.password && !url.port) {
              const response = await fetch(url.href, {
                credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
                signal: AbortSignal.timeout(10_000)
              });
              if (response.ok) blob = await response.blob();
            }
          } catch {}
          if (this.dead || myGen !== this.gen) return;
          if (typeof blob === 'string') {
            const still = await this.send({ action: 'fetch-still', url: fileOrUrl });
            if (this.dead || myGen !== this.gen) return;
            if (!still?.ok) throw Object.assign(
              Error(still?.error || 'Could not read this post’s picture.'), { code: still?.code }
            );
            blob = base64ToBlob(still.base64, still.mimeType);
          }
        }
        const prep = await this.prepareImage(blob);
        if (this.dead || myGen !== this.gen) {
          URL.revokeObjectURL(prep.previewUrl);
          return;
        }
        this.trackPreviewUrl(prep.previewUrl);
        previewUrl = prep.previewUrl;
        thumbDataUrl = prep.thumbDataUrl || '';
        if (onVisual && this.state) {
          this.state.uploadPreviewUrl = previewUrl;
          this.state.status = 'uploading';
          this.state.uploadStatusText = 'Uploading your image…';
          this.renderHost();
        }

        const up = await this.send({ action: 'upload-image', dataBase64: prep.dataBase64, mimeType: prep.mimeType });
        if (this.dead || myGen !== this.gen) return;
        if (!up?.ok) {
          if (onVisual && this.state) {
            this.state.status = up?.code === 'permission-required' ? 'permission-required' : 'error';
            this.state.error = up?.error || 'Could not upload that image.';
            this.state.code = up?.code || 'visual-error';
            this.renderHost();
          } else {
            this.showPopoverError(up?.error || 'Could not upload that image.');
          }
          return;
        }

        const storedThumb = thumbDataUrl || previewUrl;
        if (up.uuid) this.saveUploadPreview(up.uuid, storedThumb);
        if (up.hash) this.saveUploadPreview(up.hash, storedThumb);

        if (!onVisual) {
          this.closeUploadPopover();
          Sheet?.close?.();
          const dest = up.hasEmbedding && up.uuid
            ? Model.buildVisualUrl(location.href, { basePath: '/search/', q: this.currentQuery(), uploadUuid: up.uuid, filters: nextFilters, cleanNav: true })
            : Model.buildVisualUrl(location.href, { basePath: '/search/', q: this.currentQuery(), uploadHash: up.hash, filters: nextFilters, cleanNav: true });
          this.navigateUrl(dest.href);
          return;
        }

        if (up.hasEmbedding && up.uuid) {
          this.commitUploadUuid(up.uuid, nextFilters);
          return;
        }

        this.state.status = 'embedding';
        this.state.uploadStatusText = 'Finding images that look like yours…';
        this.state.pollHash = up.hash;
        this.state.pollFilters = nextFilters;
        this.state.pollAttempt = 0;
        this.renderHost();
        this.schedulePoll(myGen);
      } catch (err) {
        if (this.dead || myGen !== this.gen) return;
        if (onVisual && this.state) {
          this.state.status = err?.code === 'permission-required' ? 'permission-required' : 'error';
          this.state.error = err?.message || 'Unable to process image.';
          this.state.code = err?.code || 'visual-error';
          this.renderHost();
        } else {
          this.showPopoverError(err?.message || 'Unable to process image.');
        }
      }
    }

    schedulePoll(myGen) {
      this.stopPolling();
      if (document.visibilityState === 'hidden') return; // Paused in background; handleVisibility resumes immediately.
      this.pollTimer = setTimeout(() => this.runPollStep(myGen), POLL_INTERVAL_MS);
    }

    async runPollStep(myGen) {
      if (this.dead || myGen !== this.gen || !this.state?.pollHash) return;
      if (this.state.pollAttempt >= MAX_POLLS) {
        this.state.status = 'error';
        this.state.error = 'infini.wtf is taking longer than expected to analyze that image.';
        this.renderHost();
        return;
      }
      this.state.pollAttempt++;
      try {
        const res = await this.send({ action: 'check-image-query', hash: this.state.pollHash });
        if (this.dead || myGen !== this.gen) return;
        if (res?.ok && res.hasEmbedding && res.uuid) {
          this.saveUploadPreview(res.uuid, this.state.uploadPreviewUrl);
          this.commitUploadUuid(res.uuid, this.state.pollFilters);
          return;
        }
        if (res?.ok) {
          // A new picture can take infini.wtf up to half a minute: say so instead of an unexplained wait.
          if (this.state.pollAttempt === 5 && this.state.status === 'embedding') {
            this.state.uploadStatusText = 'Still analysing the picture. This can take up to half a minute…';
            this.renderHost();
          }
          this.schedulePoll(myGen);
          return;
        }
        this.state.status = 'error';
        this.state.error = res?.error || 'Could not check visual analysis status.';
        this.renderHost();
      } catch {
        if (this.dead || myGen !== this.gen) return;
        this.schedulePoll(myGen);
      }
    }

    handleVisibility() {
      if (document.visibilityState === 'hidden') {
        this.stopVideoPreview();
        this.stopPolling();
      } else if (this.state?.status === 'embedding' && this.state.pollHash) {
        this.runPollStep(this.gen);
      }
    }

    commitUploadUuid(uuid, filters) {
      const cur = Model.parseVisualUrl(location.href);
      const next = Model.buildVisualUrl(location.href, {
        basePath: cur?.scope?.surface === 'user' ? '/search/' : cur?.scope?.path || '/search/',
        q: this.currentQuery(),
        uploadUuid: uuid,
        filters,
        cleanNav: true
      });
      // A post's own image (lens or ⋯ menu) replaces that post's search entry: Back then returns to where the search
      // started, instead of to the post entry, which would upload and move forward again.
      if (cur?.kind === 'pending-upload' || cur?.kind === 'post') this.replaceVisualUrl(next);
      else this.pushVisualUrl(next);
    }

    // ---- Rendering (Pure DOM APIs only — zero innerHTML) -------------------------------------------------------

    buildHost() {
      const host = make('section', 'rt-vs-root');
      host.dataset.rtUi = 'visual-search';
      host.setAttribute('aria-label', 'Visual search results');
      host.addEventListener('dragover', e => {
        if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
        e.preventDefault();
        host.dataset.dragging = 'true';
      });
      host.addEventListener('dragleave', () => { delete host.dataset.dragging; });
      host.addEventListener('drop', e => {
        delete host.dataset.dragging;
        const file = [...(e.dataTransfer?.files || [])].find(f => f.type?.startsWith('image/'));
        if (!file) return;
        e.preventDefault();
        this.uploadAndSearch(file);
      });
      return host;
    }

    renderHost() {
      const host = this.host;
      const st = this.state;
      if (!host || !st) return;
      const parsed = st.parsed;
      const parts = [];

      // 1. Controls bar
      parts.push(this.buildControls(parsed));

      // 2. Scope / seed / stripped-operators banner
      const banner = this.buildBanner(parsed, st);
      if (banner) parts.push(banner);

      // 3. Related searches chips
      if (st.related?.length && st.status !== 'permission-required') {
        const row = make('div', 'rt-vs-related');
        row.setAttribute('aria-label', 'Related visual searches');
        row.append(make('span', 'rt-vs-related-label', 'Related:'));
        for (const item of st.related) {
          const pill = make('button', 'rt-vs-related-pill', item.label);
          pill.type = 'button';
          pill.addEventListener('click', () => {
            const dest = Model.buildVisualUrl(location.href, {
              basePath: '/search/',
              q: item.label,
              filters: parsed.filters,
              cleanNav: true
            });
            if (urlKey(dest.href) === urlKey(location.href)) return;
            this.savePark();
            this.startProgress();
            const dp = Model.parseVisualUrl(dest.href);
            if (dp?.spec) {
              this.send({ action: 'query', kind: dp.spec.kind, target: dp.spec.target, slug: dp.spec.slug, filters: dp.spec.filters, page: 1 }).catch(() => {});
            }
            this.navigateUrl(dest.href);
          });
          row.append(pill);
        }
        parts.push(row);
      }

      // 4. Body state
      this.moreIO?.disconnect();
      if (['hashing', 'uploading', 'embedding', 'fetching'].includes(st.status)) {
        if (st.uploadStatusText) {
          const status = make('div', 'rt-community-state');
          const head = make('div', 'rt-community-state-head');
          const spin = make('span', 'rt-community-spinner');
          spin.append(icon('camera', 18));
          head.append(spin, make('span', 'rt-community-state-title', st.uploadStatusText));
          status.append(head);
          if (st.status === 'embedding') {
            const actions = make('div', 'rt-community-state-actions');
            const cancelBtn = make('button', 'rt-community-action', 'Cancel');
            cancelBtn.type = 'button';
            cancelBtn.addEventListener('click', () => {
              this.stopPolling();
              this.gen++;
              const popular = Model.buildVisualUrl(location.href, { q: this.currentQuery(), popular: true, filters: parsed.filters });
              this.replaceVisualUrl(popular);
            });
            actions.append(cancelBtn);
            status.append(actions);
          }
          parts.push(status);
        }
        parts.push(this.buildSkeletonGrid());
      } else if (st.status === 'not-indexed') {
        parts.push(this.buildNotIndexedCard(parsed, st));
      } else if (st.status === 'permission-required' || st.status === 'error') {
        parts.push(this.buildErrorCard(st));
      } else if (st.status === 'empty') {
        parts.push(this.buildEmptyCard(parsed));
      } else if (st.status === 'ready') {
        parts.push(this.buildResultsMasonry(st.items, st));
        const foot = this.buildLimitFooter(parsed, st);
        st.footEl = foot;
        parts.push(foot);
      }

      host.replaceChildren(...parts);
      if (this.hoveredPreview && !this.hoveredPreview.media.isConnected) this.stopVideoPreview();
      if (st.status === 'ready') {
        this.observeMoreSentinel();
        this.settlePreviews();
      }
    }

    hasHeaderLens() {
      const lens = '[data-rt-ui="visual-search-trigger"]';
      if (document.querySelector(lens)) return true;
      return [...document.querySelectorAll('reddit-search-large, reddit-search-small')].some(host => host.shadowRoot?.querySelector?.(lens));
    }

    buildControls(parsed) {
      const bar = make('div', 'rt-vs-controls');
      bar.dataset.rtUi = 'visual-controls';

      const uploadBtn = make('button', 'rt-search-inline-filter');
      uploadBtn.type = 'button';
      uploadBtn.dataset.rtVisualControl = 'upload';
      uploadBtn.classList.add('rt-vs-lens-btn');
      uploadBtn.setAttribute('aria-haspopup', 'dialog');
      const lensLabel = parsed.kind === 'upload' ? 'Change image' : 'Search with an image';
      uploadBtn.title = lensLabel;
      uploadBtn.setAttribute('aria-label', lensLabel);
      uploadBtn.append(lensIcon(18));
      uploadBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        this.openUploadUi(uploadBtn);
      });
      // The lens in Reddit's search bar opens the same image search: only when it is missing does the row get one.
      if (!this.hasHeaderLens()) bar.append(uploadBtn);

      const supportsFilter = parsed.kind !== 'view' && parsed.kind !== 'post';
      if (supportsFilter) {
        const mediaText = MEDIA_LABELS.find(([v]) => v === parsed.filters.mediaType)?.[1] || 'All media';
        const mediaBtn = make('button', 'rt-search-inline-filter');
        mediaBtn.type = 'button';
        mediaBtn.dataset.rtVisualControl = 'media';
        mediaBtn.dataset.active = String(Boolean(parsed.filters.mediaType));
        mediaBtn.setAttribute('aria-haspopup', 'true');
        mediaBtn.setAttribute('aria-expanded', 'false');
        mediaBtn.append(make('span', '', parsed.filters.mediaType ? mediaText : 'Media type'), icon('caret', 14));
        mediaBtn.addEventListener('click', () => this.openChoiceMenu(mediaBtn, 'media', 'Media type', MEDIA_LABELS, parsed.filters.mediaType, value => {
          this.applyFilterPatch({ mediaType: value });
        }));

        const timeText = TIME_LABELS.find(([v]) => v === parsed.filters.time)?.[1] || 'All time';
        const timeBtn = make('button', 'rt-search-inline-filter');
        timeBtn.type = 'button';
        timeBtn.dataset.rtVisualControl = 'time';
        timeBtn.dataset.active = String(Boolean(parsed.filters.time));
        timeBtn.setAttribute('aria-haspopup', 'true');
        timeBtn.setAttribute('aria-expanded', 'false');
        timeBtn.append(make('span', '', parsed.filters.time ? timeText : 'Time'), icon('caret', 14));
        timeBtn.addEventListener('click', () => this.openChoiceMenu(timeBtn, 'time', 'Time', TIME_LABELS, parsed.filters.time, value => {
          this.applyFilterPatch({ time: value });
        }));

        const nsfwBtn = make('button', 'rt-search-inline-filter rt-vs-filter-nsfw');
        nsfwBtn.type = 'button';
        nsfwBtn.dataset.rtVisualControl = 'nsfw';
        nsfwBtn.setAttribute('aria-pressed', String(parsed.filters.nsfw));
        nsfwBtn.title = 'Include NSFW visual results (uses a separate infini.wtf index)';
        nsfwBtn.append(nsfwIcon(14), make('span', 'rt-community-nsfw-tag', 'NSFW'));
        nsfwBtn.addEventListener('click', () => {
          const nextNsfw = !parsed.filters.nsfw;
          if (!nextNsfw) {
            this.send({ action: 'clear-cache', nsfwOnly: true }).catch(() => {});
          }
          this.applyFilterPatch({ nsfw: nextNsfw });
        });

        bar.append(mediaBtn, timeBtn, nsfwBtn);

        if (parsed.filters.mediaType || parsed.filters.time || parsed.filters.nsfw) {
          const clearBtn = make('button', 'rt-search-inline-filter rt-vs-clear-btn');
          clearBtn.type = 'button';
          clearBtn.dataset.rtVisualControl = 'clear';
          clearBtn.append(make('span', '', 'Clear'));
          clearBtn.addEventListener('click', () => {
            if (parsed.filters.nsfw) this.send({ action: 'clear-cache', nsfwOnly: true }).catch(() => {});
            this.applyFilterPatch({ mediaType: '', time: '', nsfw: false });
          });
          bar.append(clearBtn);
        }
      } else if (parsed.kind === 'view') {
        const noteBtn = make('button', 'rt-search-inline-filter');
        noteBtn.type = 'button';
        noteBtn.title = 'infini.wtf similarity views cannot be filtered; switch to popular or image search to filter.';
        noteBtn.append(make('span', '', 'Browse popular (filterable)'));
        noteBtn.addEventListener('click', () => {
          const dest = Model.buildVisualUrl(location.href, { basePath: '/search/', q: this.currentQuery(), popular: true, filters: parsed.filters });
          this.pushVisualUrl(dest);
        });
        bar.append(noteBtn);
      }

      return bar;
    }

    buildBanner(parsed, st) {
      // Show context banner for upload searches, similar-post searches, scoped notices, or stripped operators.
      if (parsed.kind === 'upload') {
        const banner = make('div', 'rt-vs-banner');
        const lead = make('div', 'rt-vs-banner-lead');
        if (st.uploadPreviewUrl) {
          const img = make('img', 'rt-vs-seed-thumb');
          img.src = st.uploadPreviewUrl;
          img.alt = 'Your image';
          lead.append(img);
        }
        const copy = make('div', 'rt-vs-banner-copy');
        copy.append(
          make('span', 'rt-vs-banner-title', 'Your image'),
          make('span', 'rt-vs-banner-sub', 'Posts with images and videos that look like it')
        );
        lead.append(copy);
        const actions = make('div', 'rt-vs-banner-actions');
        const remove = make('button', 'rt-community-action', 'Remove image');
        remove.type = 'button';
        remove.addEventListener('click', () => {
          // Back to the words searched for, or to popular posts when there were none.
          const q = this.currentQuery();
          const dest = Model.buildVisualUrl(location.href, q ? { basePath: '/search/', q, filters: parsed.filters } : { basePath: '/search/', q: '', popular: true, filters: parsed.filters });
          this.pushVisualUrl(dest);
        });
        actions.append(remove);
        banner.append(lead, actions);
        return banner;
      }

      if (parsed.kind === 'view' || parsed.kind === 'post') {
        const banner = make('div', 'rt-vs-banner');
        const lead = make('div', 'rt-vs-banner-lead');
        if (st.postSeed?.fallbackImageUrl) {
          const img = make('img', 'rt-vs-seed-thumb');
          img.src = st.postSeed.fallbackImageUrl;
          img.alt = '';
          img.referrerPolicy = 'no-referrer';
          lead.append(img);
        }
        const copy = make('div', 'rt-vs-banner-copy');
        const heading = st.postSeed?.title ? 'Visually similar to “' + st.postSeed.title + '”'
          : parsed.postSeed ? 'Visually similar to r/' + parsed.postSeed.subreddit + ' post'
          : 'Visually similar results';
        const subline = parsed.kind === 'view'
          ? 'infini.wtf similarity matches do not apply Safe/Media/Time filters.'
          : ['hashing', 'uploading', 'embedding'].includes(st.status) ? 'Not in infini.wtf’s index yet: searching with its picture'
          : st.status === 'ready' || st.status === 'empty' ? 'Searched with this post’s picture'
          : st.status === 'error' || st.status === 'permission-required' || st.status === 'not-indexed' ? ''
          : 'Checking infini.wtf index…';
        copy.append(make('span', 'rt-vs-banner-title', heading), make('span', 'rt-vs-banner-sub', subline));
        lead.append(copy);
        const actions = make('div', 'rt-vs-banner-actions');
        if (st.postSeed?.fallbackImageUrl && parsed.kind === 'view') {
          const filterable = make('button', 'rt-community-action', 'Filterable image search');
          filterable.type = 'button';
          filterable.addEventListener('click', () => this.uploadAndSearch(st.postSeed.fallbackImageUrl, { filters: parsed.filters }));
          actions.append(filterable);
        }
        if (parsed.postSeed) {
          const openPost = make('a', 'rt-community-action', 'Source post');
          openPost.href = 'https://www.reddit.com/r/' + encodeURIComponent(parsed.postSeed.subreddit) + '/comments/' + encodeURIComponent(parsed.postSeed.postId) + '/';
          actions.append(openPost);
        }
        banner.append(lead, actions);
        return banner;
      }

      // Keyword search inside a community/profile or with stripped Reddit operators: explain scope honestly.
      const needsScopeNote = (parsed.scope.surface === 'subreddit' || parsed.scope.surface === 'user') && parsed.kind === 'search';
      if (needsScopeNote || parsed.queryInfo.stripped.length) {
        const banner = make('div', 'rt-vs-banner');
        const lead = make('div', 'rt-vs-banner-lead');
        const copy = make('div', 'rt-vs-banner-copy');
        const title = needsScopeNote
          ? 'Visual keyword search covers all of Reddit'
          : 'Reddit search filters omitted from visual query';
        const sub = parsed.queryInfo.stripped.length
          ? 'Ignored Reddit syntax: ' + parsed.queryInfo.stripped.join(', ')
          : 'infini.wtf supports keyword search globally or community browsing without keywords.';
        copy.append(make('span', 'rt-vs-banner-title', title), make('span', 'rt-vs-banner-sub', sub));
        lead.append(copy);
        banner.append(lead);
        if (parsed.scope.surface === 'subreddit') {
          const actions = make('div', 'rt-vs-banner-actions');
          const browseSub = make('button', 'rt-community-action', 'Browse r/' + parsed.scope.name + ' visually');
          browseSub.type = 'button';
          browseSub.addEventListener('click', () => {
            const dest = Model.buildVisualUrl(location.href, { basePath: parsed.scope.path, q: '', filters: parsed.filters });
            this.pushVisualUrl(dest);
          });
          actions.append(browseSub);
          banner.append(actions);
        }
        return banner;
      }

      return null;
    }

    // Reddit's Media tab placeholder row (measured 2026-11-24): per column a 128 px block, a 16 px line and a 40 px
    // block, each shimmer-placeholder bg-shimmer rounded-2 with a 4 px gap; three columns, two on phones.
    buildSkeletonGrid() {
      const grid = make('div', 'rt-vs-skeleton');
      grid.setAttribute('role', 'article');
      grid.setAttribute('aria-label', 'Loading');
      const count = isPhone() ? 2 : 3;
      for (let i = 0; i < count; i++) {
        const cell = make('div', 'rt-vs-skeleton-cell');
        for (const h of ['h-5xl', 'h-md', 'h-[40px]']) cell.append(make('div', 'shimmer-placeholder ' + h + ' w-100 mb-2xs bg-shimmer rounded-2'));
        grid.append(cell);
      }
      return grid;
    }

    // Reddit's 16 px community icon: its image over the community colour, or the community-fill glyph in that colour.
    buildSubIcon(sub) {
      const outer = make('span', 'inline-flex items-center justify-center w-md h-md relative me-2xs shreddit-subreddit-icon__icon rt-vs-sub-icon');
      outer.setAttribute('aria-hidden', 'true');
      const inner = make('span', 'inline-block rounded-full relative h-full w-full overflow-hidden');
      outer.append(inner);
      const glyph = () => {
        const svg = Filters?.svgIcon?.('community-fill', 16) || icon('similar', 16);
        svg.setAttribute('class', 'flex items-center w-full h-full');
        const color = CommunityIcons?.color?.(sub);
        if (color) svg.style.color = color;
        return svg;
      };
      const show = url => {
        if (!url) { inner.replaceChildren(glyph()); return; }
        const img = make('img', 'mb-0 w-full h-full rt-vs-sub-avatar');
        img.alt = '';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        const color = CommunityIcons?.color?.(sub);
        if (color) img.style.background = color;
        img.addEventListener('error', () => inner.replaceChildren(glyph()), { once: true });
        img.src = url;
        inner.replaceChildren(img);
      };
      const known = CommunityIcons?.peek?.(sub);
      if (typeof known === 'string' && known) { show(known); return outer; }
      inner.append(glyph());
      // Each icon waits on the shared loader itself (it de-duplicates requests), so icons fill in after Load more,
      // a parked return or a new search alike.
      if (known === undefined) Promise.resolve(CommunityIcons?.get?.(sub)).then(url => { if (!this.dead) show(url || null); }, () => {});
      return outer;
    }

    createTileNode(item, st) {
      const tile = make('article', 'rt-vs-tile');
      tile.dataset.uuid = item.uuid;

      const mediaWrap = make('div', 'rt-vs-media-wrap');
      const media = make('div', 'rt-vs-media bg-neutral-background-weak rounded-2 overflow-hidden');
      media.style.aspectRatio = String(item.aspectRatio > 0 ? item.aspectRatio : 1);
      if (item.videoUrl) {
        media.dataset.videoUrl = item.videoUrl;
        media.dataset.kind = item.isGif ? 'gif' : 'video';
      }

      const link = make('a', 'rt-vs-card-link no-underline');
      link.href = item.permalink;

      const thumbUrl = item.thumb || item.src;
      if (thumbUrl) {
        const img = make('img', 'rt-vs-img');
        img.src = thumbUrl;
        if (item.srcset) img.srcset = item.srcset;
        img.sizes = isPhone() ? '(max-width: 767px) 46vw, 350px' : '(min-width: 768px) 347px, 46vw';
        img.alt = item.title || 'Reddit post media';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('load', () => {
          if (!item.aspectRatio && img.naturalWidth > 0 && img.naturalHeight > 0) {
            const realRatio = Math.min(2.4, Math.max(0.42, img.naturalWidth / img.naturalHeight));
            item.aspectRatio = Number(realRatio.toFixed(4));
            media.style.aspectRatio = String(item.aspectRatio);
          }
        }, { once: true });
        img.addEventListener('error', () => {
          if (!media.querySelector('.rt-vs-img-fallback')) {
            img.remove();
            media.append(make('span', 'rt-vs-img-fallback', 'Thumbnail unavailable'));
          }
        }, { once: true });
        media.append(img);
      } else {
        media.append(make('span', 'rt-vs-img-fallback', 'Media preview unavailable'));
      }

      // Video posters share the feed and viewer's Play mark. GIFs keep their own corner badge.
      if (item.isVideo) {
        const badge = item.isGif ? make('span', 'rt-vs-badge') : Overlay.center(make('span', 'rt-vs-badge rt-vs-video-mark'));
        badge.setAttribute('role', 'img');
        badge.setAttribute('aria-label', item.isGif ? 'GIF' : 'Video');
        badge.dataset.kind = item.isGif ? 'gif' : 'video';
        badge.append(item.isGif ? (Filters?.svgIcon?.('gif-post-outline', 16) || make('span', '', 'GIF')) : Overlay.mark(document));
        media.append(badge);
      }

      link.append(media);

      // Mouse: icon buttons on hover, beside <a> so controls are never nested in a link. Touch: the ⋯ menu below.
      const actions = make('div', 'rt-vs-overlay-actions');
      const simBtn = make('button', 'rt-vs-icon-btn rt-vs-sim');
      simBtn.type = 'button';
      simBtn.title = 'Find visually similar';
      simBtn.setAttribute('aria-label', 'Find visually similar');
      simBtn.append(icon('similar', 16));
      simBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        this.findSimilar(item);
      });

      const prevBtn = make('button', 'rt-vs-icon-btn rt-vs-expand');
      prevBtn.type = 'button';
      prevBtn.title = 'View larger';
      prevBtn.setAttribute('aria-label', 'View larger');
      prevBtn.append(icon('expand', 16));
      prevBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        this.openLightbox(item, prevBtn);
      });

      actions.append(simBtn, prevBtn);
      mediaWrap.append(link, actions);

      // Reddit's tile footer: mt-2xs community row (16 px icon, 14 px semibold weak text), then a 2-line title.
      const subRow = make('div', 'rt-vs-sub-row mt-2xs');
      if (item.subreddit) {
        const isUser = item.subreddit.startsWith('u_');
        const label = isUser ? 'u/' + item.subreddit.slice(2) : 'r/' + item.subreddit;
        const subLink = make('a', 'rt-vs-sub-link flex items-center text-neutral-content-weak font-semibold');
        subLink.href = isUser
          ? 'https://www.reddit.com/user/' + encodeURIComponent(item.subreddit.slice(2)) + '/'
          : 'https://www.reddit.com/r/' + encodeURIComponent(item.subreddit) + '/';
        const iconBox = make('span', 'flex shrink-0 items-center');
        if (!isUser) iconBox.append(this.buildSubIcon(item.subreddit));
        subLink.append(iconBox, make('span', 'truncate', label));
        subRow.append(subLink);
      } else {
        subRow.append(make('span', 'rt-vs-sub-link text-neutral-content-weak font-semibold', 'Reddit'));
      }
      const more = make('button', 'rt-vs-more-btn');
      more.type = 'button';
      more.setAttribute('aria-label', 'More options');
      more.setAttribute('aria-haspopup', 'dialog');
      more.append(icon('overflow', 16));
      more.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        this.openTileOptions(item, more);
      });
      subRow.append(more);

      const titleLink = make('a', 'rt-vs-card-link rt-vs-title no-underline text-sm font-semibold mt-2xs text-neutral-content-strong line-clamp-2', item.title || 'Untitled Reddit post');
      titleLink.href = item.permalink;

      tile.append(mediaWrap, subRow, titleLink);
      return tile;
    }

    findSimilar(item) {
      if (item?.native) { this.closeLightbox({ restoreFocus: false }); this.searchFromPost(item); return; }
      this.closeLightbox();
      const dest = Model.buildVisualUrl(location.href, {
        basePath: '/search/',
        q: this.currentQuery(),
        viewId: item.viewId || item.uuid,
        cleanNav: true
      });
      this.pushVisualUrl(dest);
    }

    // The search's own words, kept in q so Reddit still shows its All tab (it drops All when q is empty).
    currentQuery() {
      try { return (new URLSearchParams(location.search).get('q') || '').trim(); }
      catch { return ''; }
    }

    // Touch: one bottom sheet for everything a tile offers, like Reddit's own ⋯ post menu.
    openTileOptions(item, anchor) {
      const playing = this.hoveredPreview?.media?.closest?.('.rt-vs-tile')?.dataset?.uuid === item.uuid && Boolean(this.hoveredPreview?.video);
      const media = [...(this.host?.querySelectorAll?.('.rt-vs-tile') || [])].find(tile => tile.dataset.uuid === item.uuid)?.querySelector('.rt-vs-media');
      const download = () => this.downloadItem(item);
      if (!Sheet) { this.openLightbox(item, anchor); return; }
      Sheet.open({
        title: item.title || 'Visual result',
        returnFocus: anchor,
        build: (body, ui) => {
          if (item.videoUrl && media) {
            ui.row({
              label: playing ? 'Stop preview' : (item.isGif ? 'Play GIF here' : 'Play preview here'),
              subtitle: playing ? '' : 'Muted, in the grid',
              icon: icon(playing ? 'close' : 'play', 20),
              onSelect: () => { if (playing) this.stopVideoPreview(); else this.startPreview(media, { manual: true }); }
            });
          }
          ui.row({ label: 'Find visually similar', icon: icon('similar', 20), onSelect: () => this.findSimilar(item) });
          ui.row({ label: 'View larger', icon: icon('expand', 20), onSelect: () => this.openLightbox(item, anchor) });
          if (item.videoUrl || item.src || item.thumb || item.downloadUrl) ui.row({ label: 'Download', icon: icon('download', 20), onSelect: download });
          ui.row({ label: 'Open post', icon: Filters?.svgIcon?.('comment', 20) || null, onSelect: () => this.openResultPost(item, { source: 'media' }) });
        }
      });
    }

    appendMasonryItems(items, st) {
      if (!st.masonryCols?.length) return;
      for (const item of items) {
        if (st.seenUuids?.has(item.uuid)) continue;
        st.seenUuids?.add(item.uuid);
        let minIdx = 0;
        for (let i = 1; i < st.colHeights.length; i++) {
          if (st.colHeights[i] < st.colHeights[minIdx]) minIdx = i;
        }
        const tile = this.createTileNode(item, st);
        const ratio = item.aspectRatio > 0 ? item.aspectRatio : 1;
        st.masonryCols[minIdx].append(tile);
        st.colHeights[minIdx] += (1 / ratio + 0.24);
      }
    }

    buildResultsMasonry(items, st) {
      const colCount = isPhone() ? 2 : 3;
      const masonry = make('div', 'rt-vs-masonry');
      const cols = [];
      const heights = new Array(colCount).fill(0);
      for (let i = 0; i < colCount; i++) {
        const col = make('div', 'rt-vs-col');
        cols.push(col);
        masonry.append(col);
      }
      st.masonryEl = masonry;
      st.masonryCols = cols;
      st.colHeights = heights;
      st.seenUuids = new Set();
      this.appendMasonryItems(items, st);
      return masonry;
    }

    observeMoreSentinel() {
      this.moreIO?.disconnect();
      const foot = this.state?.footEl;
      if (!foot || !foot.isConnected || !this.moreIO) return;
      if (this.state.status === 'ready' && this.state.hasMore && !this.state.loadingMore && !this.state.loadMoreError) {
        this.moreIO.observe(foot);
      }
    }

    updateFooter() {
      const st = this.state;
      if (!st?.footEl?.isConnected || !st.parsed) return;
      const next = this.buildLimitFooter(st.parsed, st);
      st.footEl.replaceWith(next);
      st.footEl = next;
      this.observeMoreSentinel();
    }

    // Below the grid: nothing while idle (an invisible sentinel loads the next page), Reddit's placeholder row while
    // loading, and a short retry line if a page failed. No count bar and no Media tab link (the tabs are right above).
    buildLimitFooter(parsed, st) {
      const foot = make('div', 'rt-vs-foot');
      foot.dataset.state = st.loadingMore ? 'loading' : st.loadMoreError ? 'error' : st.hasMore ? 'more' : 'end';
      if (st.loadingMore) {
        foot.append(this.buildSkeletonGrid());
      } else if (st.loadMoreError) {
        foot.append(make('span', 'rt-vs-foot-msg', 'Couldn’t load more results.'));
        const retry = make('button', 'rt-community-action', 'Try again');
        retry.type = 'button';
        retry.addEventListener('click', () => this.loadMore());
        foot.append(retry);
      }
      return foot;
    }

    buildNotIndexedCard(parsed, st) {
      const card = make('div', 'rt-community-state');
      const head = make('div', 'rt-community-state-head');
      const iconBox = make('span', 'rt-community-state-icon');
      iconBox.append(icon('camera', 20));
      head.append(iconBox, make('span', 'rt-community-state-title', 'This post is not in infini.wtf’s index yet'));
      card.append(head);
      card.append(make('p', 'rt-community-state-body', 'You can upload this post’s image to find visually similar matches, or search by its title instead.'));
      const actions = make('div', 'rt-community-state-actions');
      if (st.postSeed?.fallbackImageUrl) {
        const upBtn = make('button', 'rt-community-action rt-community-action-primary', 'Upload post image to search visually');
        upBtn.type = 'button';
        upBtn.addEventListener('click', () => this.uploadAndSearch(st.postSeed.fallbackImageUrl, { filters: parsed.filters }));
        actions.append(upBtn);
      }
      if (st.postSeed?.title) {
        const titleBtn = make('button', 'rt-community-action', 'Search by title instead');
        titleBtn.type = 'button';
        titleBtn.addEventListener('click', () => {
          const dest = Model.buildVisualUrl(location.href, { basePath: '/search/', q: st.postSeed.title, filters: parsed.filters, cleanNav: true });
          this.pushVisualUrl(dest);
        });
        actions.append(titleBtn);
      }
      const backBtn = make('a', 'rt-community-action', 'Open source post');
      backBtn.href = 'https://www.reddit.com/r/' + encodeURIComponent(parsed.postSeed.subreddit) + '/comments/' + encodeURIComponent(parsed.postSeed.postId) + '/';
      actions.append(backBtn);
      card.append(actions);
      return card;
    }

    buildEmptyCard(parsed) {
      const card = make('div', 'rt-community-state');
      const head = make('div', 'rt-community-state-head');
      const iconBox = make('span', 'rt-community-state-icon');
      iconBox.append(icon('similar', 20));
      head.append(iconBox, make('span', 'rt-community-state-title', 'No visual matches found'));
      card.append(head);
      const hasFilters = Boolean(parsed.filters.mediaType || parsed.filters.time || parsed.filters.nsfw);
      const reason = hasFilters
        ? 'infini.wtf returned no matches for this combination of filters. Try clearing filters' + (!parsed.filters.nsfw ? ' or toggling NSFW.' : '.')
        : 'infini.wtf had no indexed visual matches for this query.';
      card.append(make('p', 'rt-community-state-body', reason));
      const actions = make('div', 'rt-community-state-actions');
      if (hasFilters) {
        const clear = make('button', 'rt-community-action rt-community-action-primary', 'Clear filters');
        clear.type = 'button';
        clear.addEventListener('click', () => this.applyFilterPatch({ mediaType: '', time: '', nsfw: false }));
        actions.append(clear);
      }
      const upload = make('button', 'rt-community-action', 'Search with an image');
      upload.type = 'button';
      upload.addEventListener('click', () => this.openUploadUi(upload));
      actions.append(upload);
      card.append(actions);
      return card;
    }

    buildErrorCard(st) {
      const card = make('div', 'rt-community-state');
      const head = make('div', 'rt-community-state-head');
      const iconBox = make('span', 'rt-community-state-icon');
      iconBox.append(icon('camera', 20));
      const title = st.status === 'permission-required' ? 'Visual search needs site access'
        : st.code === 'timeout' ? 'infini.wtf is taking too long'
        : st.code === 'rate-limited' ? 'infini.wtf asked us to slow down'
        : 'Visual search unavailable';
      head.append(iconBox, make('span', 'rt-community-state-title', title));
      card.append(head);
      card.append(make('p', 'rt-community-state-body', st.error || 'Could not reach infini.wtf right now.'));
      const actions = make('div', 'rt-community-state-actions');
      if (st.status !== 'permission-required') {
        const retry = make('button', 'rt-community-action rt-community-action-primary', 'Try again');
        retry.type = 'button';
        retry.addEventListener('click', () => this.startLoad(st.parsed, { force: true }));
        actions.append(retry);
      }
      card.append(actions);
      return card;
    }

    // ---- Menus & Bottom Sheets (1:1 Desktop Dropdown & Phone RTFeedSheet) ------------------------------------

    closeDropdown(restoreFocus = false) {
      const cur = this.openDropdown;
      if (!cur) return;
      this.openDropdown = null;
      cur.trigger?.setAttribute('aria-expanded', 'false');
      cur.menu?.remove();
      if (restoreFocus && cur.trigger?.isConnected) cur.trigger.focus({ preventScroll: true });
    }

    openChoiceMenu(trigger, key, title, items, currentValue, onChoose) {
      if (isPhone() && Sheet) {
        Sheet.open({
          title,
          returnFocus: trigger,
          build: (body, ui) => {
            for (const [val, label] of items) {
              ui.row({
                label,
                selected: val === currentValue,
                onSelect: () => onChoose(val)
              });
            }
          }
        });
        return;
      }

      if (this.openDropdown?.trigger === trigger) {
        this.closeDropdown(true);
        return;
      }
      this.closeDropdown();
      this.closeUploadPopover();

      const menu = make('div', 'rt-inline-menu');
      menu.dataset.rtUi = 'visual-menu';
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', title);

      const list = make('ul', 'rt-inline-menu-list');
      list.setAttribute('role', 'presentation');
      for (const [val, label] of items) {
        const li = make('li', 'rt-inline-menu-item');
        li.setAttribute('role', 'menuitemradio');
        li.setAttribute('aria-checked', String(val === currentValue));
        li.tabIndex = 0;
        const left = make('span', 'rt-inline-menu-label', label);
        const mark = make('span', 'rt-inline-mark');
        if (val === currentValue && Filters?.svgIcon) mark.append(Filters.svgIcon('checkmark', 16));
        li.append(left, mark);
        const select = () => {
          this.closeDropdown(true);
          onChoose(val);
        };
        li.addEventListener('click', select);
        li.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
        });
        list.append(li);
      }
      menu.append(list);
      document.body.append(menu);

      const rect = trigger.getBoundingClientRect();
      const vw = window.innerWidth || 1024;
      const vh = window.innerHeight || 768;
      const mw = Math.max(160, menu.offsetWidth || 180);
      const mh = Math.min(menu.offsetHeight || 200, vh - 16);
      menu.style.left = Math.max(8, Math.min(rect.left, vw - mw - 8)) + 'px';
      menu.style.top = (rect.bottom + 4 + mh <= vh - 8 ? rect.bottom + 4 : Math.max(8, rect.top - mh - 4)) + 'px';

      trigger.setAttribute('aria-expanded', 'true');
      this.openDropdown = { trigger, menu, key };
      (list.querySelector('[aria-checked="true"]') || list.firstElementChild)?.focus?.({ preventScroll: true });
    }

    ensureFileInput() {
      if (this.fileInput?.isConnected) return this.fileInput;
      const input = make('input', '');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/*';
      input.hidden = true;
      input.dataset.rtUi = 'visual-file-input';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        input.value = '';
        if (file) this.uploadAndSearch(file);
      });
      document.body.append(input);
      this.fileInput = input;
      return input;
    }

    async pasteFromClipboard(onError) {
      try {
        const clip = navigator.clipboard;
        if (!clip?.read) throw Error('Use Ctrl+V / Cmd+V to paste an image.');
        const items = await clip.read();
        for (const item of items) {
          const imgType = item.types.find(t => t.startsWith('image/'));
          if (imgType) {
            const blob = await item.getType(imgType);
            await this.uploadAndSearch(blob);
            return;
          }
        }
        onError?.('No image found on your clipboard.');
      } catch (err) {
        onError?.(err?.message || 'Press Ctrl+V to paste an image.');
      }
    }

    closeUploadPopover(restoreFocus = false) {
      const pop = this.uploadPopover;
      if (!pop) return;
      this.uploadPopover = null;
      pop.panel?.remove();
      if (restoreFocus && pop.anchor?.isConnected) pop.anchor.focus({ preventScroll: true });
    }

    openUploadUi(anchor) {
      const popular = () => Model.buildVisualUrl(location.href, { basePath: '/search/', q: this.currentQuery(), popular: true, cleanNav: true });
      if (isPhone() && Sheet) {
        Sheet.open({
          title: 'Search with an image',
          returnFocus: anchor,
          build: (body, ui) => {
            ui.row({
              label: 'Choose a photo',
              subtitle: 'From your gallery or camera',
              icon: icon('image', 20),
              onSelect: () => { this.ensureFileInput().click(); }
            });
            ui.row({
              label: 'Paste copied image',
              subtitle: 'The image you copied last',
              icon: icon('upload', 20),
              keepOpen: true,
              onSelect: async () => {
                let err = '';
                await this.pasteFromClipboard(msg => { err = msg; });
                return err ? { ok: false, error: err } : { ok: true };
              }
            });
            ui.row({
              label: 'Browse popular',
              subtitle: 'Trending images and videos',
              icon: icon('similar', 20),
              onSelect: () => this.navigateUrl(popular().href)
            });
          }
        });
        return;
      }

      if (this.uploadPopover?.anchor === anchor) {
        this.closeUploadPopover(true);
        return;
      }
      this.closeUploadPopover();
      this.closeDropdown();

      const panel = make('div', 'rt-vs-upload-popover');
      panel.dataset.rtUi = 'visual-upload-popover';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Search with an image');

      const head = make('div', 'rt-vs-upload-head');
      const title = make('h3', 'rt-vs-upload-title', 'Search with an image');
      const closeBtn = make('button', 'rt-vs-upload-close');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close');
      closeBtn.append(icon('close', 14));
      closeBtn.addEventListener('click', () => this.closeUploadPopover(true));
      head.append(title, closeBtn);

      const errLine = make('p', 'rt-vs-upload-err');
      errLine.hidden = true;
      const showErr = text => { errLine.textContent = text; errLine.hidden = !text; };

      const mac = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
      const drop = make('div', 'rt-vs-drop');
      const art = make('span', 'rt-vs-drop-art');
      art.append(icon('image', 28));
      drop.append(art, make('span', 'rt-vs-drop-title', 'Drag an image here'), make('span', 'rt-vs-drop-or', 'or'));
      const btnRow = make('div', 'rt-vs-upload-actions');

      const pickBtn = make('button', 'rt-community-action rt-community-action-primary', 'Upload a file');
      pickBtn.type = 'button';
      pickBtn.addEventListener('click', () => this.ensureFileInput().click());

      const pasteBtn = make('button', 'rt-community-action', 'Paste image');
      pasteBtn.type = 'button';
      pasteBtn.title = 'Or press ' + (mac ? '⌘V' : 'Ctrl+V') + ' anywhere on the page';
      pasteBtn.addEventListener('click', () => this.pasteFromClipboard(showErr));

      btnRow.append(pickBtn, pasteBtn);
      drop.append(btnRow);
      drop.addEventListener('dragover', e => {
        if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); drop.dataset.dragging = 'true'; }
      });
      drop.addEventListener('dragleave', () => { delete drop.dataset.dragging; });
      drop.addEventListener('drop', e => {
        delete drop.dataset.dragging;
        const file = [...(e.dataTransfer?.files || [])].find(f => f.type?.startsWith('image/'));
        if (file) { e.preventDefault(); this.uploadAndSearch(file); }
      });

      const foot = make('div', 'rt-vs-upload-foot');
      const popBtn = make('button', 'rt-vs-link-btn', 'Browse popular images and videos');
      popBtn.type = 'button';
      popBtn.addEventListener('click', () => {
        this.closeUploadPopover();
        this.navigateUrl(popular().href);
      });
      foot.append(popBtn, make('span', 'rt-vs-upload-note', 'Images are resized and stripped of their metadata before they’re sent to infini.wtf.'));

      panel.append(head, drop, errLine, foot);
      document.body.append(panel);

      const rect = anchor?.getBoundingClientRect?.() || { left: 16, right: 356, bottom: 56, top: 16 };
      const vw = window.innerWidth || 1024;
      const pw = panel.offsetWidth || 340;
      const left = Math.max(8, Math.min(rect.left, vw - pw - 8));
      const top = Math.min((window.innerHeight || 768) - (panel.offsetHeight || 260) - 8, rect.bottom + 8);
      panel.style.left = Math.round(left) + 'px';
      panel.style.top = Math.round(Math.max(8, top)) + 'px';

      this.uploadPopover = { anchor, panel, showErr };
      pickBtn.focus({ preventScroll: true });
    }

    showPopoverError(msg) {
      this.uploadPopover?.showErr?.(msg);
    }

    // ---- Lightbox & Video Preview (CSP-compliant blob: transport) ---------------------------------------------

    // ---- Clip player frames ---------------------------------------------------------------------------------
    // Reddit's media-src blocks video.infini.wtf, so clips stream inside visual-player.html (an extension page the
    // page's CSP does not govern): no download first, no size cap. If a frame never says hello (a browser that will
    // not frame extension pages), clips fall back to the worker's bounded blob: download.
    playerBase() {
      if (this.framePlayback === false) return '';
      try { return (globalThis.browser || globalThis.chrome)?.runtime?.getURL?.('visual-player.html') || ''; }
      catch { return ''; }
    }

    makePlayerFrame(videoUrl, { mode = 'preview', time = 0, sound = false, onMessage = null } = {}) {
      const base = this.playerBase();
      if (!base) return null;
      const id = 'vp' + (++this.playerSeq);
      const params = new URLSearchParams({ src: videoUrl, mode, id, origin: location.origin });
      if (time > 0) params.set('t', time.toFixed(2));
      if (sound) params.set('sound', '1');
      const frame = make('iframe', mode === 'viewer' ? 'rt-vs-viewer-frame' : 'rt-vs-frame');
      frame.src = base + '#' + params.toString();
      frame.setAttribute('allow', 'autoplay; fullscreen');
      frame.referrerPolicy = 'origin';
      frame.title = mode === 'viewer' ? 'Video' : 'Preview';
      if (mode !== 'viewer') {
        frame.tabIndex = -1;
        frame.setAttribute('aria-hidden', 'true');
      }
      const entry = { id, frame, mode, time, origin: /^[a-z][a-z0-9+.-]*:\/\/[^/]+/i.exec(base)?.[0] || '', hello: false, onMessage };
      this.players.set(id, entry);
      // No hello within 2.5 s: frames are not usable here; later clips use blob: downloads.
      entry.helloTimer = setTimeout(() => {
        if (!entry.hello && this.players.get(id) === entry && frame.isConnected) {
          this.framePlayback = false;
          onMessage?.({ type: 'unavailable' });
        }
      }, 2500);
      return entry;
    }

    handlePlayerMessage(event) {
      const msg = event.data;
      if (!msg || msg.rt !== 'visual-player') return;
      const entry = this.players.get(msg.id);
      if (!entry || event.origin !== entry.origin || event.source !== entry.frame.contentWindow) return;
      if (!entry.hello) {
        entry.hello = true;
        clearTimeout(entry.helloTimer);
        this.framePlayback = true;
      }
      if (Number.isFinite(msg.time)) entry.time = msg.time;
      entry.paused = msg.paused;
      entry.muted = msg.muted;
      entry.onMessage?.(msg);
    }

    commandPlayer(entry, cmd, extra = {}) {
      if (!entry?.frame?.isConnected) return;
      try { entry.frame.contentWindow?.postMessage({ rt: 'visual-player', id: entry.id, cmd, ...extra }, entry.origin); } catch {}
    }

    dropPlayer(entry) {
      if (!entry) return;
      clearTimeout(entry.helloTimer);
      this.commandPlayer(entry, 'stop');
      this.players.delete(entry.id);
      entry.frame.remove();
    }

    // How a tile's clip may start, from the reader's video and GIF start choices: 'hover' with a mouse, 'stop' (the one
    // you stop on) with touch, 'auto' (in view) for Autoplay, 'none' for Only when I press Play.
    previewMode(media) {
      const mode = this.mediaChoice?.[media?.dataset?.kind === 'gif' ? 'gif' : 'video'] || 'default';
      if (mode === 'play' || reducedMotion()) return 'none';
      if (mode === 'autoplay') return 'auto';
      return canHover() ? 'hover' : 'stop';
    }

    stopVideoPreview() {
      const cur = this.hoveredPreview;
      if (!cur) return;
      this.hoveredPreview = null;
      clearTimeout(cur.timer);
      cur.cancelActivation?.();
      delete cur.media?.dataset?.previewing;
      if (cur.media) this.videoIO?.unobserve?.(cur.media);
      if (cur.player) this.dropPlayer(cur.player);
      if (cur.video) {
        try { cur.video.pause(); } catch {}
        cur.video.removeAttribute('src');
        try { cur.video.load(); } catch {}
        cur.video.remove();
      }
    }

    // Where the tile's clip is now (seconds), for the viewer and the post to continue from.
    previewTime(media) {
      const cur = this.hoveredPreview;
      if (!cur || cur.media !== media) return 0;
      if (cur.player) return cur.player.time || 0;
      return Number.isFinite(cur.video?.currentTime) ? cur.video.currentTime : 0;
    }

    checkVideoVisibility() {
      const media = this.hoveredPreview?.media;
      if (!media || !media.isConnected) { this.stopVideoPreview(); return; }
      const rect = media.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > (window.innerHeight || 900)) this.stopVideoPreview();
    }

    // One fetch per clip, shared by every caller while it is in flight; the last few clips stay as blob: URLs.
    getVideoBlobUrl(videoUrl) {
      if (this.videoBlobs.has(videoUrl)) {
        const existing = this.videoBlobs.get(videoUrl);
        this.videoBlobs.delete(videoUrl);
        this.videoBlobs.set(videoUrl, existing);
        return Promise.resolve(existing);
      }
      if (this.videoFetches.has(videoUrl)) return this.videoFetches.get(videoUrl);
      const job = this.send({ action: 'fetch-video', url: videoUrl }).then(res => {
        if (!res?.ok || !res.base64) throw Error(res?.error || 'Video preview unavailable.');
        if (this.dead) throw Error('Visual search stopped.');
        const objUrl = URL.createObjectURL(base64ToBlob(res.base64, res.mimeType || 'video/mp4'));
        this.videoBlobs.set(videoUrl, objUrl);
        while (this.videoBlobs.size > MAX_VIDEO_BLOBS) {
          const [oldKey, oldUrl] = this.videoBlobs.entries().next().value;
          this.videoBlobs.delete(oldKey);
          if (this.hoveredPreview?.video?.src === oldUrl) this.stopVideoPreview();
          URL.revokeObjectURL(oldUrl);
        }
        return objUrl;
      }).finally(() => this.videoFetches.delete(videoUrl));
      this.videoFetches.set(videoUrl, job);
      return job;
    }

    // Plays one tile's clip muted and looping in place; starting another stops the first. Streams through a player
    // frame when it can, else downloads the clip as a blob: (bounded, see the broker).
    startPreview(media, { delay = 0, manual = false } = {}) {
      if (!media?.dataset?.videoUrl || !media.isConnected) return;
      if (this.hoveredPreview?.media === media) return;
      this.stopVideoPreview();
      const videoUrl = media.dataset.videoUrl;
      const entry = { media, videoUrl, video: null, player: null, manual, timer: 0 };
      this.hoveredPreview = entry;
      const playing = () => {
        if (this.hoveredPreview !== entry) return;
        entry.cancelActivation?.();
        media.dataset.previewing = 'playing';
      };
      const playBlob = () => {
        entry.video.play?.().then(playing, error => {
          if (this.hoveredPreview !== entry) return;
          if (error?.name === 'NotAllowedError') this.waitForPreviewActivation(entry, playBlob);
          else this.previewFailed(entry);
        });
      };
      const viaBlob = async () => {
        try {
          const objUrl = await this.getVideoBlobUrl(videoUrl);
          if (this.dead || this.hoveredPreview !== entry || !media.isConnected) return;
          const video = make('video', 'rt-vs-video');
          video.muted = true;
          video.loop = true;
          video.playsInline = true;
          video.setAttribute('aria-hidden', 'true');
          video.src = objUrl;
          entry.video = video;
          media.append(video);
          this.videoIO?.observe?.(media);
          playBlob();
        } catch {
          if (this.hoveredPreview === entry) this.previewFailed(entry);
        }
      };
      const run = () => {
        if (this.dead || this.hoveredPreview !== entry || !media.isConnected || document.visibilityState === 'hidden') return;
        media.dataset.previewing = 'loading';
        const player = this.makePlayerFrame(videoUrl, {
          mode: 'preview',
          onMessage: msg => {
            if (this.hoveredPreview !== entry) return;
            if (msg.type === 'unavailable') { this.dropPlayer(player); entry.player = null; viaBlob(); return; }
            if (msg.type === 'playing' || msg.type === 'time' && !msg.paused) playing();
            else if (msg.type === 'blocked') this.waitForPreviewActivation(entry, () => this.commandPlayer(player, 'play'));
            else if (msg.type === 'error') this.previewFailed(entry);
          }
        });
        if (!player) { viaBlob(); return; }
        entry.player = player;
        media.append(player.frame);
        this.videoIO?.observe?.(media);
      };
      if (delay > 0) entry.timer = setTimeout(run, delay);
      else run();
    }

    waitForPreviewActivation(entry, play) {
      if (entry.cancelActivation) return;
      delete entry.media.dataset.previewing;
      const cancel = () => {
        for (const type of ['pointerup', 'keydown']) window.removeEventListener(type, retry, true);
        entry.cancelActivation = null;
      };
      const retry = event => {
        if (!event.isTrusted && !globalThis.__rtVisualSearchTest) return;
        if (event.button > 0 || event.isPrimary === false || event.repeat ||
            event.key === 'Escape' || event.ctrlKey || event.metaKey || event.altKey) return;
        cancel();
        if (!this.dead && this.hoveredPreview === entry && entry.media.isConnected) play();
      };
      entry.cancelActivation = cancel;
      for (const type of ['pointerup', 'keydown']) window.addEventListener(type, retry, true);
    }

    // A clip that could not play: say so on its badge for a moment, then leave the tile as it was.
    previewFailed(entry) {
      const media = entry.media;
      if (this.hoveredPreview === entry) this.stopVideoPreview();
      if (!media?.isConnected) return;
      media.dataset.previewing = 'failed';
      setTimeout(() => { if (media.dataset.previewing === 'failed') delete media.dataset.previewing; }, 2400);
    }

    handlePointerOver(event) {
      if (!this.enabled) return;
      const wrap = event.target?.closest?.('[data-rt-ui="visual-search"] .rt-vs-media-wrap');
      const media = wrap?.querySelector?.('.rt-vs-media[data-video-url]');
      if (!media || this.hoveredPreview?.media === media || this.previewMode(media) !== 'hover') return;
      this.startPreview(media, { delay: HOVER_PREVIEW_MS });
    }

    handlePointerOut(event) {
      const cur = this.hoveredPreview;
      if (!cur || cur.manual || this.previewMode(cur.media) !== 'hover') return;
      const wrap = cur.media.closest('.rt-vs-media-wrap') || cur.media;
      if (!wrap.contains(event.relatedTarget)) this.stopVideoPreview();
    }

    // Touch and Autoplay: once scrolling pauses, the clip at least 60 % on screen and nearest the middle plays; a playing
    // clip keeps going while it stays at least half visible (the same rule as Reddit feeds in video-control.js).
    settlePreviews() {
      clearTimeout(this.settleTimer);
      if (!this.enabled || !this.host?.isConnected || this.state?.status !== 'ready') return;
      const any = this.host.querySelector('.rt-vs-media[data-video-url]');
      if (!any) return;
      const modes = new Set([...this.host.querySelectorAll('.rt-vs-media[data-video-url]')].slice(0, 60).map(m => this.previewMode(m)));
      const wait = modes.has('auto') ? AUTO_PREVIEW_MS : modes.has('stop') ? DWELL_PREVIEW_MS : 0;
      if (!wait) return;
      this.settleTimer = setTimeout(() => this.pickInView(), wait);
    }

    pickInView() {
      if (this.dead || !this.enabled || !this.host?.isConnected || document.visibilityState === 'hidden' || this.lightbox) return;
      const height = window.innerHeight || 800;
      const visible = media => {
        const r = media.getBoundingClientRect();
        if (!r.height) return 0;
        return Math.max(0, Math.min(r.bottom, height) - Math.max(r.top, 0)) / r.height;
      };
      const cur = this.hoveredPreview;
      if (cur?.manual && cur.media.isConnected && visible(cur.media) >= 0.5) return;
      if (cur && cur.media.isConnected && ['auto', 'stop'].includes(this.previewMode(cur.media)) && visible(cur.media) >= 0.5) return;
      let best = null, distance = Infinity;
      for (const media of this.host.querySelectorAll('.rt-vs-media[data-video-url]')) {
        const mode = this.previewMode(media);
        if (mode !== 'auto' && mode !== 'stop') continue;
        if (visible(media) < 0.6) continue;
        const r = media.getBoundingClientRect();
        const d = Math.abs(r.top + r.height / 2 - height / 2);
        if (d < distance) { best = media; distance = d; }
      }
      if (best) this.startPreview(best);
      else if (cur && !cur.manual && this.previewMode(cur.media) !== 'hover') this.stopVideoPreview();
    }

    closeLightbox({ restoreFocus = true } = {}) {
      const cur = this.lightbox;
      if (!cur) return;
      this.lightbox = null;
      if (cur.player) this.dropPlayer(cur.player);
      this.stopViewerVideo(cur);
      document.removeEventListener('keydown', cur.onKey, true);
      try { cur.dialog?.close?.(); } catch {}
      cur.dialog?.remove();
      document.documentElement.removeAttribute('data-rt-vs-viewer');
      if (restoreFocus) {
        const tile = cur.nativeTile?.();
        tile?.scrollIntoView?.({ block: 'nearest', behavior: 'instant' });
        const target = tile?.querySelector('.rt-vs-native-expand') || cur.returnFocus;
        if (target?.isConnected) target.focus({ preventScroll: true });
      }
      document.dispatchEvent(new Event('rt-media-viewer-state'));
      if (this.host?.isConnected) this.settlePreviews();
    }

    stopViewerVideo(st) {
      const video = st.video;
      if (!video) return;
      st.video = null;
      video.pause();
      video.removeAttribute('src');
      video.load();
    }

    // Opening a result's post from a tile or the viewer: close the viewer, hand the clip's moment to the post's own
    // video (Seamless post transition decides whether it is used), then let Reddit's router open the post.
    openResultPost(item, { time = null, source = 'media', muted = true } = {}) {
      const media = [...(this.host?.querySelectorAll?.('.rt-vs-tile') || [])].find(tile => tile.dataset.uuid === item.uuid)?.querySelector('.rt-vs-media');
      const at = time ?? (media ? this.previewTime(media) : 0);
      if (item.isVideo && !item.isGif && item.postId && (at > 0 || this.hoveredPreview?.media === media || source === 'viewer')) {
        document.dispatchEvent(new CustomEvent('rt-visual-continue', { detail: { id: item.postId, time: at, source, muted } }));
      }
      this.closeLightbox({ restoreFocus: false });
      this.navigateUrl(item.permalink);
    }

    // Full-screen viewer: the media as large as the screen allows, the community and title above it, and the result's
    // actions; ← / → (or a swipe) move through the results. Clips stream with controls from the tile's moment.
    openLightbox(item, returnFocus = null, { list = null } = {}) {
      // The Media grid can replace or reorder tiles while paging. Keep the viewed order and merge new results by ID.
      const items = list ? [] : this.state?.items?.length ? this.state.items : [item];
      const nativeIndices = new Map();
      const mergeNative = fresh => {
        for (const it of fresh) {
          const known = nativeIndices.get(it.uuid);
          if (known === undefined) {
            nativeIndices.set(it.uuid, items.length);
            items.push(it);
          } else {
            const previous = items[known];
            items[known] = {
              ...it, src: it.src || previous.src,
              isVideo: it.isVideo || previous.isVideo, isGif: it.isVideo ? it.isGif : previous.isGif,
              sources: it.sources.length ? it.sources : previous.sources
            };
          }
        }
        for (const it of items) if (it.tile && !it.tile.isConnected) it.tile = null;
      };
      if (list) {
        mergeNative(list());
        if (!nativeIndices.has(item.uuid)) mergeNative([item]);
      }
      let index = Math.max(0, items.findIndex(it => it.uuid === item.uuid));
      const startMedia = [...(this.host?.querySelectorAll?.('.rt-vs-tile') || [])].find(tile => tile.dataset.uuid === item.uuid)?.querySelector('.rt-vs-media');
      const startTime = item.native ? nativeTileTime(item.tile) : startMedia ? this.previewTime(startMedia) : 0;
      this.stopVideoPreview();
      this.closeLightbox({ restoreFocus: false });

      const dialog = make('dialog', 'rt-vs-viewer');
      dialog.dataset.rtUi = 'visual-lightbox';
      dialog.setAttribute('aria-label', 'Media viewer');
      const top = make('div', 'rt-vs-viewer-top');
      const who = make('div', 'rt-vs-viewer-who');
      const titleEl = make('h2', 'rt-vs-viewer-title');
      const subEl = make('a', 'rt-vs-viewer-sub');
      who.append(subEl, titleEl);
      const tools = make('div', 'rt-vs-viewer-tools');
      const tool = (name, label, onClick, cls = 'rt-vs-viewer-btn') => {
        const b = make('button', cls);
        b.type = 'button';
        b.title = label;
        b.setAttribute('aria-label', label);
        b.append(icon(name, 20));
        b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
        return b;
      };
      const current = () => items[index];
      const simBtn = tool('similar', 'Find visually similar', () => this.findSimilar(current()));
      const dlBtn = tool('download', 'Download', () => this.downloadItem(current()));
      const openBtn = make('button', 'rt-vs-viewer-open');
      openBtn.type = 'button';
      openBtn.append(make('span', '', 'Open post'));
      openBtn.addEventListener('click', e => {
        e.stopPropagation();
        const st = this.lightbox;
        const video = st?.video;
        this.openResultPost(current(), video ? { time: video.currentTime || 0, source: 'viewer', muted: video.muted } : { time: st?.player?.time ?? 0, source: 'viewer', muted: st?.player ? st.player.muted !== false : true });
      });
      const closeBtn = tool('close', 'Close', () => this.closeLightbox());
      tools.append(simBtn, dlBtn, openBtn, closeBtn);
      top.append(who, tools);

      const stage = make('div', 'rt-vs-viewer-stage');
      const prev = tool('caret', 'Previous', () => go(-1), 'rt-vs-viewer-nav rt-vs-viewer-prev');
      const next = tool('caret', 'Next', () => go(1), 'rt-vs-viewer-nav rt-vs-viewer-next');
      const count = make('span', 'rt-vs-viewer-count');
      // Phones: the side arrows would sit on the media, so Previous and Next live in a bar under it with the count.
      const bar = make('div', 'rt-vs-viewer-bar');
      const barPrev = tool('caret', 'Previous', () => go(-1), 'rt-vs-viewer-btn rt-vs-viewer-bar-prev');
      const barNext = tool('caret', 'Next', () => go(1), 'rt-vs-viewer-btn rt-vs-viewer-bar-next');
      const barCount = make('span', 'rt-vs-viewer-bar-count');
      bar.append(barPrev, barCount, barNext);
      dialog.append(stage, top, prev, next, count, bar);

      const st = { dialog, returnFocus, player: null, onKey: null, route: urlKey() };
      const syncNav = () => {
        count.textContent = items.length > 1 ? (index + 1) + ' / ' + items.length : '';
        prev.hidden = items.length < 2 || index === 0;
        next.hidden = items.length < 2 || index === items.length - 1;
        barPrev.disabled = prev.hidden;
        barNext.disabled = next.hidden;
        barCount.textContent = count.textContent;
        bar.hidden = items.length < 2;
      };
      if (list) {
        st.nativeTile = () => current()?.tile;
        st.refreshNative = () => { mergeNative(list()); syncNav(); };
      }
      let pagingTile = null;
      const pageNative = () => {
        if (!list || index < items.length - 3) return;
        const tile = items.at(-1)?.tile;
        if (!tile?.isConnected || tile === pagingTile) return;
        pagingTile = tile;
        tile.scrollIntoView?.({ block: 'end', behavior: 'instant' });
      };
      const show = (it, time = 0) => {
        if (st.player) { this.dropPlayer(st.player); st.player = null; }
        this.stopViewerVideo(st);
        dlBtn.hidden = Boolean(it.native);
        titleEl.textContent = it.title || 'Untitled Reddit post';
        const isUser = it.subreddit?.startsWith('u_');
        subEl.replaceChildren();
        if (it.subreddit) {
          if (!isUser) subEl.append(this.buildSubIcon(it.subreddit));
          subEl.append(make('span', '', isUser ? 'u/' + it.subreddit.slice(2) : 'r/' + it.subreddit));
          subEl.href = isUser ? '/user/' + encodeURIComponent(it.subreddit.slice(2)) + '/' : '/r/' + encodeURIComponent(it.subreddit) + '/';
        } else subEl.removeAttribute('href');
        syncNav();
        stage.replaceChildren();
        delete stage.dataset.playing;
        if (it.src || it.thumb) {
          const poster = make('img', 'rt-vs-viewer-img');
          poster.src = it.src || it.thumb;
          poster.alt = it.title || '';
          poster.referrerPolicy = 'no-referrer';
          poster.decoding = 'async';
          stage.append(poster);
        }
        if (it.native) {
          if (it.isVideo) this.showNativeVideo(stage, it, st, time);
          pageNative();
        } else if (it.videoUrl) {
          const sound = this.clickChoice.clickAudio === 'unmute' && !it.isGif;
          const player = this.makePlayerFrame(it.videoUrl, {
            mode: 'viewer', time, sound,
            onMessage: msg => {
              if (this.lightbox !== st || st.player !== player) return;
              if (msg.type === 'playing' || msg.type === 'time' && !msg.paused) stage.dataset.playing = 'true';
              if (msg.type === 'swipe') {
                if (msg.direction === 'next') go(1);
                else if (msg.direction === 'previous') go(-1);
                else if (msg.direction === 'down') this.closeLightbox();
                return;
              }
              if (msg.type === 'unavailable' || msg.type === 'error') { this.dropPlayer(player); st.player = null; this.viewerBlob(stage, it, st, time); }
            }
          });
          if (player) {
            st.player = player;
            stage.append(player.frame);
          } else this.viewerBlob(stage, it, st, time);
        }
      };
      const go = step => {
        if (list && index + step >= items.length) st.refreshNative();
        const nextIndex = index + step;
        if (nextIndex < 0 || nextIndex >= items.length) return;
        index = nextIndex;
        show(items[index]);
        // Near the end of what is loaded, the grid's next page loads too (results are appended to this same list).
        if (items === this.state?.items && index >= items.length - 3) {
          Promise.resolve(this.loadMore()).then(() => { if (this.lightbox === st) syncNav(); }, () => {});
        }
      };
      st.onKey = e => {
        if (this.lightbox !== st) return;
        if (e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
        e.preventDefault();
        e.stopPropagation();
        go(e.key === 'ArrowLeft' ? -1 : 1);
      };
      // Swipe left / right on touch; swipe down closes.
      let touch = null;
      stage.addEventListener('touchstart', e => {
        const t = e.touches.length === 1 ? e.touches[0] : null;
        touch = t ? { x: t.clientX, y: t.clientY } : null;
      }, { passive: true });
      stage.addEventListener('touchend', e => {
        const t = e.changedTouches[0];
        if (!touch || !t) return;
        const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
        touch = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          e.preventDefault();
          go(dx < 0 ? 1 : -1);
        } else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) {
          e.preventDefault();
          this.closeLightbox();
        }
      });
      stage.addEventListener('touchcancel', () => { touch = null; });
      dialog.addEventListener('cancel', e => { e.preventDefault(); this.closeLightbox(); });
      dialog.addEventListener('click', e => { if (e.target === dialog || e.target === stage) this.closeLightbox(); });
      subEl.addEventListener('click', () => this.closeLightbox({ restoreFocus: false }));
      document.addEventListener('keydown', st.onKey, true);
      document.body.append(dialog);
      document.documentElement.setAttribute('data-rt-vs-viewer', '');
      this.lightbox = st;
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      document.dispatchEvent(new Event('rt-media-viewer-state'));
      if (item.native) {
        item.tile?.querySelector(Overlay.searchPlayer)?.shadowRoot?.querySelector('video')?.pause();
      }
      show(items[index], startTime);
      closeBtn.focus({ preventScroll: true });
    }

    showNativeVideo(stage, item, st, time) {
      const note = make('span', 'rt-vs-viewer-note', 'Video unavailable. Open the post to watch.');
      note.setAttribute('role', 'status');
      if (!item.sources.length) { stage.append(note); return; }
      const video = make('video', 'rt-vs-viewer-video');
      video.controls = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'metadata';
      video.poster = item.src;
      video.muted = item.isGif || this.clickChoice.clickAudio !== 'unmute';
      const play = Overlay.button(document, item.isGif);
      let sourceIndex = 0;
      let requested = this.mediaChoice[item.isGif ? 'gif' : 'video'] !== 'play' || time > 0;
      const start = () => {
        const src = video.src;
        video.play()?.catch(error => {
          if (st.video !== video || video.src !== src || error?.name !== 'NotAllowedError' || video.muted) return;
          video.muted = true;
          video.play()?.catch(() => {});
        });
      };
      const setSource = () => {
        video.src = item.sources[sourceIndex];
        if (requested) start();
      };
      play.addEventListener('click', () => {
        requested = true;
        if (sourceIndex >= item.sources.length) {
          sourceIndex = 0;
          note.remove();
          setSource();
        } else start();
      });
      video.addEventListener('loadedmetadata', () => {
        if (time > 0 && time < video.duration) video.currentTime = time;
      });
      video.addEventListener('playing', () => {
        if (st.video !== video) return;
        time = 0;
        stage.dataset.playing = 'true';
        play.hidden = true;
      });
      video.addEventListener('pause', () => { play.hidden = false; });
      video.addEventListener('error', () => {
        if (st.video !== video) return;
        play.hidden = false;
        delete stage.dataset.playing;
        if (++sourceIndex < item.sources.length) setSource();
        else stage.append(note);
      });
      st.video = video;
      stage.append(video, play);
      setSource();
    }

    // The viewer's clip where player frames are unavailable: the bounded blob: download, with controls.
    async viewerBlob(stage, it, st, time) {
      const note = make('span', 'rt-vs-viewer-note', 'Loading video…');
      stage.append(note);
      try {
        const objUrl = await this.getVideoBlobUrl(it.videoUrl);
        if (this.dead || this.lightbox !== st || !note.isConnected) return;
        const video = make('video', 'rt-vs-viewer-video');
        video.controls = true;
        video.autoplay = true;
        video.loop = true;
        video.playsInline = true;
        video.muted = !(this.clickChoice.clickAudio === 'unmute' && !it.isGif);
        video.src = objUrl;
        video.addEventListener('loadedmetadata', () => { if (time > 0 && time < video.duration) video.currentTime = time; }, { once: true });
        video.addEventListener('playing', () => { if (st.video === video) stage.dataset.playing = 'true'; });
        note.remove();
        st.video = video;
        stage.append(video);
        video.play?.().catch(() => { video.muted = true; video.play?.().catch(() => {}); });
      } catch (err) {
        if (this.lightbox === st) note.textContent = err?.message || 'Video unavailable.';
      }
    }

    downloadItem(item) {
      const dlUrl = item.videoUrl || item.src || item.thumb || item.downloadUrl;
      if (!dlUrl) return;
      const ext = item.isVideo ? 'mp4' : 'webp';
      const name = (item.title || 'visual-match').replace(/[^\w\s-]/g, '').trim().slice(0, 60) || 'visual-match';
      this.send({ action: 'download', url: dlUrl, filename: name + '.' + ext }).catch(() => {});
    }

    // ---- Entry Point 1: Tab in #search-results-page-tabgroup -------------------------------------------------

    syncSearchTabGroup(parsed) {
      const tg = document.querySelector('#search-results-page-tabgroup');
      if (!tg) return;
      const scope = parsed?.scope || Model.searchScopeFromUrl(location.href);
      if (!scope) return;
      // Profile search is Reddit Tweaks' own results (Posts, Media, Comments); a Visual tab there would leave them for
      // infini.wtf matches that are not limited to the profile. Image searches started there go to the global tab.
      if (scope.surface === 'user' && !parsed?.active) {
        if (tg.querySelector(':scope > [data-rt-ui="visual-search-tab"]')) this.teardownSearchTabs();
        return;
      }

      const active = Boolean(parsed?.active);

      let visualTab = tg.querySelector(':scope > [data-rt-ui="visual-search-tab"]');
      const destUrl = Model.buildVisualUrl(location.href, {
        q: parsed?.q ?? (new URLSearchParams(location.search).get('q') || ''),
        filters: parsed?.filters || {},
        uploadUuid: parsed?.uploadUuid || '',
        viewId: parsed?.viewId || '',
        postSeed: parsed?.postSeed || null,
        popular: parsed?.popular || false,
        vscope: parsed?.vscope || ''
      });

      if (!visualTab) {
        const sibling = tg.querySelector(':scope > a[href]:not([data-rt-ui="visual-search-tab"])');
        const baseCls = sibling?.className
          ? sibling.className.split(/\s+/).filter(c => c && !NATIVE_TAB_SELECTED_CLS.includes(c)).join(' ')
          : '';
        visualTab = make('a', baseCls || DEFAULT_TAB_CLS);
        visualTab.id = 'search-results-page-tab-visual';
        visualTab.setAttribute('slot', 'visual');
        visualTab.dataset.rtUi = 'visual-search-tab';
        const inner = make('span', 'flex items-center justify-center');
        inner.append(make('span', 'flex items-center gap-xs', 'Visual'));
        visualTab.append(inner);
        visualTab.addEventListener('click', e => this.handleVisualTabClick(e, visualTab));
        const mediaTab = tg.querySelector(':scope > a[slot="media"]');
        if (mediaTab) mediaTab.after(visualTab);
        else {
          const backBtn = tg.querySelector(':scope > button[slot="back-button"]');
          if (backBtn) backBtn.before(visualTab);
          else tg.append(visualTab);
        }
      }
      if (visualTab.getAttribute('href') !== destUrl.href) visualTab.setAttribute('href', destUrl.href);

      // Project slot="visual" directly inside shared Shadow DOM .tablist (wrapper expandos don't trigger Lit).
      if (tg.shadowRoot) {
        const sr = tg.shadowRoot;
        const tablist = sr.querySelector('.tablist, [role="tablist"]');
        if (tablist) {
          let visualSlotWrap = tablist.querySelector(':scope > [data-rt-ui="visual-search-slot"]');
          if (!visualSlotWrap) {
            visualSlotWrap = make('span');
            visualSlotWrap.setAttribute('role', 'tab');
            visualSlotWrap.dataset.rtUi = 'visual-search-slot';
            visualSlotWrap.setAttribute('aria-selected', 'false');
            const slotEl = make('slot');
            slotEl.setAttribute('name', 'visual');
            visualSlotWrap.append(slotEl);
            const mediaWrap = tablist.querySelector('slot[name="media"]')?.closest('[role="tab"], span');
            if (mediaWrap && mediaWrap.parentElement === tablist) mediaWrap.after(visualSlotWrap);
            else tablist.append(visualSlotWrap);
          }

          let origMap = this.tabOriginals.get(tg);
          if (!origMap) {
            origMap = new Map();
            this.tabOriginals.set(tg, origMap);
          }
          for (const wrap of tablist.querySelectorAll(':scope > [role="tab"]:not([data-rt-ui="visual-search-slot"])')) {
            if (!origMap.has(wrap)) origMap.set(wrap, wrap.getAttribute('aria-selected'));
            if (active) {
              if (wrap.getAttribute('aria-selected') !== 'false') wrap.setAttribute('aria-selected', 'false');
            } else {
              const origSelected = origMap.get(wrap);
              if (origSelected == null) wrap.removeAttribute('aria-selected');
              else if (wrap.getAttribute('aria-selected') !== origSelected) wrap.setAttribute('aria-selected', origSelected);
            }
          }
          const targetAria = active ? 'true' : 'false';
          if (visualSlotWrap.getAttribute('aria-selected') !== targetAria) {
            visualSlotWrap.setAttribute('aria-selected', targetAria);
          }
        }

        if (this.tabShadowTarget !== sr) {
          this.tabShadowObserver?.disconnect();
          this.tabShadowTarget = sr;
          this.tabShadowObserver = new MutationObserver(records => {
            if (this.dead || !this.enabled) return;
            const onlyOwnSlot = records.every(r => {
              const nodes = [...r.addedNodes, ...r.removedNodes];
              return Boolean(
                r.target?.closest?.('[data-rt-ui="visual-search-slot"]') ||
                (nodes.length && nodes.every(n => n.nodeType === 1 && n.dataset?.rtUi === 'visual-search-slot'))
              );
            });
            if (!onlyOwnSlot || !sr.querySelector('[data-rt-ui="visual-search-slot"]')) {
              this.schedule(true);
            }
          });
          this.tabShadowObserver.observe(sr, { childList: true, subtree: true });
        }
        this.tabShadowObserver?.takeRecords?.();
      }

      // Clean rt_visual params off native sibling tab anchors and manage native selection state reversibly.
      for (const tab of tg.querySelectorAll(':scope > a[href]:not([data-rt-ui="visual-search-tab"])')) {
        if (!this.nativeTabBackup.has(tab)) {
          this.nativeTabBackup.set(tab, {
            className: tab.className,
            ariaCurrent: tab.getAttribute('aria-current'),
            tabIndex: tab.tabIndex,
            selected: tab.hasAttribute('faceplate-tab-selected'),
            style: tab.getAttribute('style')
          });
        }
        const href = tab.getAttribute('href');
        try {
          const cleaned = Model.stripVisualParams(new URL(href, location.origin));
          const normalizedHref = cleaned.pathname + cleaned.search + cleaned.hash;
          if (href && href !== normalizedHref) {
            if (!this.nativeTabLinks.has(tab)) this.nativeTabLinks.set(tab, href);
            tab.setAttribute('href', normalizedHref);
          }
        } catch {}

        if (active) {
          for (const cls of NATIVE_TAB_SELECTED_CLS) tab.classList.remove(cls);
          tab.removeAttribute('aria-current');
          tab.removeAttribute('faceplate-tab-selected');
          tab.setAttribute('data-rt-visual-tab-muted', '');
          tab.tabIndex = -1;
        } else {
          tab.removeAttribute('data-rt-visual-tab-muted');
          const orig = this.nativeTabBackup.get(tab);
          if (orig) {
            tab.className = orig.className;
            if (orig.ariaCurrent == null) tab.removeAttribute('aria-current');
            else tab.setAttribute('aria-current', orig.ariaCurrent);
            tab.tabIndex = orig.tabIndex;
            tab.toggleAttribute('faceplate-tab-selected', orig.selected);
            if (orig.style == null) tab.removeAttribute('style');
            else if (tab.getAttribute('style') !== orig.style) tab.setAttribute('style', orig.style);
          }
        }
      }

      if (active) {
        for (const cls of NATIVE_TAB_SELECTED_CLS) visualTab.classList.add(cls);
        visualTab.setAttribute('faceplate-tab-selected', '');
        visualTab.setAttribute('aria-current', 'page');
        visualTab.tabIndex = 0;
        if (tg.shadowRoot && this.visualTabScrolled !== visualTab) {
          this.visualTabScrolled = visualTab;
          setTimeout(() => {
            if (this.dead || !tg.isConnected || this.visualTabScrolled !== visualTab) return;
            const srList = tg.shadowRoot?.querySelector?.('.tablist, [role="tablist"]');
            const slotWrap = srList?.querySelector?.('[data-rt-ui="visual-search-slot"]');
            if (srList && slotWrap && srList.scrollWidth > srList.clientWidth) {
              const lr = srList.getBoundingClientRect();
              const wr = slotWrap.getBoundingClientRect();
              const rightLimit = lr.right - 48;
              if (wr.right > rightLimit) {
                srList.scrollLeft += wr.right - rightLimit;
                srList.dispatchEvent(new Event('scroll'));
              }
            }
          }, 0);
        }
      } else {
        this.visualTabScrolled = null;
        for (const cls of NATIVE_TAB_SELECTED_CLS) visualTab.classList.remove(cls);
        visualTab.removeAttribute('faceplate-tab-selected');
        visualTab.removeAttribute('aria-current');
        visualTab.tabIndex = -1;
      }
    }

    handleVisualTabClick(event, tab) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const href = tab.getAttribute('href');
      if (!href) return;
      const curParams = new URLSearchParams(location.search);
      // Fast 0 ms swap when already on Reddit type=media with the same search scope/path.
      if (curParams.get('type') === 'media') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (curParams.get('rt_visual') !== '1') {
          history.pushState(history.state, '', href);
          this.handleRoute();
        }
      }
    }

    handleTabNavigationClick(event, targetUrl) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const destKey = urlKey(targetUrl.href);
      // If Reddit's hidden Media grid inside this <main> was rendered for this exact Media URL, reveal it in 0 ms!
      if (this.mountedMain && destKey === this.baseNativeUrl) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.savePark();
        this.unmountVisualHost();
        history.pushState(history.state, '', targetUrl.href);
        this.lastUrl = location.href;
        this.sync();
      } else {
        // Otherwise keep our Visual view mounted cleanly until Reddit finishes swapping <main> for the native tab!
        this.startDeparture();
      }
    }

    // ---- Entry Point 2: Header Search Bar Camera Trigger -----------------------------------------------------

    syncHeaderTriggers() {
      // visual-search-boot.js draws the lens at document_start (same frame as Reddit's bar); here it is switched on
      // and a click made before this script was ready is answered.
      const Lens = globalThis.RTVisualLens;
      if (Lens) {
        Lens.set(true);
        Lens.attach();
        const pending = Lens.pending;
        Lens.pending = null;
        if (pending?.isConnected) this.openUploadUi(pending);
        return;
      }
      const styleBtn = (btn, size) => {
        // Shadow roots isolate page CSS, so style directly on the slotted button (Contract Rule 11).
        btn.style.cssText = `display:inline-flex;align-items:center;justify-content:center;flex:none;width:${size}px;height:${size}px;padding:0;margin:0 4px 0 2px;border:0;border-radius:999px;background:transparent;color:var(--color-neutral-content-weak,#576f76);cursor:pointer;transition:background-color 120ms ease,color 120ms ease;`;
        btn.addEventListener('pointerenter', () => {
          btn.style.backgroundColor = 'var(--color-secondary-background-hover,rgba(0,0,0,0.06))';
          btn.style.color = 'var(--color-neutral-content-strong,#181c1f)';
        });
        btn.addEventListener('pointerleave', () => {
          btn.style.backgroundColor = 'transparent';
          btn.style.color = 'var(--color-neutral-content-weak,#576f76)';
        });
      };
      const makeTrigger = size => {
        const btn = make('button', 'rt-vs-header-btn');
        btn.type = 'button';
        btn.dataset.rtUi = 'visual-search-trigger';
        btn.setAttribute('aria-label', 'Search with an image');
        btn.title = 'Search with an image';
        styleBtn(btn, size);
        btn.append(lensIcon(size >= 40 ? 22 : 20));
        btn.addEventListener('pointerdown', e => {
          e.preventDefault();
          e.stopPropagation();
        });
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopImmediatePropagation();
          this.openUploadUi(btn);
        });
        return btn;
      };
      const hosts = document.querySelectorAll('reddit-search-large, reddit-search-small, prominent-search');
      for (const host of hosts) {
        const root = host.shadowRoot || host;
        const field = root?.querySelector?.('faceplate-search-input[name="q"]');
        if (field) {
          if (field.closest?.('[data-rt-ui]') || field.querySelector(':scope > [data-rt-ui="visual-search-trigger"]')) continue;
          const btn = makeTrigger(32);
          btn.slot = 'trailingContent';
          field.append(btn);
          continue;
        }
        // Phone Home: prominent-search is one big "Search Reddit" button (no input until it opens); the lens sits
        // inside its right end as a separate button.
        const fake = host.matches('prominent-search') ? host.querySelector(':scope > .relative > .prominent-search-button, .prominent-search-button') : null;
        const box = fake?.parentElement;
        if (!fake || !box || box.querySelector(':scope > [data-rt-ui="visual-search-trigger"]')) continue;
        const btn = makeTrigger(40);
        btn.style.position = 'absolute';
        btn.style.insetInlineEnd = '4px';
        btn.style.top = '50%';
        btn.style.transform = 'translateY(-50%)';
        btn.style.zIndex = '1';
        btn.style.margin = '0';
        box.append(btn);
      }
    }

    // ---- Entry Point 3: Post ⋯ Overflow Menu ("Find visually similar") --------------------------------------

    syncPostMenus() {
      if (!this.postMenuEnabled) return;
      for (const post of document.querySelectorAll('shreddit-post')) {
        const type = String(post.getAttribute('post-type') || '').toLowerCase();
        if (!SUPPORTED_POST_TYPES.has(type) && !post.querySelector('shreddit-embed')) continue;
        const menu = post.querySelector('shreddit-post-overflow-menu');
        if (menu) this.syncPostMenuItem(menu, post);
      }
      this.dedupePostSheet();
    }

    syncPostMenuItem(menu, post) {
      if (!this.postMenuEnabled) return;
      const type = String(post.getAttribute('post-type') || '').toLowerCase();
      if (!SUPPORTED_POST_TYPES.has(type) && !post.querySelector('shreddit-embed')) return;
      const media = extractPostMedia(post);
      if (!media.postId || !media.subreddit) return;
      // Embedded media: its still is read from the post's data on the Visual tab when the page has none.
      const hasSource = Boolean(media.fallbackImageUrl || media.embed || DownloadModel?.hasMediaSource?.(post, type));
      if (!hasSource) return;

      const existing = menu.querySelector(':scope > [slot="devvit-context-actions"] [data-rt-visual-menu="item"]');
      if (existing) return;

      let slot = menu.querySelector(':scope > [slot="devvit-context-actions"]');
      if (!slot) {
        slot = make('div');
        slot.setAttribute('slot', 'devvit-context-actions');
        menu.append(slot);
      }
      slot.append(this.buildPostMenuItem(post));
      MenuDOM?.reconcile?.(slot);
      MenuDOM?.clampMenu?.(menu);
    }

    buildPostMenuItem(post) {
      const li = make('li', 'relative list-none mt-0');
      li.setAttribute('role', 'presentation');
      li.dataset.rtVisualMenu = 'item';
      li.dataset.rtMenuAction = 'visual-similar';
      li.dataset.rtUi = 'visual-menu-item';

      const row = make('div', MENU_ROW_CLS);
      row.setAttribute('role', 'menuitem');
      row.tabIndex = -1;
      row.style.paddingInlineEnd = '16px';

      const lead = make('span', 'flex items-center gap-xs min-w-0 shrink');
      const box = make('span', 'flex shrink-0 items-center justify-center h-xl w-xl text-20 leading-4');
      box.append(icon('camera', 20));
      const text = make('span', 'flex items-center min-w-0 shrink py-[0.375rem]');
      text.append(make('span', 'text-body-2', 'Find visually similar'));
      lead.append(box, text);
      row.append(lead);
      li.append(row);

      const activate = event => {
        event.preventDefault();
        event.stopImmediatePropagation();
        const media = extractPostMedia(post);
        if (!media.postId || !media.subreddit) return;
        this.savePostSeed(media);
        MenuDOM?.closeSubmenu?.(false);
        const dest = Model.buildVisualUrl(location.href, {
          basePath: '/search/',
          q: '',
          postSeed: { subreddit: media.subreddit, postId: media.postId },
          cleanNav: true
        });
        this.navigateUrl(dest.href);
      };
      row.addEventListener('click', activate, true);
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') activate(e);
      }, true);
      return li;
    }

    dedupePostSheet() {
      const portal = document.getElementById('post-overflow-menu-bottom-sheet');
      if (!portal) return;
      if (!this.postMenuEnabled) {
        const slots = new Set();
        for (const item of portal.querySelectorAll('[data-rt-visual-menu="item"]')) {
          const slot = item.closest?.('[slot="devvit-context-actions"]');
          if (slot) slots.add(slot);
          item.remove();
        }
        for (const slot of slots) MenuDOM?.reconcile?.(slot);
        return;
      }
      MenuDOM?.retainAction?.(portal, '[data-rt-visual-menu="item"]');
    }

    // ---- Navigation & Event Handlers ---------------------------------------------------------------------------

    applyFilterPatch(patch) {
      const parsed = Model.parseVisualUrl(location.href);
      if (!parsed?.active) return;
      const nextFilters = Model.normalizeFilters({ ...parsed.filters, ...patch });
      const dest = Model.buildVisualUrl(location.href, {
        q: parsed.q,
        filters: nextFilters,
        uploadUuid: parsed.uploadUuid,
        viewId: parsed.viewId,
        postSeed: parsed.postSeed,
        popular: parsed.popular,
        vscope: parsed.vscope
      });
      this.replaceVisualUrl(dest);
    }

    pushVisualUrl(nextUrl) {
      const nextHref = nextUrl.pathname + nextUrl.search + nextUrl.hash;
      const curHref = location.pathname + location.search + location.hash;
      if (nextHref === curHref) return;
      this.savePark();
      try { history.pushState(history.state, '', nextHref); }
      catch { return; }
      this.lastUrl = location.href;
      const parsed = Model.parseVisualUrl(location.href);
      const main = this.mountedMain || document.querySelector('main');
      if (parsed?.active && main) {
        this.syncSearchTabGroup(parsed);
        this.mountFreshVisual(main, parsed, urlKey(location.href));
      } else {
        this.sync();
      }
    }

    replaceVisualUrl(nextUrl) {
      const nextHref = nextUrl.pathname + nextUrl.search + nextUrl.hash;
      const curHref = location.pathname + location.search + location.hash;
      if (nextHref === curHref) return; // Contract Rule 8: never replaceState with unchanged URL.
      try { history.replaceState(history.state, '', nextHref); }
      catch { return; }
      this.lastUrl = location.href;
      const parsed = Model.parseVisualUrl(location.href);
      const main = this.mountedMain || document.querySelector('main');
      if (parsed?.active && main) {
        this.syncSearchTabGroup(parsed);
        this.mountFreshVisual(main, parsed, urlKey(location.href));
      } else {
        this.sync();
      }
    }

    navigateUrl(href) {
      try { sessionStorage.setItem(ENABLED_SESSION_KEY, '1'); } catch {}
      const target = new URL(href, location.origin);
      const parsedCur = Model.parseVisualUrl(location.href);
      if (parsedCur && this.mountedMain) {
        this.syncSearchTabGroup(Model.parseVisualUrl(target.href));
      }
      const a = make('a', '');
      a.href = target.href;
      a.hidden = true;
      a.dataset.rtUi = 'visual-nav-link';
      (document.body || document.documentElement).append(a);
      a.click();
      a.remove();
    }

    handlePointerDown(event) {
      if (!this.enabled || !this.host?.isConnected) return;
      // If user clicks outside open desktop menus, close them cleanly.
      const path = event.composedPath?.() || [];
      if (this.openDropdown && !path.includes(this.openDropdown.menu) && !path.includes(this.openDropdown.trigger)) {
        this.closeDropdown();
      }
      if (this.uploadPopover && !path.includes(this.uploadPopover.panel) && !path.includes(this.uploadPopover.anchor)) {
        this.closeUploadPopover();
      }
      if (event.pointerType === 'touch' || event.pointerType === 'pen') this.startHold(event, path);
    }

    // Press and hold a clip in the grid (touch): it plays, muted, while held and stops when the finger lifts. A clip
    // that was already previewing keeps playing afterwards. Moving the finger first (a scroll) cancels the hold.
    startHold(event, path) {
      this.endHold(false);
      if (event.button > 0 || event.isPrimary === false) return;
      const media = path.find(node => node?.classList?.contains?.('rt-vs-media'));
      if (!media?.dataset?.videoUrl || !this.host?.contains(media) || path.some(node => node?.classList?.contains?.('rt-vs-overlay-actions') || node?.classList?.contains?.('rt-vs-more-btn'))) return;
      const hold = { media, x: event.clientX, y: event.clientY, engaged: false, keep: this.hoveredPreview?.media === media, timer: 0 };
      hold.timer = setTimeout(() => {
        if (this.hold !== hold || this.dead || !media.isConnected) return;
        hold.engaged = true;
        media.dataset.held = 'true';
        if (this.hoveredPreview?.media !== media) this.startPreview(media, { manual: true });
      }, HOLD_PREVIEW_MS);
      this.hold = hold;
    }

    endHold(released) {
      const hold = this.hold;
      if (!hold) return;
      this.hold = null;
      clearTimeout(hold.timer);
      if (!hold.engaged) return;
      delete hold.media.dataset.held;
      // The lift that ends a hold is not a tap on the result.
      if (released) this.suppressClickUntil = performance.now() + 500;
      if (!hold.keep && this.hoveredPreview?.media === hold.media) this.stopVideoPreview();
    }

    handleDocClick(event) {
      if (this.enabled && performance.now() < (this.suppressClickUntil || 0) && this.host && event.composedPath?.().includes(this.host)) {
        this.suppressClickUntil = 0;
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (!this.enabled || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const path = event.composedPath?.() || [];
      const link = path.find(node => node?.tagName === 'A' && node.hasAttribute?.('href'));
      if (!link || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;

      // Native tab click inside #search-results-page-tabgroup while on Visual tab.
      const tg = link.closest?.('#search-results-page-tabgroup');
      if (tg && link.dataset?.rtUi !== 'visual-search-tab' && Model.parseVisualUrl(location.href)?.active) {
        this.handleTabNavigationClick(event, new URL(link.getAttribute('href'), location.href));
        return;
      }

      // Click on a result tile or link inside our Visual Search view -> preserve grid through transition!
      if (this.host && path.includes(this.host) && !link.dataset?.rtVisualTabNav) {
        let dest;
        try { dest = new URL(link.getAttribute('href'), location.origin); } catch { return; }
        if (dest.origin !== location.origin) return;
        const tile = path.find(node => node?.classList?.contains?.('rt-vs-tile'));
        const item = tile ? this.state?.items?.find(it => it.uuid === tile.dataset.uuid) : null;
        const onMedia = Boolean(item && path.some(node => node?.classList?.contains?.('rt-vs-media')));
        // Clicking the media follows the Visual search click choice; the title and community always open their page.
        if (onMedia && this.clickChoice.visualClick === 'viewer') {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.openLightbox(item, link);
          return;
        }
        if (onMedia && this.clickChoice.visualClick === 'inline') {
          event.preventDefault();
          event.stopImmediatePropagation();
          const media = tile.querySelector('.rt-vs-media');
          if (!item.videoUrl) this.openLightbox(item, link);
          else if (this.hoveredPreview?.media === media && this.hoveredPreview.manual) this.stopVideoPreview();
          else this.startPreview(media, { manual: true });
          return;
        }
        if (item && /\/comments\/[a-z0-9]+/i.test(dest.pathname)) {
          const media = tile.querySelector('.rt-vs-media');
          if (item.isVideo && !item.isGif && item.postId && this.hoveredPreview?.media === media) {
            document.dispatchEvent(new CustomEvent('rt-visual-continue', { detail: { id: item.postId, time: this.previewTime(media), source: onMedia ? 'media' : 'title' } }));
          }
        }
        const clickedUuid = tile?.dataset?.uuid || '';
        const clickedOffset = tile ? tile.getBoundingClientRect().top : 0;
        const expectPost = /\/comments\/[a-z0-9]+/i.test(dest.pathname);
        this.startDeparture({ clickedUuid, clickedOffset, expectPost });
      }
    }

    handleKeydown(event) {
      if (!this.enabled) return;
      if (event.key === 'Escape') {
        if (this.openDropdown) {
          event.preventDefault();
          event.stopPropagation();
          this.closeDropdown(true);
          return;
        }
        if (this.uploadPopover) {
          event.preventDefault();
          event.stopPropagation();
          this.closeUploadPopover(true);
          return;
        }
      }
      if (event.key === 'Enter' && !event.isComposing && !event.repeat && event.keyCode !== 229 &&
          !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
        this.handleSearchSubmit(event);
      }
    }

    dismissSearchBar(host, input) {
      const esc = () => new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, composed: true, cancelable: true });
      try { input?.dispatchEvent(esc()); } catch {}
      try { host?.dispatchEvent(esc()); } catch {}
      try { input?.blur?.(); } catch {}
      try { host?.blur?.(); } catch {}
      const roots = [host?.shadowRoot, input?.getRootNode?.()].filter(r => r && r !== document);
      for (const root of roots) {
        const drop = root.querySelector?.('#search-dropdown-results-container');
        if (drop) drop.classList.add('hidden');
      }
    }

    handleSearchSubmit(event) {
      if (!this.enabled || event.defaultPrevented) return;
      const parsed = Model.parseVisualUrl(location.href);
      if (!parsed?.active) return;
      const path = event.composedPath?.() || [];
      const host = path.find(node => node?.matches?.('reddit-search-large, reddit-search-small, prominent-search'));
      const form = path.find(node => node?.matches?.('form'));
      if (!host || !form) return;
      const sr = host.shadowRoot || host;
      if (event.type === 'keydown') {
        const activeRow = sr.querySelector?.('#reddit-typeahead-results-partial-container [aria-selected="true"]');
        const activeId = path[0]?.getAttribute?.('aria-activedescendant');
        if (activeRow || (activeId && sr.getElementById?.(activeId))) return;
        if (!path[0]?.matches?.('input[name="q"], textarea[name="q"]')) return;
      }
      const field = form.querySelector('faceplate-search-input[name="q"]');
      const input = event.type === 'keydown'
        ? path[0]
        : (field?.shadowRoot || form).querySelector('input[name="q"], textarea[name="q"]');
      if (!input) return;
      const q = String(input.value || '').trim().slice(0, 300);
      event.preventDefault();
      event.stopImmediatePropagation();
      this.dismissSearchBar(host, input);
      const dest = Model.buildVisualUrl(location.href, {
        q,
        filters: parsed.filters,
        cleanNav: true
      });
      if (urlKey(dest.href) === urlKey(location.href)) {
        this.startLoad(Model.parseVisualUrl(dest.href), { force: true });
        return;
      }
      this.savePark();
      this.startProgress();
      const destParsed = Model.parseVisualUrl(dest.href);
      if (destParsed?.spec) {
        this.send({
          action: 'query',
          kind: destParsed.spec.kind,
          target: destParsed.spec.target,
          slug: destParsed.spec.slug,
          filters: destParsed.spec.filters,
          page: 1
        }).catch(() => {});
      }
      this.navigateUrl(dest.href);
    }

    handlePaste(event) {
      if (!this.enabled) return;
      const activeVisual = Boolean(Model.parseVisualUrl(location.href)?.active);
      if (!activeVisual && !this.uploadPopover) return;
      const active = document.activeElement;
      if (active && active.matches?.('input, textarea, [contenteditable]')) return;
      const items = [...(event.clipboardData?.items || [])];
      const imgItem = items.find(item => item.type?.startsWith('image/'));
      if (!imgItem) return;
      const blob = imgItem.getAsFile?.();
      if (!blob) return;
      event.preventDefault();
      this.uploadAndSearch(blob);
    }

    // ---- Session helpers & Cleanup -----------------------------------------------------------------------------

    trackPreviewUrl(url) {
      if (!url) return;
      this.localPreviewUrls.add(url);
      while (this.localPreviewUrls.size > 8) {
        const oldest = this.localPreviewUrls.values().next().value;
        this.localPreviewUrls.delete(oldest);
        URL.revokeObjectURL(oldest);
      }
    }

    saveUploadPreview(uuid, url) {
      if (!uuid || !url) return;
      try { sessionStorage.setItem(UPLOAD_META_PREFIX + uuid, url); } catch {}
    }

    readUploadPreview(key) {
      if (!key) return '';
      try {
        const val = sessionStorage.getItem(UPLOAD_META_PREFIX + key) || '';
        if (val.startsWith('data:image/')) return val;
        return val.startsWith('blob:') && this.localPreviewUrls.has(val) ? val : '';
      } catch { return ''; }
    }

    savePostSeed(media) {
      try {
        sessionStorage.setItem(POST_SEED_PREFIX + media.subreddit + '/' + media.postId, JSON.stringify({
          subreddit: media.subreddit,
          postId: media.postId,
          title: media.title,
          fallbackImageUrl: media.fallbackImageUrl,
          autoUpload: media.autoUpload === true
        }));
      } catch {}
    }

    readPostSeed(seed) {
      if (!seed) return null;
      try {
        const raw = sessionStorage.getItem(POST_SEED_PREFIX + seed.subreddit + '/' + seed.postId);
        return raw ? JSON.parse(raw) : null;
      } catch { return null; }
    }

    // ---- Entry Point 4: lens on Reddit's own media (separate opt-in) ---------------------------------------------
    // A lens button on image, gallery, video and GIF posts (top left of the media, where Reddit draws nothing). It
    // searches with that picture: the post's own image, or the thumbnail of a video or GIF. Blurred (NSFW / spoiler)
    // media gets none.
    syncMediaLenses() {
      if (!this.mediaLensEnabled) return;
      for (const post of document.querySelectorAll('shreddit-post')) {
        const type = String(post.getAttribute('post-type') || '').toLowerCase();
        const slot = post.querySelector('[slot="post-media-container"]');
        const box = slot?.firstElementChild;
        const existing = box?.querySelector?.(':scope > [data-rt-ui="visual-media-lens"]');
        const blurred = Boolean(post.querySelector('shreddit-blurred-container[blurred]'));
        const embedded = Boolean(slot?.querySelector('shreddit-embed'));
        if (!(SUPPORTED_POST_TYPES.has(type) || embedded) || !box || blurred) { existing?.remove(); continue; }
        if (existing) continue;
        const media = extractPostMedia(post);
        // Embeds always get one: a still the page doesn't have is read from the post's data on the Visual tab.
        if (!media.postId || !media.subreddit || !(media.fallbackImageUrl || media.embed)) continue;
        if (getComputedStyle(box).position === 'static') continue;
        box.append(this.buildMediaLens(post));
      }
    }

    // Search with a post's picture (the lens on a post, or a tile on Reddit's Media tab): the post is looked up on
    // infini.wtf, and when it isn't indexed its picture is uploaded as an image search.
    searchFromPost(media) {
      if (!media?.postId || !media.subreddit || !(media.fallbackImageUrl || media.embed)) return;
      this.savePostSeed({ postId: media.postId, subreddit: media.subreddit, title: media.title || '', fallbackImageUrl: media.fallbackImageUrl, autoUpload: true });
      const dest = Model.buildVisualUrl(location.href, {
        basePath: '/search/',
        q: '',
        postSeed: { subreddit: media.subreddit, postId: media.postId },
        cleanNav: true
      });
      this.navigateUrl(dest.href);
    }

    // ---- Reddit's own Media tab: a full-screen button on each tile opens the same viewer ----------------------

    syncNativeMediaViewer() {
      const feed = document.querySelector('search-media-feed');
      if (!feed || Model.parseVisualUrl(location.href)?.active) return;
      this.lightbox?.refreshNative?.();
      for (const tile of feed.querySelectorAll(NATIVE_MEDIA_TILE)) {
        Overlay.bindPlayer(tile.querySelector(Overlay.searchPlayer));
        if (tile.querySelector(':scope [data-rt-ui="native-media-expand"]')) continue;
        if (!nativeMediaItem(tile)) continue;
        const btn = make('button', 'rt-vs-icon-btn rt-vs-native-expand');
        btn.type = 'button';
        btn.dataset.rtUi = 'native-media-expand';
        btn.title = 'View larger';
        btn.setAttribute('aria-label', 'View larger');
        btn.append(icon('expand', 16));
        // Reddit opens the post on any press inside its tile: keep the press and the click to ourselves.
        for (const type of ['pointerdown', 'mousedown', 'touchstart']) btn.addEventListener(type, e => e.stopPropagation(), { passive: true });
        btn.addEventListener('click', e => {
          e.preventDefault();
          e.stopImmediatePropagation();
          const item = nativeMediaItem(tile);
          if (item) this.openLightbox(item, btn, { list: () => nativeMediaItems(document.querySelector('search-media-feed')) });
        });
        // On the tile itself, beside Reddit's link rather than inside it (most tiles are one link around everything).
        tile.append(btn);
      }
    }

    teardownNativeMediaViewer() {
      for (const btn of document.querySelectorAll('[data-rt-ui="native-media-expand"]')) btn.remove();
    }

    buildMediaLens(post) {
      const btn = make('button', 'rt-vs-media-lens');
      btn.type = 'button';
      btn.dataset.rtUi = 'visual-media-lens';
      btn.title = 'Search with this image';
      btn.setAttribute('aria-label', 'Search with this image');
      btn.append(lensIcon(18));
      // Reddit opens the post on any click inside a card: keep the press and the click to ourselves.
      for (const type of ['pointerdown', 'mousedown', 'touchstart']) btn.addEventListener(type, e => e.stopPropagation(), { passive: true });
      btn.addEventListener('click', e => {
        e.preventDefault();
        e.stopImmediatePropagation();
        this.searchFromPost(extractPostMedia(post));
      });
      return btn;
    }

    teardownMediaLenses() {
      for (const btn of document.querySelectorAll('[data-rt-ui="visual-media-lens"]')) btn.remove();
    }

    teardownPostMenus() {
      const slots = new Set();
      for (const item of document.querySelectorAll('[data-rt-visual-menu="item"]')) {
        const slot = item.closest?.('[slot="devvit-context-actions"]');
        if (slot) slots.add(slot);
        item.remove();
      }
      for (const slot of slots) MenuDOM?.reconcile?.(slot);
      this.dedupePostSheet();
    }

    teardownHeaderTriggers() {
      globalThis.RTVisualLens?.set(false);
      for (const host of document.querySelectorAll('reddit-search-large, reddit-search-small, prominent-search')) {
        host.shadowRoot?.querySelectorAll?.('[data-rt-ui="visual-search-trigger"]')?.forEach(el => el.remove());
        host.querySelectorAll?.('[data-rt-ui="visual-search-trigger"]')?.forEach(el => el.remove());
      }
    }

    teardownSearchTabs() {
      this.tabShadowObserver?.disconnect();
      this.tabShadowObserver = null;
      this.tabShadowTarget = null;
      this.visualTabScrolled = null;
      const tg = document.querySelector('#search-results-page-tabgroup');
      if (!tg) return;
      tg.querySelectorAll(':scope > [data-rt-ui="visual-search-tab"]').forEach(el => el.remove());
      tg.shadowRoot?.querySelectorAll?.('[data-rt-ui="visual-search-slot"]')?.forEach(el => el.remove());
      const origWraps = this.tabOriginals.get(tg);
      if (origWraps) {
        for (const [wrap, origSelected] of origWraps) {
          if (!wrap.isConnected) continue;
          if (origSelected == null) wrap.removeAttribute('aria-selected');
          else wrap.setAttribute('aria-selected', origSelected);
        }
        this.tabOriginals.delete(tg);
      }
      for (const tab of tg.querySelectorAll(':scope > a[href]')) {
        tab.removeAttribute('data-rt-visual-tab-muted');
        const origHref = this.nativeTabLinks.get(tab);
        if (origHref) tab.setAttribute('href', origHref);
        const backup = this.nativeTabBackup.get(tab);
        if (backup) {
          tab.className = backup.className;
          if (backup.ariaCurrent == null) tab.removeAttribute('aria-current');
          else tab.setAttribute('aria-current', backup.ariaCurrent);
          if (backup.tabIndex != null) tab.tabIndex = backup.tabIndex;
          tab.toggleAttribute('faceplate-tab-selected', Boolean(backup.selected));
          if (backup.style == null) tab.removeAttribute('style');
          else tab.setAttribute('style', backup.style);
        }
      }
    }

    teardownActive() {
      this.gen++;
      this.stopPolling();
      this.stopScrollRestore();
      clearTimeout(this.postScrollTimer);
      clearTimeout(this.outgoing?.timer);
      clearTimeout(this.waitingTimer);
      clearTimeout(this.progressTimer);
      this.progressBar?.remove();
      this.progressBar = null;
      this.progressTimer = 0;
      this.moreIO?.disconnect();
      this.outgoing = null;
      this.waitingForReplacedMain = null;
      this.waitingTimer = 0;
      this.closeDropdown();
      this.closeUploadPopover();
      this.closeLightbox();
      this.stopVideoPreview();
      this.unmountVisualHost();
      this.teardownSearchTabs();
      this.teardownHeaderTriggers();
      this.teardownPostMenus();
      this.teardownMediaLenses();
      this.teardownNativeMediaViewer();
      this.parks.clear();
      this.urlParks.clear();
      for (const objUrl of this.videoBlobs.values()) URL.revokeObjectURL(objUrl);
      this.videoBlobs.clear();
      for (const objUrl of this.localPreviewUrls) URL.revokeObjectURL(objUrl);
      this.localPreviewUrls.clear();
      if (document.documentElement?.hasAttribute('data-rt-visual-active')) {
        document.documentElement.removeAttribute('data-rt-visual-active');
        document.documentElement.removeAttribute('data-rt-visual-ready');
        this.notifyOtherModules();
      }
    }

    destroy() {
      if (this.dead) return;
      this.dead = true;
      clearTimeout(this.settingsRetry);
      clearTimeout(this.lensTimer);
      this.observer?.disconnect();
      this.moreIO?.disconnect();
      this.videoIO?.disconnect();
      this.phoneMedia?.removeEventListener?.('change', this.onMediaChange);
      const runtime = (globalThis.browser || globalThis.chrome)?.runtime;
      const storage = (globalThis.browser || globalThis.chrome)?.storage;
      try { storage?.onChanged?.removeListener(this.onStorage); } catch {}
      try { runtime?.onMessage?.removeListener(this.onSettingsMsg); } catch {}
      document.removeEventListener('pointerdown', this.onDocPointerDown, true);
      document.removeEventListener('pointermove', this.onHoldMove, true);
      for (const type of ['pointerup', 'pointercancel']) window.removeEventListener(type, this.onHoldEnd, true);
      document.removeEventListener('contextmenu', this.onHoldMenu, true);
      this.endHold(false);
      document.removeEventListener('click', this.onDocClick, true);
      document.removeEventListener('keydown', this.onDocKeydown, true);
      document.removeEventListener('mouseover', this.onDocOver, true);
      document.removeEventListener('mouseout', this.onDocOut, true);
      document.removeEventListener('submit', this.onDocSubmit, true);
      document.removeEventListener('paste', this.onDocPaste, true);
      document.removeEventListener('visibilitychange', this.onVisibility);
      document.removeEventListener('reddit:route', this.onRoute);
      window.removeEventListener('popstate', this.onRoute);
      globalThis.navigation?.removeEventListener('currententrychange', this.onRoute);
      window.removeEventListener('scroll', this.onScrollPause);
      for (const evt of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
        window.removeEventListener(evt, this.returnInputHandler, true);
      }
      this.fileInput?.remove();
      this.teardownActive();
    }
  }

  globalThis.RTVisualSearch = Object.freeze({ VisualSearchController });
  if (globalThis.chrome?.runtime?.id && !globalThis.__rtVisualSearchTest) {
    globalThis.RTVisualSearchInstance = new VisualSearchController();
  }
})();
