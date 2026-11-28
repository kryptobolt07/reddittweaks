/* Shared Play mark for videos with a poster. The glyph matches Reddit's play-fill. */
(() => {
  'use strict';
  const svgNS = 'http://www.w3.org/2000/svg';
  const playPath = 'M6.348 1.5c-1.66 0-3.2 1.32-3.2 3.2v10.6c0 1.87 1.54 3.2 3.2 3.2.57 0 1.16-.16 1.7-.5l8.32-5.3c1.97-1.25 1.97-4.13 0-5.39L8.048 2c-.54-.35-1.13-.5-1.7-.5Z';
  const background = 'rgba(0, 0, 0, .7)';
  const searchTile = '[data-id="search-media-post-unit"]';
  const searchPlayer = ':is(shreddit-player, shreddit-player-2)[player-type="search_results"]';
  const gif = '[gif], [post-type="gif"], [data-media-type="gif"]';
  const bindings = new WeakMap();

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
    control.setAttribute('aria-label', isGif ? 'Play GIF' : 'Play video');
    control.dataset.rtVideoPlay = '';
    Object.assign(control.style, {
      zIndex: '5', width: '56px', height: '56px', boxSizing: 'border-box',
      border: '0', margin: '0', padding: '0', overflow: 'visible',
      borderRadius: '50%', background: 'transparent', cursor: 'pointer'
    });
    const disc = mark(doc);
    if (isGif) {
      disc.textContent = 'GIF';
      disc.style.font = '700 15px/1 system-ui, sans-serif';
    }
    control.append(disc);
    return control;
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
    const isGif = Boolean(player.closest(gif));
    if (!inSearch && (!player.matches('[player-type="in_feed_player"]') || isGif)) return;
    const root = player.shadowRoot;
    const video = root?.querySelector('video');
    if (!video) return;
    const previous = bindings.get(player);
    if (previous?.video === video && previous.control.isConnected) return;
    previous?.dispose();
    const control = button(player.ownerDocument, isGif);
    control.hidden = !video.paused && video.readyState >= 2;
    const hide = () => { control.hidden = true; };
    const show = () => { if (video.paused || !video.readyState) control.hidden = false; };
    video.addEventListener('playing', hide);
    for (const event of ['pause', 'ended', 'emptied']) video.addEventListener(event, show);
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
      for (const event of ['pause', 'ended', 'emptied']) video.removeEventListener(event, show);
      control.remove();
    } });
  }

  globalThis.RTVideoOverlay = Object.freeze({ mark, center, button, styleNative, bindPlayer, searchTile, searchPlayer, gif });
})();
