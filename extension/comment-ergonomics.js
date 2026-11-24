/* Phase 1 Comment Reading Ergonomics runtime:
   color/CVD threadlines, viewport-clamped Comment Jump (Easy/Pro) & Back-to-Top,
   AutoMod/pinned bot collapse with inline summary, collapse child comments,
   rate-limited auto-load more comments, and enhanced comment composer. */
(() => {
  'use strict';
  if (window.top !== window || globalThis.RTCommentErgonomics) return;

  const Model = globalThis.RTCommentErgonomicsModel;
  const PostModel = globalThis.RTPostModel;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MIN_MORE_INTERVAL_MS = 900;
  const MAX_MORE_LOADS_PER_ROUTE = 25;
  const MAX_DRAFT_CHARS = 40000;
  const MORE_BUTTON_TEXT_RE = /^(?:view\s+more\s+comments|load\s+more\s+comments|\d+\s+more\s+repl(?:y|ies)|continue\s+this\s+thread)$/i;

  function effectiveFromRaw(raw) {
    if (PostModel?.effectiveSettings) return PostModel.effectiveSettings(raw);
    return {
      commentThreadlines: ['off', 'classic', 'muted', 'autumn'].includes(raw?.commentThreadlines) ? raw.commentThreadlines : 'off',
      commentThreadlinesCvd: raw?.commentThreadlinesCvd === true,
      commentJump: ['off', 'easy', 'pro'].includes(raw?.commentJump) ? raw.commentJump : 'off',
      commentJumpSide: raw?.commentJumpSide === 'left' ? 'left' : 'right',
      backToTop: raw?.backToTop === true,
      collapseAutoMod: raw?.collapseAutoMod === true,
      collapseChildComments: raw?.collapseChildComments === true,
      autoLoadMoreComments: raw?.autoLoadMoreComments === true,
      betterComposer: raw?.betterComposer === true
    };
  }

  function svgArrow(doc, d) {
    const svg = (doc || document).createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    const path = (doc || document).createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
    return svg;
  }

  function deepActiveElement(doc) {
    let active = doc?.activeElement || null;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    return active;
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    return Boolean(el.closest?.('shreddit-composer, shreddit-simple-composer, [contenteditable="true"]'));
  }

  function modalOrFullscreenOpen(doc) {
    if (doc.fullscreenElement) return true;
    return Boolean(doc.querySelector('[data-rt-modal-open], dialog[open], rpl-dialog[open], rpl-bottom-sheet[open], shreddit-sheet[open]'));
  }

  function adoptCss(doc, id, cssText) {
    if (globalThis.RTCore?.adoptStyles) return globalThis.RTCore.adoptStyles(doc, id, cssText);
    let el = doc.querySelector(`style[data-rt-sheet="${id}"]`);
    if (!cssText) {
      el?.remove();
      return null;
    }
    if (!el) {
      el = doc.createElement('style');
      el.setAttribute('data-rt-sheet', id);
      (doc.head || doc.documentElement).append(el);
    }
    el.textContent = cssText;
    return el;
  }

  function findComposerField(composer) {
    return composer.querySelector?.('textarea, [contenteditable="true"], [role="textbox"]') ||
      composer.shadowRoot?.querySelector?.('textarea, [contenteditable="true"], [role="textbox"]') ||
      null;
  }

  function findSubmitButton(composer) {
    const sel = 'button[type="submit"]:not(:disabled), [slot="submit-button"] button:not(:disabled), button[slot="submit-button"]:not(:disabled)';
    return composer.querySelector?.(sel) || composer.shadowRoot?.querySelector?.(sel) || null;
  }

  function readFieldText(field) {
    if (!field) return '';
    return typeof field.value === 'string' ? field.value : (field.textContent || '');
  }

  function writeFieldText(win, field, text) {
    if (!field) return;
    if (typeof field.value === 'string') field.value = text;
    else field.textContent = text;
    field.dispatchEvent(new win.Event('input', { bubbles: true }));
  }

  class Controller {
    constructor({ win = window, doc = document, readSettings, observe = true } = {}) {
      this.win = win;
      this.doc = doc;
      this.dead = false;
      this.settings = effectiveFromRaw({});
      this.autoModHandled = new WeakSet();
      this.childHandled = new WeakSet();
      this.composerHandled = new WeakSet();
      this.moreClicked = new WeakSet();
      this.moreWatched = new WeakSet();
      this.moreVisible = new Set();
      this.moreLoadsOnRoute = 0;
      this.lastMoreAt = 0;
      this.moreTimer = 0;
      this.draftTimers = new Map();
      this.pill = null;
      this.unsubs = [];

      this.moreIo = typeof win.IntersectionObserver === 'function'
        ? new win.IntersectionObserver(entries => this.onMoreIntersect(entries), { rootMargin: '250px 0px' })
        : null;

      this.onScroll = () => this.syncPillVisibility();
      this.onFocusChange = () => this.syncPillVisibility();
      this.onKeyDown = event => this.handleShortcut(event);
      this.onRouteChange = () => this.onRoute();
      this.onVisibility = () => { if (!this.doc.hidden) this.pumpMoreLoader(); };

      win.addEventListener('scroll', this.onScroll, { passive: true });
      doc.addEventListener('focusin', this.onFocusChange, true);
      doc.addEventListener('focusout', this.onFocusChange, true);
      doc.addEventListener('fullscreenchange', this.onFocusChange);
      doc.addEventListener('keydown', this.onKeyDown);
      doc.addEventListener('visibilitychange', this.onVisibility);

      if (globalThis.RTCore?.routes && doc === document) {
        this.unsubs.push(globalThis.RTCore.routes.subscribe(this.onRouteChange));
      } else {
        win.addEventListener('popstate', this.onRouteChange);
        doc.addEventListener('reddit:route', this.onRouteChange);
      }

      if (observe) {
        if (globalThis.RTCore?.observer && doc === document) {
          this.unsubs.push(globalThis.RTCore.observer.subscribe(({ added }) => this.scanNodes(added)));
        } else if (typeof win.MutationObserver === 'function') {
          this.mo = new win.MutationObserver(records => {
            const added = [];
            for (const r of records) for (const n of r.addedNodes) if (n.nodeType === 1) added.push(n);
            if (added.length) this.scanNodes(added);
          });
          this.mo.observe(doc.documentElement || doc, { childList: true, subtree: true });
        }
      }

      if (readSettings) {
        this.ready = Promise.resolve(readSettings()).then(s => this.configure(s || {}), () => this.configure({}));
      } else {
        this.ready = Promise.resolve(this.settings);
      }
    }

    configure(raw) {
      if (this.dead) return this.settings;
      const next = effectiveFromRaw(raw || {});
      this.settings = next;
      this.applyThreadlines();
      this.syncPill();
      this.scanDocument();
      return next;
    }

    onRoute() {
      if (this.dead) return;
      this.moreLoadsOnRoute = 0;
      this.lastMoreAt = 0;
      clearTimeout(this.moreTimer);
      this.moreTimer = 0;
      this.moreVisible.clear();
      this.syncPill();
      this.scanDocument();
    }

    applyThreadlines() {
      if (!Model) return;
      const css = Model.buildThreadlineCss(this.settings.commentThreadlines, this.settings.commentThreadlinesCvd);
      adoptCss(this.doc, 'rt-threadlines', css);
    }

    ensurePill() {
      if (this.pill) return this.pill;
      const pill = this.doc.createElement('div');
      pill.className = 'rt-jump-pill';
      pill.dataset.rtUi = 'comment-jump';
      pill.setAttribute('role', 'region');
      pill.setAttribute('aria-label', 'Comment navigation');
      pill.hidden = true;

      const makeBtn = (action, label, title, arrowPath) => {
        const btn = this.doc.createElement('button');
        btn.type = 'button';
        btn.className = 'rt-jump-btn';
        btn.dataset.rtJumpAction = action;
        btn.setAttribute('aria-label', label);
        btn.title = title;
        btn.hidden = true;
        btn.append(svgArrow(this.doc, arrowPath));
        btn.addEventListener('click', () => this.performJump(action));
        return btn;
      };

      const prevSibling = makeBtn('prev-sibling', 'Previous sibling comment', 'Previous sibling comment (Shift+K)', 'M10 15V5M5 9l5-4 5 4M5 4h10');
      const prevRoot = makeBtn('prev-root', 'Previous top-level comment', 'Previous top-level comment (K)', 'M10 15V5M5 10l5-5 5 5');
      const nextRoot = makeBtn('next-root', 'Next top-level comment', 'Next top-level comment (J)', 'M10 5v10M5 10l5 5 5-5');
      const nextSibling = makeBtn('next-sibling', 'Next sibling comment', 'Next sibling comment (Shift+J)', 'M10 5v10M5 11l5 4 5-4M5 16h10');
      const sep = this.doc.createElement('span');
      sep.className = 'rt-jump-sep';
      sep.hidden = true;
      const toTop = makeBtn('top', 'Back to top', 'Back to top', 'M4 4.5h12M10 7.5v9M5.5 12 10 7.5l4.5 4.5');

      pill.append(prevSibling, prevRoot, nextRoot, nextSibling, sep, toTop);
      this.pill = pill;
      this.pillParts = { prevSibling, prevRoot, nextRoot, nextSibling, sep, toTop };
      return pill;
    }

    syncPill() {
      const s = this.settings;
      const isPost = Boolean(Model?.isPostPage(this.win.location.pathname));
      const showJump = isPost && s.commentJump !== 'off';
      const showPro = showJump && s.commentJump === 'pro';
      const wantAny = showJump || s.backToTop;

      if (!wantAny) {
        if (this.pill) this.pill.hidden = true;
        return;
      }
      const pill = this.ensurePill();
      if (!pill.isConnected && this.doc.body) this.doc.body.append(pill);
      pill.dataset.side = s.commentJumpSide === 'left' ? 'left' : 'right';

      const { prevSibling, prevRoot, nextRoot, nextSibling } = this.pillParts;
      prevRoot.hidden = !showJump;
      nextRoot.hidden = !showJump;
      prevSibling.hidden = !showPro;
      nextSibling.hidden = !showPro;
      this.syncPillVisibility();
    }

    syncPillVisibility() {
      if (!this.pill || !this.pillParts) return;
      const s = this.settings;
      const isPost = Boolean(Model?.isPostPage(this.win.location.pathname));
      const showJump = isPost && s.commentJump !== 'off';
      const showTop = s.backToTop && (this.win.scrollY || 0) > 300;
      const { sep, toTop } = this.pillParts;
      toTop.hidden = !showTop;
      sep.hidden = !(showJump && showTop);
      this.pill.hidden = !(showJump || showTop);
      const suppress = isEditable(deepActiveElement(this.doc)) || modalOrFullscreenOpen(this.doc);
      if (suppress) this.pill.setAttribute('data-rt-jump-hidden', 'true');
      else this.pill.removeAttribute('data-rt-jump-hidden');
    }

    headerOffset() {
      const raw = this.win.getComputedStyle?.(this.doc.documentElement)?.getPropertyValue('--rt-visible-header-height');
      const parsed = parseFloat(raw || '');
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 60;
    }

    performJump(action) {
      const reduced = Boolean(this.win.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
      const behavior = reduced ? 'auto' : 'smooth';
      if (action === 'top') {
        this.win.scrollTo?.({ top: 0, behavior });
        return true;
      }
      if (!Model) return false;
      const headerH = this.headerOffset();
      let candidates;
      if (action === 'next-root' || action === 'prev-root') {
        candidates = [...this.doc.querySelectorAll('shreddit-comment[depth="0"]')].filter(
          el => el.isConnected && !el.closest('[data-rt-ui]') && !el.hasAttribute('data-rt-muted')
        );
      } else {
        const all = [...this.doc.querySelectorAll('shreddit-comment')].filter(
          el => el.isConnected && !el.closest('[data-rt-ui]') && !el.hasAttribute('data-rt-muted')
        );
        let anchor = null;
        for (const el of all) {
          if (el.getBoundingClientRect().top <= headerH + 24) anchor = el;
          else break;
        }
        anchor ||= all[0];
        candidates = Model.siblingComments(all, anchor).filter(el => el.getBoundingClientRect().height > 0 || el.hasAttribute('data-rt-skip'));
      }
      const items = candidates.map(el => ({ el, top: el.getBoundingClientRect().top }));
      const dir = action.startsWith('next') ? 1 : -1;
      const target = Model.findJumpTarget(items, headerH, dir, 12);
      if (!target) return false;

      globalThis.RTSmoothScroll?.reveal?.(target);
      const rectTop = target.getBoundingClientRect().top;
      const dest = Math.max(0, (this.win.scrollY || 0) + rectTop - headerH - 8);
      this.win.scrollTo?.({ top: dest, behavior });
      return true;
    }

    handleShortcut(event) {
      if (this.dead || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!Model?.isPostPage(this.win.location.pathname) || this.settings.commentJump === 'off') return;
      if (isEditable(deepActiveElement(this.doc)) || modalOrFullscreenOpen(this.doc)) return;
      const key = String(event.key || '').toLowerCase();
      if (key !== 'j' && key !== 'k') return;
      let action;
      if (event.shiftKey && this.settings.commentJump === 'pro') action = key === 'j' ? 'next-sibling' : 'prev-sibling';
      else if (!event.shiftKey) action = key === 'j' ? 'next-root' : 'prev-root';
      if (!action) return;
      if (this.performJump(action)) event.preventDefault();
    }

    scanDocument() {
      this.scanNodes([this.doc]);
    }

    scanNodes(roots) {
      if (this.dead) return;
      const s = this.settings;
      const checkAutoMod = s.collapseAutoMod;
      const checkChild = s.collapseChildComments && !Model?.isCommentPermalink(this.win.location.pathname, this.win.location.search);
      const checkMore = s.autoLoadMoreComments;
      const checkComposer = s.betterComposer;

      if (!checkAutoMod && !checkChild && !checkMore && !checkComposer) return;

      const permalinkCid = Model?.permalinkCommentId(this.win.location.pathname) || '';
      const collect = (selector) => {
        const out = new Set();
        for (const root of roots) {
          if (!root?.querySelectorAll) continue;
          if (root.matches?.(selector)) out.add(root);
          for (const el of root.querySelectorAll(selector)) out.add(el);
        }
        return out;
      };

      if (checkAutoMod) {
        for (const comment of collect('shreddit-comment[depth="0"]')) this.maybeCollapseAutoMod(comment, permalinkCid);
      }
      if (checkChild) {
        for (const comment of collect('shreddit-comment[depth="1"]')) this.maybeCollapseChild(comment);
      }
      if (checkMore) {
        for (const btn of collect('faceplate-partial[src*="more-comments"] button, shreddit-comment-tree button, button[rpl][aria-label*="more" i]')) {
          this.maybeWatchMoreButton(btn);
        }
      }
      if (checkComposer) {
        for (const comp of collect('shreddit-composer, shreddit-simple-composer')) {
          this.enhanceComposer(comp);
        }
      }
    }

    collapseCommentElement(comment) {
      try { comment.collapsed = true; } catch {}
      comment.setAttribute('collapsed', '');
    }

    maybeCollapseAutoMod(comment, permalinkCid) {
      if (this.autoModHandled.has(comment) || !Model?.isAutoModOrPinnedBot(comment)) return;
      const thingId = String(comment.getAttribute('thingid') || comment.id || '').toLowerCase().replace(/^t1_/, '');
      if (permalinkCid && thingId === permalinkCid) return;

      this.autoModHandled.add(comment);
      const body = comment.querySelector('[slot="comment"], [slot="comment-body"], .md, p');
      const snippet = Model.previewSnippet(body?.textContent || '', 60);
      this.collapseCommentElement(comment);

      if (snippet && !comment.querySelector('[data-rt-automod-preview]')) {
        const span = this.doc.createElement('span');
        span.className = 'rt-automod-preview';
        span.setAttribute('data-rt-automod-preview', '');
        span.textContent = '“' + snippet + '”';
        const meta = comment.querySelector('[slot="commentMeta"], [slot="comment-header"]');
        if (meta) meta.append(span);
        else if (body) body.before(span);
        comment.addEventListener('click', () => {
          setTimeout(() => {
            if (!comment.hasAttribute('collapsed')) span.remove();
          }, 0);
        });
      }
    }

    maybeCollapseChild(comment) {
      if (this.childHandled.has(comment)) return;
      this.childHandled.add(comment);
      this.collapseCommentElement(comment);
    }

    isMoreButton(btn) {
      if (!btn || btn.disabled || btn.closest?.('[data-rt-ui]')) return false;
      if (btn.closest?.('faceplate-partial[src*="more-comments"]')) return true;
      const text = (btn.getAttribute('aria-label') || btn.textContent || '').replace(/\s+/g, ' ').trim();
      return MORE_BUTTON_TEXT_RE.test(text);
    }

    isAllowedMoreButton(btn) {
      if (!this.isMoreButton(btn) || !btn.isConnected || this.moreClicked.has(btn)) return false;
      if (this.settings.collapseChildComments) {
        const insideComment = Boolean(btn.closest?.('shreddit-comment'));
        const partialSrc = btn.closest?.('faceplate-partial[src*="more-comments"]')?.getAttribute('src') || '';
        const isTop = /(?:^|[?&])top-level=1(?:&|$)/.test(partialSrc);
        if (insideComment && !isTop) return false;
      }
      return true;
    }

    maybeWatchMoreButton(btn) {
      if (this.moreWatched.has(btn) || !this.isMoreButton(btn)) return;
      this.moreWatched.add(btn);
      if (this.moreIo) this.moreIo.observe(btn);
      else {
        this.moreVisible.add(btn);
        this.pumpMoreLoader();
      }
    }

    onMoreIntersect(entries) {
      for (const entry of entries) {
        if (entry.isIntersecting) this.moreVisible.add(entry.target);
        else this.moreVisible.delete(entry.target);
      }
      this.pumpMoreLoader();
    }

    pumpMoreLoader() {
      if (this.dead || !this.settings.autoLoadMoreComments || this.doc.hidden) return;
      if (this.moreLoadsOnRoute >= MAX_MORE_LOADS_PER_ROUTE) return;

      let candidate = null;
      for (const btn of this.moreVisible) {
        if (!btn.isConnected) { this.moreVisible.delete(btn); continue; }
        if (this.isAllowedMoreButton(btn)) { candidate = btn; break; }
      }
      if (!candidate) return;

      const now = Date.now();
      const elapsed = now - this.lastMoreAt;
      if (this.lastMoreAt > 0 && elapsed < MIN_MORE_INTERVAL_MS) {
        if (!this.moreTimer) {
          this.moreTimer = this.win.setTimeout(() => {
            this.moreTimer = 0;
            this.pumpMoreLoader();
          }, MIN_MORE_INTERVAL_MS - elapsed);
        }
        return;
      }

      this.moreVisible.delete(candidate);
      this.moreClicked.add(candidate);
      this.moreLoadsOnRoute++;
      this.lastMoreAt = now;
      candidate.click();

      if (this.moreVisible.size && !this.moreTimer) {
        this.moreTimer = this.win.setTimeout(() => {
          this.moreTimer = 0;
          this.pumpMoreLoader();
        }, MIN_MORE_INTERVAL_MS);
      }
    }

    enhanceComposer(composer) {
      if (this.composerHandled.has(composer)) return;
      this.composerHandled.add(composer);

      const openToolbar = () => {
        const toggle = composer.querySelector?.('button[aria-label*="formatting" i][aria-expanded="false"], button[aria-label*="show formatting" i]') ||
          composer.shadowRoot?.querySelector?.('button[aria-label*="formatting" i][aria-expanded="false"], button[aria-label*="show formatting" i]');
        if (toggle && !toggle.disabled) toggle.click();
      };
      openToolbar();

      const key = (!composer.closest?.('shreddit-comment') && Model?.draftKey(this.win.location.pathname)) || '';
      const field = findComposerField(composer);
      if (key && field) {
        try {
          const saved = this.win.sessionStorage?.getItem(key);
          if (saved && !readFieldText(field)) writeFieldText(this.win, field, saved);
        } catch {}

        const saveDraft = () => {
          const prev = this.draftTimers.get(composer);
          if (prev) clearTimeout(prev);
          this.draftTimers.set(composer, this.win.setTimeout(() => {
            this.draftTimers.delete(composer);
            const activeField = findComposerField(composer);
            const text = readFieldText(activeField).slice(0, MAX_DRAFT_CHARS);
            try {
              if (text) this.win.sessionStorage?.setItem(key, text);
              else this.win.sessionStorage?.removeItem(key);
            } catch {}
          }, 300));
        };
        composer.addEventListener('input', saveDraft, true);
        composer.shadowRoot?.addEventListener('input', saveDraft, true);
      }

      const clearDraft = () => {
        if (!key) return;
        const t = this.draftTimers.get(composer);
        if (t) { clearTimeout(t); this.draftTimers.delete(composer); }
        try { this.win.sessionStorage?.removeItem(key); } catch {}
      };

      const onSubmitHotkey = event => {
        if (!this.settings.betterComposer) return;
        if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key !== 'Enter') return;
        const submit = findSubmitButton(composer);
        if (!submit) return;
        event.preventDefault();
        event.stopPropagation();
        clearDraft();
        submit.click();
      };
      composer.addEventListener('keydown', onSubmitHotkey, true);
      composer.shadowRoot?.addEventListener('keydown', onSubmitHotkey, true);

      composer.addEventListener('submit', clearDraft, true);
      composer.addEventListener('click', event => {
        const submit = event.target?.closest?.('button[type="submit"], button[slot="submit-button"], [slot="submit-button"] button');
        if (submit && !submit.disabled) clearDraft();
      }, true);
    }

    destroy() {
      this.dead = true;
      for (const unsub of this.unsubs.splice(0)) unsub();
      this.mo?.disconnect();
      this.moreIo?.disconnect();
      clearTimeout(this.moreTimer);
      for (const t of this.draftTimers.values()) clearTimeout(t);
      this.draftTimers.clear();
      this.win.removeEventListener('scroll', this.onScroll);
      this.doc.removeEventListener('focusin', this.onFocusChange, true);
      this.doc.removeEventListener('focusout', this.onFocusChange, true);
      this.doc.removeEventListener('fullscreenchange', this.onFocusChange);
      this.doc.removeEventListener('keydown', this.onKeyDown);
      this.doc.removeEventListener('visibilitychange', this.onVisibility);
      if (!globalThis.RTCore?.routes || this.doc !== document) {
        this.win.removeEventListener('popstate', this.onRouteChange);
        this.doc.removeEventListener('reddit:route', this.onRouteChange);
      }
      this.pill?.remove();
      adoptCss(this.doc, 'rt-threadlines', '');
    }
  }

  globalThis.RTCommentErgonomics = Object.freeze({ Controller });

  if (!globalThis.__rtCommentErgonomicsTest) {
    if (globalThis.RTCore?.settings) {
      const sync = globalThis.RTCore.settings.readSync();
      const ctrl = new Controller({ readSettings: async () => await globalThis.RTCore.settings.get() || sync || {} });
      if (sync) ctrl.configure(sync);
      globalThis.RTCore.settings.subscribe((s, meta) => { if (!meta?.sync && s) ctrl.configure(s); });
    } else if (globalThis.chrome?.runtime?.id) {
      const read = async () => {
        try {
          const r = await chrome.runtime.sendMessage({ scope: 'rt-posts', action: 'get-settings' });
          return r?.ok ? r.settings : {};
        } catch { return {}; }
      };
      const ctrl = new Controller({ readSettings: read });
      chrome.runtime.onMessage?.addListener((message, sender) => {
        if (message?.scope === 'rt-posts' && message.action === 'settings-changed' && (!sender?.id || sender.id === chrome.runtime.id)) {
          ctrl.configure(message.settings);
        }
      });
    }
  }
})();
