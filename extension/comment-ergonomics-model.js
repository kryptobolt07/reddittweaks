/* Pure model and selectors for Reddit Tweaks Phase 1 comment reading ergonomics. */
(() => {
  'use strict';
  if (globalThis.RTCommentErgonomicsModel) return;

  const PALETTES = Object.freeze({
    classic: Object.freeze(['#ff4500', '#0079d3', '#46d160', '#ffb000', '#9494ff', '#ff66ac', '#0dd3bb', '#ea0027']),
    muted: Object.freeze(['#d96b43', '#4c88c4', '#58a86b', '#c99a3c', '#8b7ec8', '#c46c92', '#4aa3a3', '#b85c5c']),
    autumn: Object.freeze(['#c8553d', '#e08e45', '#d9a441', '#7d8c4d', '#588b8b', '#9c6644', '#b56576', '#6d597a']),
    // Okabe-Ito color-vision-safe palette
    cvd: Object.freeze(['#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#999999'])
  });

  function buildThreadlineCss(theme, cvd = false) {
    if (!theme || theme === 'off' || !Object.hasOwn(PALETTES, theme)) return '';
    const palette = cvd === true ? PALETTES.cvd : PALETTES[theme];
    const rules = [];
    for (let depth = 0; depth < 16; depth++) {
      const color = palette[depth % palette.length];
      rules.push(`shreddit-comment[depth="${depth}"]{--color-tone-4:${color};--rt-threadline-color:${color};}`);
    }
    return rules.join('\n');
  }

  const POST_PATH_RE = /^\/(?:(?:r|u|user)\/[^/]+\/)?comments\/([a-z0-9]{1,10})(?:\/|$)/i;
  const COMMENT_PERMALINK_RE = /^\/(?:(?:r|u|user)\/[^/]+\/)?comments\/([a-z0-9]{1,10})\/(?:comment\/([a-z0-9]{1,32})|[^/]+\/([a-z0-9]{1,32}))\/?$/i;

  function isPostPage(pathname) {
    return POST_PATH_RE.test(String(pathname || ''));
  }

  function postIdOf(pathname) {
    return POST_PATH_RE.exec(String(pathname || ''))?.[1]?.toLowerCase() || '';
  }

  function permalinkCommentId(pathname) {
    const m = COMMENT_PERMALINK_RE.exec(String(pathname || ''));
    return (m?.[2] || m?.[3] || '').toLowerCase();
  }

  function isCommentPermalink(pathname, search = '') {
    if (!isPostPage(pathname)) return false;
    if (COMMENT_PERMALINK_RE.test(String(pathname || ''))) return true;
    try {
      const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
      return params.has('context');
    } catch {
      return false;
    }
  }

  function draftKey(pathname) {
    const id = postIdOf(pathname);
    return id ? 'rt-comment-draft:' + id : '';
  }

  function isAutoModOrPinnedBot(commentEl) {
    if (!commentEl || commentEl.nodeType !== 1) return false;
    if (commentEl.getAttribute('depth') !== '0') return false;
    const author = (commentEl.getAttribute('author') || '').trim();
    if (!author) return false;
    if (/^automoderator$/i.test(author)) return true;
    const isPinned = commentEl.hasAttribute('is-pinned') ||
      commentEl.hasAttribute('stickied') ||
      commentEl.hasAttribute('pinned') ||
      Boolean(commentEl.querySelector?.('[slot="commentMeta"] [icon-name*="pin" i], [data-testid="pinned-label"], [aria-label*="pinned" i]'));
    if (!isPinned) return false;
    return /(?:bot|automod)$/i.test(author) || Boolean(commentEl.querySelector?.('[data-testid*="bot" i]'));
  }

  function previewSnippet(text, maxLen = 60) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    if (clean.length <= maxLen) return clean;
    return clean.slice(0, Math.max(1, maxLen - 1)).trimEnd() + '…';
  }

  function findJumpTarget(items, currentY, direction, offset = 12) {
    if (!Array.isArray(items) || !items.length || !direction) return null;
    if (direction > 0) {
      for (const item of items) {
        if (Number(item?.top) > currentY + offset) return item.el || null;
      }
      return null;
    }
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i];
      if (Number(item?.top) < currentY - offset) return item.el || null;
    }
    return null;
  }

  function siblingComments(allComments, currentEl) {
    if (!Array.isArray(allComments) || !currentEl) return [];
    const depth = currentEl.getAttribute?.('depth') ?? '0';
    const parent = currentEl.parentElement?.closest?.('shreddit-comment') || null;
    return allComments.filter(el =>
      (el.getAttribute?.('depth') ?? '0') === depth &&
      (el.parentElement?.closest?.('shreddit-comment') || null) === parent
    );
  }

  globalThis.RTCommentErgonomicsModel = Object.freeze({
    PALETTES,
    buildThreadlineCss,
    isPostPage,
    postIdOf,
    permalinkCommentId,
    isCommentPermalink,
    draftKey,
    isAutoModOrPinnedBot,
    previewSnippet,
    findJumpTarget,
    siblingComments
  });
})();
