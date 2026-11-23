/* Sort & filter within reach down the feed (docs/feed-controls-ux-plan.md, 6). Once the feed's own Sort & filter row
   has scrolled under Reddit's header, scrolling up slides a compact pill in under the header, aligned with the row;
   scrolling down hides it again, and it never shows while the row itself is visible. Activating it runs the owner's
   open(button): a popover under the pill on computers, the sheet on phones. One dock per page; the latest owner wins. */
(() => {
  'use strict';
  if (window.top !== window || globalThis.RTFeedDock) return;
  const SHOW_AFTER = 24, HIDE_AFTER = 8;
  let owner = null, button = null, frame = 0, edge = 0, lastY = 0, shown = false;

  const headerBottom = () => {
    let bottom = 0;
    for (const header of document.querySelectorAll('reddit-header-large,reddit-header-small')) {
      const box = header.getBoundingClientRect();
      if (box.height && box.bottom > bottom && box.top < 1) bottom = box.bottom;
    }
    return Math.max(0, Math.round(bottom));
  };

  function make() {
    const glyph = globalThis.RTFeedFilters?.svgIcon?.('filter', 16);
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'rt-feed-dock';
    el.dataset.rtUi = 'feed-dock';
    el.setAttribute('aria-haspopup', 'true');
    el.setAttribute('aria-hidden', 'true');
    el.tabIndex = -1;
    if (glyph) el.append(glyph);
    const text = document.createElement('span');
    text.className = 'rt-feed-dock-label';
    text.textContent = 'Sort & filter';
    el.append(text);
    el.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      owner?.open?.(el);
    });
    return el;
  }

  function paintCount() {
    if (!button || !owner) return;
    const count = Math.max(0, Number(owner.count?.() || 0));
    let badge = button.querySelector(':scope>.rt-filter-count');
    if (count) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'rt-filter-count';
        badge.setAttribute('aria-hidden', 'true');
        button.append(badge);
      }
      badge.textContent = String(count);
      button.setAttribute('data-rt-filter-count', String(count));
    } else {
      badge?.remove();
      button.removeAttribute('data-rt-filter-count');
    }
    button.setAttribute('aria-label', 'Sort & filter' + (count ? ', ' + count + (count === 1 ? ' filter' : ' filters') + ' applied' : ''));
  }

  function setShown(next, top = headerBottom(), left = 12) {
    if (!button) return;
    button.style.setProperty('--rt-dock-top', top + 'px');
    button.style.setProperty('--rt-dock-left', Math.max(8, Math.round(left)) + 'px');
    if (shown === next) return;
    shown = next;
    button.toggleAttribute('data-rt-shown', next);
    button.setAttribute('aria-hidden', String(!next));
    button.tabIndex = next ? 0 : -1;
    if (!next && document.activeElement === button) button.blur();
  }

  function update() {
    frame = 0;
    const anchor = owner?.anchor?.();
    if (!owner || !anchor?.isConnected) { setShown(false); return; }
    const y = Math.max(scrollY, 0), top = headerBottom(), box = anchor.getBoundingClientRect();
    // Its own menu is open: stay put until it closes.
    if (shown && button?.getAttribute('aria-expanded') === 'true') { edge = lastY = y; setShown(true, top, box.left); return; }
    const rowHidden = box.height > 0 && box.bottom <= top;
    if (!rowHidden) { edge = y; lastY = y; setShown(false, top, box.left); return; }
    // Direction with hysteresis, as Reddit's own phone header does: edge is the lowest point while hidden and the
    // highest point while shown.
    if (y > lastY) {
      if (!shown) edge = y;
      else if (y - edge >= HIDE_AFTER) { edge = y; setShown(false, top, box.left); }
    } else if (y < lastY) {
      if (shown) edge = y;
      else if (edge - y >= SHOW_AFTER) { edge = y; setShown(true, top, box.left); }
    }
    setShown(shown, top, box.left);
    lastY = y;
  }

  const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };

  function attach(next) {
    detach(owner);
    owner = next;
    if (!button) button = make();
    if (!button.isConnected) (document.body || document.documentElement).append(button);
    edge = lastY = Math.max(scrollY, 0);
    shown = true;
    setShown(false);
    paintCount();
    addEventListener('scroll', onScroll, {passive: true});
    addEventListener('resize', onScroll, {passive: true});
    return {
      update: () => { if (owner === next) { paintCount(); onScroll(); } },
      detach: () => detach(next),
      button: () => button,
    };
  }

  function detach(which) {
    if (!owner || (which && which !== owner)) return;
    owner = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    removeEventListener('scroll', onScroll);
    removeEventListener('resize', onScroll);
    setShown(false);
    button?.remove();
  }

  globalThis.RTFeedDock = Object.freeze({attach, detach: () => detach(null), _update: update});
})();
