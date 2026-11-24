/* Visual search clip player (web-accessible extension page framed by visual-search.js on Reddit).
   Reddit's media-src blocks video.infini.wtf, so the page itself cannot stream these clips; this frame can. It plays
   one validated infini.wtf MP4, streams it (no size limit, first frame at once), and talks only to its parent window
   on reddit.com: commands in, playback state out. */
(() => {
  'use strict';
  const SRC_RE = /^https:\/\/video\.infini\.wtf\/[A-Za-z0-9_-]{6,40}\/original\.mp4$/;
  const PARENT_RE = /^https:\/\/(?:www|new|sh)\.reddit\.com$/;
  const params = new URLSearchParams(location.hash.slice(1));
  const src = params.get('src') || '';
  const mode = params.get('mode') === 'viewer' ? 'viewer' : 'preview';
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
      ...extra
    }, parentOrigin);
  };

  post('hello');
  if (!SRC_RE.test(src) || !parentOrigin) {
    post('error', { error: 'invalid' });
    return;
  }

  const start = Number.parseFloat(params.get('t') || '0');
  const wantSound = params.get('sound') === '1';
  video.loop = true;
  video.muted = !wantSound;
  video.controls = mode === 'viewer';
  video.preload = 'auto';
  if (mode === 'viewer') video.setAttribute('controlslist', 'nodownload noremoteplayback');
  video.src = src;
  video.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(start) && start > 0 && start < (video.duration || Infinity)) video.currentTime = start;
    post('ready');
  }, { once: true });
  const play = () => video.play().then(() => post('playing'), () => {
    // Sound without user activation is refused: keep going muted and say so.
    if (!video.muted) { video.muted = true; video.play().then(() => post('playing', { soundBlocked: true }), () => post('blocked')); }
    else post('blocked');
  });
  play();

  let last = 0;
  video.addEventListener('timeupdate', () => {
    const now = performance.now();
    if (now - last < 250) return;
    last = now;
    post('time');
  });
  for (const type of ['pause', 'play', 'volumechange', 'ended']) video.addEventListener(type, () => post(type));
  video.addEventListener('error', () => post('error', { error: video.error?.code || 'media' }));

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
      case 'stop':
        video.pause();
        video.removeAttribute('src');
        video.load();
        break;
    }
  });
})();
