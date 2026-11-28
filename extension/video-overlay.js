/* Shared Play mark for videos with a poster. The glyph matches Reddit's play-fill. */
(() => {
  'use strict';
  const svgNS = 'http://www.w3.org/2000/svg';
  const playPath = 'M6.348 1.5c-1.66 0-3.2 1.32-3.2 3.2v10.6c0 1.87 1.54 3.2 3.2 3.2.57 0 1.16-.16 1.7-.5l8.32-5.3c1.97-1.25 1.97-4.13 0-5.39L8.048 2c-.54-.35-1.13-.5-1.7-.5Z';
  const background = 'rgba(0, 0, 0, .7)';
  const searchTile = '[data-id="search-media-post-unit"]';
  const searchPlayer = ':is(shreddit-player, shreddit-player-2)[player-type="search_results"]';
  const gif = '[gif], [post-type="gif"], [data-media-type="gif"]';
  const gifHosts = /^(?:preview|cf\.preview|external-preview)\.redd\.it$/i;
  const bindings = new WeakMap();

  function gifUrl(value) {
    if (typeof value !== 'string' || !/\.gif(?:[?#]|$)/i.test(value)) return null;
    try {
      const url = new URL(value.replace(/&amp;/gi, '&'));
      if (url.protocol === 'https:' && !url.username && !url.password && !url.port &&
          (url.hostname === 'i.redd.it' || gifHosts.test(url.hostname)) && /\.gif$/i.test(url.pathname)) return url;
    } catch {}
    return null;
  }

  function isGif(node) {
    return Boolean(node?.closest?.(gif) || gifUrl(node?.getAttribute?.('src')));
  }

  function playingTime(video) {
    return video && !video.paused && !video.ended && Number.isFinite(video.currentTime) ? video.currentTime : null;
  }

  function redditVideo(value) {
    try {
      const url = new URL(String(value || '').replace(/&amp;/gi, '&'));
      if (url.protocol !== 'https:' || url.username || url.password || url.port ||
          !/^(?:i|v|cf\.v|packaged-media|preview|cf\.preview|external-preview)\.redd\.it$/i.test(url.hostname)) return '';
      const legacyDashFile = /^(?:cf\.)?v\.redd\.it$/i.test(url.hostname) && /^\/[a-z0-9]+\/DASH_\d+_K$/i.test(url.pathname);
      const gifPreview = gifHosts.test(url.hostname) && /\.gif$/i.test(url.pathname) && url.searchParams.get('format') === 'mp4';
      if (legacyDashFile || gifPreview || /\.(?:mp4|webm)$/i.test(url.pathname)) return url.href;
    } catch {}
    return '';
  }

  function mark(doc) {
    const disc = doc.createElement('span');
    disc.setAttribute('aria-hidden', 'true');
    Object.assign(disc.style, {
      display: 'grid', placeItems: 'center', width: '56px', height: '56px',
      borderRadius: '50%', background, color: '#fff', pointerEvents: 'none'
    });
    const svg = doc.createElementNS(svgNS, 'svg');
    for (const [name, value] of Object.entries({ viewBox: '0 0 20 20', width: '32', height: '32', fill: 'currentColor' })) {
      svg.setAttribute(name, value);
    }
    const path = doc.createElementNS(svgNS, 'path');
    path.setAttribute('d', playPath);
    svg.append(path);
    disc.append(svg);
    return disc;
  }

  function center(element) {
    Object.assign(element.style, { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' });
    return element;
  }

  function button(doc, isGif = false) {
    const control = center(doc.createElement('button'));
    control.type = 'button';
    control.dataset.rtVideoPlay = '';
    Object.assign(control.style, {
      zIndex: '5', width: '56px', height: '56px', boxSizing: 'border-box',
      border: '0', margin: '0', padding: '0', overflow: 'visible',
      borderRadius: '50%', background: 'transparent', cursor: 'pointer'
    });
    setKind(control, isGif);
    return control;
  }

  function setKind(control, isGif) {
    const label = isGif ? 'Play GIF' : 'Play video';
    if (control.getAttribute('aria-label') === label) return;
    control.setAttribute('aria-label', label);
    const disc = mark(control.ownerDocument);
    if (isGif) {
      disc.textContent = 'GIF';
      disc.style.font = '700 15px/1 system-ui, sans-serif';
    }
    if (control.firstElementChild) control.firstElementChild.replaceWith(disc);
    else control.append(disc);
  }

  function show(control, visible) {
    control.hidden = !visible;
    if (visible) control.style.removeProperty('display');
    else control.style.setProperty('display', 'none', 'important');
  }

  function loading(control, active) {
    if (!control) return;
    const existing = control.querySelector(':scope > [data-rt-video-loading]');
    if (existing) {
      if (!active) {
        existing.getAnimations?.().forEach(animation => animation.cancel());
        existing.remove();
      }
      return;
    }
    if (!active) return;
    const doc = control.ownerDocument;
    const ring = doc.createElement('span');
    ring.dataset.rtVideoLoading = '';
    ring.setAttribute('aria-hidden', 'true');
    Object.assign(ring.style, {
      position: 'absolute', inset: '-5px', border: '3px solid rgba(255,255,255,.32)',
      borderTopColor: 'rgba(255,255,255,.94)', borderRightColor: 'rgba(255,255,255,.75)',
      borderRadius: '50%', boxSizing: 'border-box', pointerEvents: 'none'
    });
    control.append(ring);
    if (!doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      ring.animate?.([{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }], { duration: 800, iterations: Infinity });
    }
  }

  function styleNative(root) {
    if (!root || root.querySelector('style[data-rt-video-play]')) return;
    const style = root.ownerDocument.createElement('style');
    style.dataset.rtVideoPlay = '';
    style.textContent = `.poster-play-button > svg[icon-name="play-fill"] {
      box-sizing: content-box; width: 32px; height: 32px; padding: 12px;
      background: ${background}; border-radius: 50%;
    }`;
    root.append(style);
  }

  function bindPlayer(player) {
    if (!player || player.closest('shreddit-blurred-container[blurred]')) return;
    const inSearch = player.matches(searchPlayer) && player.closest(searchTile);
    const gifPlayer = isGif(player);
    if (!inSearch && (!player.matches('[player-type="in_feed_player"]') || gifPlayer)) return;
    const root = player.shadowRoot;
    const video = root?.querySelector('video');
    if (!video) return;
    const previous = bindings.get(player);
    if (previous?.video === video && previous.control.isConnected) return;
    previous?.dispose();
    const control = button(player.ownerDocument, gifPlayer);
    show(control, video.paused || video.readyState < 2);
    const wait = () => { if (!control.hidden) loading(control, true); };
    const hide = () => { loading(control, false); show(control, false); };
    const rest = () => { loading(control, false); if (video.paused || !video.readyState) show(control, true); };
    const waitingEvents = ['play', 'waiting'];
    const restingEvents = ['pause', 'ended', 'emptied', 'error'];
    video.addEventListener('playing', hide);
    for (const event of waitingEvents) video.addEventListener(event, wait);
    for (const event of restingEvents) video.addEventListener(event, rest);
    control.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      if (inSearch) video.muted = true; // Reddit's Media grid is muted.
      // Play inside the card without following its link. Use Reddit's playback controller where available.
      if (player.dispatchEvent(new Event('rt-play-video', { bubbles: true, cancelable: true }))) {
        video.play()?.catch(() => {});
      }
    });
    root.append(control);
    bindings.set(player, { video, control, dispose() {
      video.removeEventListener('playing', hide);
      for (const event of waitingEvents) video.removeEventListener(event, wait);
      for (const event of restingEvents) video.removeEventListener(event, rest);
      loading(control, false);
      control.remove();
    } });
  }

  globalThis.RTVideoOverlay = Object.freeze({ mark, center, button, setKind, loading, show, styleNative, bindPlayer, redditVideo, searchTile, searchPlayer, gifUrl, isGif, playingTime });
})();
