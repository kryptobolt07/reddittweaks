/* Keep mobile visitors on the web when Reddit presents an app promotion. */
(() => {
  'use strict';
  const mobile = /\b(?:Android|iOS|iPhone|iPad|iPod)\b/i;
  if (window.top !== window || !(mobile.test(navigator.userAgentData?.platform) || mobile.test(navigator.userAgent))) return;

  const APP_ONLY = 'configured-xpromo-modal > rpl-dialog[dialog-id="configured-xpromo-blocking_xpromo_nsfw_blocking"][blocking], configured-xpromo-modal > rpl-dialog[dialog-id*="unreviewed" i][blocking]';
  const PAGE_FADE = '.configured-xpromo-bottom-sheet';
  const APP_LINK = 'a.app-link[href], a[href*="reddit.onelink.me"]';
  const POST_PROMO = 'xpromo-nsfw-blocking-container';
  const POST_MEDIA = '[slot="post-media-container"]';
  const HIDE_POST_PROMO = 'data-rt-hide-post-app-prompt';
  const SHEET = 'configured-xpromo-modal rpl-dialog[open], xpromo-bottom-sheet, shreddit-xpromo-bottom-sheet, shreddit-async-loader[bundlename*="xpromo" i], [data-testid*="xpromo" i]';
  const DIALOG = 'rpl-dialog[open], rpl-dialog[blocking], dialog[open], [role="dialog"], [aria-modal="true"]';
  const MEDIA = 'shreddit-blurred-container[reason="nsfw"][blurred], [data-rt-nsfw-media]';
  const CANDIDATE = [APP_ONLY, PAGE_FADE, POST_PROMO, SHEET, DIALOG, MEDIA].join(', ');
  const HEADING = 'h1, h2, h3, h4, [role="heading"], [slot="title"], [slot="heading"]';
  const TITLE = /^(?:open in (?:the )?(?:reddit )?app|see (?:this post|this community|reddit) in (?:the )?(?:reddit )?app|(?:the )?reddit app|reddit is better in the app)$/i;
  const UNREVIEWED_TITLE = /^unreviewed content$/i;
  const APP = /^(?:open|use|view)(?: (?:in|the))?(?: (?:the )?(?:reddit )?app| reddit)?$/i;
  const WEB = /^(?:continue|view|stay|open) (?:in|on|with) (?:the |your )?(?:web(?: browser)?|browser|chrome|firefox|reddit\.com)$/i;
  const GO_HOME = /^(?:no,?\s*)?(?:take me (?:to )?home|go home)$/i;
  const BROWSER = /^(?:google chrome|chrome|firefox|samsung internet|web browser|browser)$/i;
  const BUTTON = 'button, [role="button"], a[href]';
  const handled = new WeakSet();
  const observed = new WeakSet();
  const pendingPromotions = new WeakSet();
  let hideMatureOverlay;
  let revealNsfwPostMedia = false;

  function normalized(value) {
    return (value || '').replace(/[\s\u00a0]+/g, ' ').trim().replace(/[.!?]+$/, '');
  }

  function label(node) {
    return normalized(node.getAttribute('aria-label') || node.textContent);
  }

  function visible(node) {
    if (node.checkVisibility?.({checkVisibilityCSS:true}) === false) return false;
    for (let element = node; element; element = element.parentElement || element.getRootNode().host) {
      if (element.hidden || element.getAttribute('aria-hidden') === 'true' || element.inert) return false;
      if (element.localName === 'dialog' && !element.open) return false;
    }
    const style = getComputedStyle(node);
    return style.visibility !== 'hidden' && style.display !== 'none';
  }

  function browserRow(action) {
    const row = action.closest('li, [role="listitem"]') || action.parentElement;
    return [...row?.querySelectorAll('[aria-label], span, p, strong, img[alt]') || []].some(node =>
      node !== action && !action.contains(node) && BROWSER.test(node.getAttribute('alt') || label(node)));
  }

  function safeAction(action) {
    if (action.disabled || action.getAttribute('aria-disabled') === 'true' || !visible(action)) return false;
    if (!action.matches('a[href]')) return true;
    return action.href === location.href && (!action.target || action.target === '_self') && !action.hasAttribute('download');
  }

  function isOpenedPost(node) {
    const id = /^\/(?:(?:r|user|u)\/[^/]+\/)?comments\/([a-z0-9]+)(?:\/|$)/i.exec(location.pathname)?.[1];
    return Boolean(id && node.closest('main shreddit-post')?.id === 't3_' + id);
  }

  function updatePostPromotion(promo) {
    const hide = hideMatureOverlay === true && isOpenedPost(promo) && promo.closest(POST_MEDIA) &&
      promo.querySelector('shreddit-blurred-container[reason="nsfw"] > [slot="revealed"]');
    promo.toggleAttribute(HIDE_POST_PROMO, Boolean(hide));
    if (!hide) return;
    const root = promo.shadowRoot;
    if (!root) {
      // Upgrading a custom element can attach its shadow without a light-DOM mutation.
      if (pendingPromotions.has(promo)) return;
      pendingPromotions.add(promo);
      let checks = 0;
      const waitForShadow = () => {
        if (promo.isConnected && promo.hasAttribute(HIDE_POST_PROMO) && !promo.shadowRoot && ++checks < 20) {
          setTimeout(waitForShadow, 150);
          return;
        }
        pendingPromotions.delete(promo);
        if (promo.isConnected && promo.shadowRoot) updatePostPromotion(promo);
      };
      setTimeout(waitForShadow, 150);
      return;
    }
    if (root.querySelector('style[' + HIDE_POST_PROMO + ']')) return;
    const style = document.createElement('style');
    style.setAttribute(HIDE_POST_PROMO, '');
    style.textContent = ':host([' + HIDE_POST_PROMO + ']) .prompt:has(slot[name="view-in-app-button"]) { display:none!important; }';
    root.append(style);
  }

  function visibleSheet() {
    return [...document.querySelectorAll('rpl-dialog[open], dialog[open], rpl-bottom-sheet[open], shreddit-sheet[open], faceplate-modal[open], [data-rt-modal-open], [aria-modal="true"]')]
      .some(node => {
        const style = getComputedStyle(node);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
  }

  function removePromo(node) {
    node.remove();
    if (document.body.classList.contains('rpl-scroll-lock') && !visibleSheet()) document.body.classList.remove('rpl-scroll-lock');
  }

  function revealPostMedia(gate) {
    const promo = gate.parentElement;
    if (promo?.matches(POST_PROMO)) updatePostPromotion(promo);
    if (!revealNsfwPostMedia || !isOpenedPost(gate) || !gate.closest(POST_MEDIA + ', [slot="text-body"]')) return;
    if (gate.shadowRoot) observe(gate.shadowRoot);
    const button = gate.matches('shreddit-blurred-container') ? gate.shadowRoot?.querySelector('button') : gate.querySelector('.rt-sensitive-reveal');
    if (!button || handled.has(button) || button.form || !safeAction(button)) return;
    // Reddit can reapply the blur during hydration and render a fresh control.
    handled.add(button);
    button.click();
  }

  function inspect(dialog) {
    if (handled.has(dialog) || !dialog.isConnected) return;
    if (dialog.matches(APP_ONLY)) {
      // Disconnect the promotion owner before its asynchronous showModal can mount the blocking dialog.
      if (hideMatureOverlay === true) removePromo(dialog.parentElement);
      return;
    }
    if (dialog.matches(PAGE_FADE)) {
      if (hideMatureOverlay === true && dialog.querySelector(APP_LINK)) removePromo(dialog);
      return;
    }
    if (dialog.matches(POST_PROMO)) {
      updatePostPromotion(dialog);
      return;
    }
    if (dialog.matches(MEDIA)) {
      revealPostMedia(dialog);
      return;
    }
    if (hideMatureOverlay !== true) return;
    if (dialog.shadowRoot) observe(dialog.shadowRoot);
    const roots = dialog.shadowRoot ? [dialog, dialog.shadowRoot] : [dialog];
    const allRoots = [...roots];
    for (const root of roots) {
      for (const tpl of root.querySelectorAll('template')) if (tpl.content) allRoots.push(tpl.content);
    }
    const title = normalized(dialog.getAttribute('aria-label'));
    const allHeadings = allRoots.flatMap(root => [...root.querySelectorAll(HEADING)]);
    const allButtons = allRoots.flatMap(root => [...root.querySelectorAll(BUTTON)]);
    if ((UNREVIEWED_TITLE.test(title) || allHeadings.some(node => UNREVIEWED_TITLE.test(label(node)))) &&
      allButtons.some(button => APP.test(label(button)) && !WEB.test(label(button))) &&
      !allButtons.some(button => WEB.test(label(button))) &&
      (dialog.hasAttribute('blocking') || allButtons.some(button => GO_HOME.test(label(button))) || allRoots.some(root => root.querySelector(APP_LINK)))) {
      handled.add(dialog);
      const owner = dialog.closest('configured-xpromo-modal') ||
        (dialog.parentElement?.matches('shreddit-async-loader[bundlename*="xpromo" i]') ? dialog.parentElement : dialog);
      removePromo(owner);
      return;
    }
    const headings = roots.flatMap(root => [...root.querySelectorAll(HEADING)]);
    if (!TITLE.test(title) && !headings.some(node => TITLE.test(label(node)))) return;
    const buttons = roots.flatMap(root => [...root.querySelectorAll(BUTTON)]);
    if (!buttons.some(button => APP.test(label(button)) && !WEB.test(label(button)))) return;
    const browser = buttons.find(button => safeAction(button) &&
      (WEB.test(label(button)) || (/^continue$/i.test(label(button)) && browserRow(button))));
    if (!browser || handled.has(browser) || !visible(dialog)) return;
    handled.add(dialog);
    handled.add(browser);
    browser.click();
  }

  function scan(root) {
    if (root.matches?.(CANDIDATE)) inspect(root);
    for (const dialog of root.querySelectorAll?.(CANDIDATE) || []) inspect(dialog);
  }

  const observer = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
      const root = record.target.getRootNode();
      const dialog = target?.closest(CANDIDATE) || root.host?.closest?.(CANDIDATE);
      if (dialog) inspect(dialog);
      for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    }
  });

  function observe(root) {
    if (observed.has(root)) return;
    observed.add(root);
    observer.observe(root, {subtree:true, childList:true, characterData:true, attributes:true,
      attributeFilter:['open', 'blocking', 'dialog-id', 'blurred', 'reason', 'role', 'aria-modal', 'aria-label', 'aria-hidden', 'hidden', 'disabled', 'aria-disabled', 'data-testid', 'bundlename']});
    scan(root);
  }

  observe(document);
  window.addEventListener('pageshow', () => scan(document));
  const revealCurrentPost = () => {
    if (revealNsfwPostMedia) for (const gate of document.querySelectorAll(MEDIA)) inspect(gate);
  };
  const refreshPostPromotions = () => {
    for (const promo of document.querySelectorAll(POST_PROMO)) inspect(promo);
  };
  const refreshPost = () => {
    refreshPostPromotions();
    revealCurrentPost();
  };
  document.addEventListener('reddit:route', refreshPost);
  window.addEventListener('popstate', refreshPost);

  function applyPreferences(settings) {
    const enabled = settings?.hideMatureOverlay !== false;
    const changed = hideMatureOverlay !== enabled;
    hideMatureOverlay = enabled;
    if (changed) {
      if (enabled) for (const dialog of document.querySelectorAll(APP_ONLY + ', ' + PAGE_FADE + ', ' + SHEET + ', ' + DIALOG)) inspect(dialog);
      refreshPostPromotions();
    }
    const reveal = settings?.revealNsfwPostMedia === true;
    if (revealNsfwPostMedia === reveal) return;
    revealNsfwPostMedia = reveal;
    revealCurrentPost();
  }
  const runtime = (globalThis.browser || globalThis.chrome)?.runtime;
  if (globalThis.RTCore?.settings) {
    globalThis.RTCore.settings.subscribe(settings => applyPreferences(settings));
    return;
  }
  if (!runtime?.id) return;
  runtime.onMessage.addListener((message, sender) => {
    if (sender?.id === runtime.id && message?.scope === 'rt-posts' && message.action === 'settings-changed') {
      applyPreferences(message.settings);
    }
  });
  // The worker owns local storage. Reuse the document-start settings request when present.
  Promise.resolve().then(() => globalThis.RTProfileNoticeGuard?.settings ||
    runtime.sendMessage({scope:'rt-posts', action:'get-settings'})).then(response => {
    if (hideMatureOverlay === undefined && response?.ok) applyPreferences(response.settings);
  }, () => {});
})();
