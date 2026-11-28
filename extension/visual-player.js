/* Visual search clip player (web-accessible extension page framed by visual-search.js on Reddit).
   Reddit's media-src blocks video.infini.wtf, so the page itself cannot stream these clips; this frame can. It plays
   one validated infini.wtf MP4, streams it (no size limit, first frame at once), and talks only to its parent window
   on reddit.com: commands in, playback state out. */
(() => {
  'use strict';
  const SRC_RE = /^https:\/\/video\.infini\.wtf\/[A-Za-z0-9_-]{6,40}\/original\.mp4$/;
  const PARENT_RE = /^https:\/\/(?:(?:www|new|sh)\.)?reddit\.com$/;
  const params = new URLSearchParams(location.hash.slice(1));
  const src = params.get('src') || '';
  const mode = params.get('mode') === 'viewer' ? 'viewer' : 'preview';
  const deferred = mode === 'viewer' && params.get('deferred') === '1';
  const id = (params.get('id') || '').slice(0, 40);
  const video = document.querySelector('video');
  let parentOrigin = '';
  try { parentOrigin = new URL(document.referrer || params.get('origin') || '').origin; } catch {}
  if (!PARENT_RE.test(parentOrigin)) parentOrigin = params.get('origin') && PARENT_RE.test(params.get('origin')) ? params.get('origin') : '';
  document.body.dataset.mode = mode;

  const post = (type, extra = {}) => {
    if (!parentOrigin || window.parent === window) return;
    window.parent.postMessage({
      rt: 'visual-player', id, type,
      time: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      paused: video.paused, muted: video.muted, volume: video.volume,
      rendered: video.readyState >= 2 && !video.seeking && video.currentTime > 0,
      ...extra
    }, parentOrigin);
  };

  post('hello');
  if ((!SRC_RE.test(src) && !(mode === 'viewer' && RTVideoOverlay.redditVideo(src))) || !parentOrigin) {
    post('error', { error: 'invalid' });
    return;
  }

  const start = Number.parseFloat(params.get('t') || '0');
  const wantSound = params.get('sound') === '1';
  video.loop = true;
  video.muted = !wantSound;
  video.controls = mode === 'viewer';
  video.preload = deferred ? 'none' : 'auto';
  if (mode === 'viewer') video.setAttribute('controlslist', 'nodownload noremoteplayback');
  video.src = src;
  video.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(start) && start > 0 && start < (video.duration || Infinity)) video.currentTime = start;
    post('ready');
  }, { once: true });
  const playButton = mode === 'viewer' ? RTVideoOverlay.button(document, params.get('gif') === '1') : null;
  if (playButton) {
    RTVideoOverlay.show(playButton, false);
    playButton.addEventListener('click', () => { RTVideoOverlay.loading(playButton, true); play(); });
    document.body.append(playButton);
  }
  const blocked = error => {
    if (error?.name !== 'NotAllowedError') return;
    if (playButton) {
      RTVideoOverlay.loading(playButton, false);
      RTVideoOverlay.show(playButton, true);
    }
    post('blocked');
  };
  const play = () => video.play().catch(error => {
    if (!video.muted && error?.name === 'NotAllowedError') {
      video.muted = true;
      video.play().catch(blocked);
    } else blocked(error);
  });
  const playing = () => {
    document.body.dataset.playing = 'true';
    if (playButton) {
      RTVideoOverlay.loading(playButton, false);
      RTVideoOverlay.show(playButton, false);
    }
  };
  video.addEventListener('playing', () => { playing(); post('playing'); });
  if (!deferred) play();

  let last = 0;
  video.addEventListener('timeupdate', () => {
    if (!video.paused && !video.seeking && video.readyState >= 2 && video.currentTime > 0 &&
        (!document.body.hasAttribute('data-playing') || playButton && !playButton.hidden)) playing();
    const now = performance.now();
    if (now - last < 250) return;
    last = now;
    post('time');
  });
  for (const type of ['pause', 'play', 'volumechange', 'ended']) video.addEventListener(type, () => post(type));
  video.addEventListener('error', () => post('error', { error: video.error?.code || 'media' }));

  // Touches on the clip land in this frame, never in the viewer around it: report swipes so the viewer can move to
  // the next result (left / right) or close (down) the same as it does for images.
  if (mode === 'viewer') {
    document.addEventListener('keydown', e => {
      if (e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      e.preventDefault();
      post('navigate', { direction: e.key === 'ArrowRight' ? 'next' : 'previous' });
    }, true);
    let touch = null;
    document.addEventListener('touchstart', e => {
      const t = e.touches.length === 1 ? e.touches[0] : null;
      touch = t ? { x: t.clientX, y: t.clientY, at: performance.now() } : null;
    }, { passive: true });
    document.addEventListener('touchend', e => {
      const t = e.changedTouches[0];
      if (!touch || !t) return;
      const dx = t.clientX - touch.x, dy = t.clientY - touch.y, quick = performance.now() - touch.at < 800;
      touch = null;
      if (!quick) return;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) post('swipe', { direction: dx < 0 ? 'next' : 'previous' });
      else if (dy > 90 && Math.abs(dy) > Math.abs(dx) * 1.5) post('swipe', { direction: 'down' });
    }, { passive: true });
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== parentOrigin) return;
    const msg = event.data;
    if (!msg || msg.rt !== 'visual-player' || msg.id !== id) return;
    switch (msg.cmd) {
      case 'play': play(); break;
      case 'pause': video.pause(); break;
      case 'mute': video.muted = true; break;
      case 'unmute': video.muted = false; if (video.paused) play(); break;
      case 'seek': if (Number.isFinite(msg.time)) video.currentTime = Math.max(0, msg.time); break;
      case 'state': post('state'); break;
      case 'focus-play': playButton?.focus({ preventScroll: true }); break;
      case 'stop':
        video.pause();
        video.removeAttribute('src');
        video.load();
        break;
    }
  });
})();
