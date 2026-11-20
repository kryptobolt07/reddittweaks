/* Keep mobile visitors on the web when Reddit presents an app promotion. */
(() => {
  'use strict';
  const mobile = /\b(?:Android|iOS|iPhone|iPad|iPod)\b/i;
  if (window.top !== window || !(mobile.test(navigator.userAgentData?.platform) || mobile.test(navigator.userAgent))) return;

  const APP_ONLY = 'configured-xpromo-modal > rpl-dialog[dialog-id="configured-xpromo-blocking_xpromo_nsfw_blocking"][blocking]';
  const SHEET = 'configured-xpromo-modal rpl-dialog[open], xpromo-bottom-sheet, shreddit-xpromo-bottom-sheet, shreddit-async-loader[bundlename*="xpromo" i], [data-testid*="xpromo" i]';
  const DIALOG = 'dialog[open], [role="dialog"], [aria-modal="true"]';
  const MEDIA = 'shreddit-blurred-container[reason="nsfw"][blurred], [data-rt-nsfw-media]';
  const CANDIDATE = [APP_ONLY, SHEET, DIALOG, MEDIA].join(', ');
  const HEADING = 'h1, h2, h3, h4, [role="heading"], [slot="title"], [slot="heading"]';
  const TITLE = /^(?:open in (?:the )?(?:reddit )?app|see (?:this post|this community|reddit) in (?:the )?(?:reddit )?app|(?:the )?reddit app|reddit is better in the app)$/i;
  const APP = /^(?:open|use|view)(?: (?:in|the))?(?: (?:the )?(?:reddit )?app| reddit)?$/i;
  const WEB = /^(?:continue|view|stay|open) (?:in|on|with) (?:the |your )?(?:web(?: browser)?|browser|chrome|firefox|reddit\.com)$/i;
  const BROWSER = /^(?:google chrome|chrome|firefox|samsung internet|web browser|browser)$/i;
  const BUTTON = 'button, [role="button"], a[href]';
  const handled = new WeakSet();
  const observed = new WeakSet();
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

  function revealPostMedia(gate) {
    if (!revealNsfwPostMedia) return;
    const id = /^\/(?:(?:r|user|u)\/[^/]+\/)?comments\/([a-z0-9]+)(?:\/|$)/i.exec(location.pathname)?.[1];
    if (!id || gate.closest('main shreddit-post')?.id !== 't3_' + id || !gate.closest('[slot="post-media-container"], [slot="text-body"]')) return;
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
      if (hideMatureOverlay === true) dialog.parentElement.remove();
      return;
    }
    if (dialog.matches(MEDIA)) {
      revealPostMedia(dialog);
      return;
    }
    if (dialog.shadowRoot) observe(dialog.shadowRoot);
    const roots = dialog.shadowRoot ? [dialog, dialog.shadowRoot] : [dialog];
    const title = normalized(dialog.getAttribute('aria-label'));
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
  document.addEventListener('reddit:route', revealCurrentPost);
  window.addEventListener('popstate', revealCurrentPost);

  function applyPreferences(settings) {
    const enabled = settings?.hideMatureOverlay !== false;
    const changed = hideMatureOverlay !== enabled;
    hideMatureOverlay = enabled;
    if (changed && enabled) for (const dialog of document.querySelectorAll(APP_ONLY)) inspect(dialog);
    const reveal = settings?.revealNsfwPostMedia === true;
    if (revealNsfwPostMedia === reveal) return;
    revealNsfwPostMedia = reveal;
    revealCurrentPost();
  }
  const runtime = (globalThis.browser || globalThis.chrome)?.runtime;
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
