/* Use Reddit's web continuation for its Android app-promotion dialog. */
(() => {
  'use strict';
  const android = /\bAndroid\b/i;
  if (window.top !== window || !(android.test(navigator.userAgentData?.platform) || android.test(navigator.userAgent))) return;

  const SHEET = 'configured-xpromo-modal rpl-dialog[open], xpromo-bottom-sheet, shreddit-xpromo-bottom-sheet, shreddit-async-loader[bundlename*="xpromo" i], [data-testid*="xpromo" i]';
  const DIALOG = 'dialog[open], [role="dialog"], [aria-modal="true"]';
  const CANDIDATE = SHEET + ', ' + DIALOG;
  const HEADING = 'h1, h2, h3, h4, [role="heading"], [slot="title"], [slot="heading"]';
  const TITLE = /^(?:open in (?:the )?(?:reddit )?app|see (?:this post|this community|reddit) in (?:the )?(?:reddit )?app|(?:the )?reddit app|reddit is better in the app)$/i;
  const APP = /^(?:open|use|view)(?: (?:in|the))?(?: (?:the )?(?:reddit )?app| reddit)?$/i;
  const WEB = /^(?:continue|view|stay|open) (?:in|on|with) (?:the |your )?(?:web(?: browser)?|browser|chrome|firefox|reddit\.com)$/i;
  const BROWSER = /^(?:google chrome|chrome|firefox|samsung internet|web browser|browser)$/i;
  const BUTTON = 'button, [role="button"], a[href]';
  const handled = new WeakSet();
  const observed = new WeakSet();

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

  function inspect(dialog) {
    if (handled.has(dialog) || !dialog.isConnected) return;
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
      const dialog = target?.closest(CANDIDATE) || target?.getRootNode().host?.closest(CANDIDATE);
      if (dialog) inspect(dialog);
      for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) scan(node);
    }
  });

  function observe(root) {
    if (observed.has(root)) return;
    observed.add(root);
    observer.observe(root, {subtree:true, childList:true, characterData:true, attributes:true,
      attributeFilter:['open', 'role', 'aria-modal', 'aria-label', 'aria-hidden', 'hidden', 'disabled', 'aria-disabled', 'data-testid', 'bundlename']});
    scan(root);
  }

  observe(document);
  window.addEventListener('pageshow', () => scan(document));
})();
