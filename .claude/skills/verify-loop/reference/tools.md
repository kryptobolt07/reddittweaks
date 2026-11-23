# Test tools

Every browser check goes through Playwright. Live Reddit uses the signed-in launcher `scripts/live/browser.mjs`; fixtures use the preview server. There's no CDP of our own: no debugging port, no `connectOverCDP`, no CDP sessions. The only exception is the launcher's `Extensions.loadUnpacked` over Playwright's pipe.

## Levels
| Level | Start | Notes |
|---|---|---|
| L0/L1 | `node --check <file>`, `node --test tests/<name>.test.cjs`, `npm test` | jsdom, synthetic data only. |
| L2 fixture | `npm run preview` (background), then `node scripts/live/browser.mjs run <probe.mjs> --no-load --url http://127.0.0.1:8765/demo/` | Chat demo (`demo/`: full, floating, dark) and profile discovery (`demo/tweaks/`). A throwaway `chromium.launch({executablePath:'/usr/bin/google-chrome-unstable'})` also works for these. |
| L3 live | `npm run package`, then `node scripts/live/browser.mjs run <probe.mjs> --url <reddit url> [--phone]` | Signed-in `.chrome-dev-profile/`, headed on Xvfb `:97`, fresh build loaded every launch. Read-only. One launch at a time. |

## Probe shape
```js
// artifacts/research/verify/<slug>/probe.mjs
export default async ({page, context, extensionId, args}) => {
  await page.waitForTimeout(4000);                     // after --url loaded
  return page.evaluate(() => ({/* measurements */}));  // printed as JSON
};
```
- **Phone:** `--phone` gives 412×915, DPR 2.625, `isMobile`, `hasTouch` and an Android user agent. Reddit serves phone markup by user agent (Open App instead of Log In), so a narrow desktop viewport misses phone-only bugs.
- **Input:** `locator.click()`, `page.mouse.move/down/up` (hover previews need real mouse moves), `page.touchscreen.tap`, `page.keyboard.press`. Use `page.mouse.wheel` or `window.scrollTo` for scrolling.
- **Transitions:** before a click, `page.evaluate` a `requestAnimationFrame` logger that pushes a state string whenever it changes (`window.__log`), click, wait, then read `window.__log`. Compare with the same transition with the feature off; only the differences are defects.
- **Extension pages:** `context.newPage()` → `chrome-extension://${extensionId}/popup.html`; `chrome.storage.local` is available there to read or set this profile's settings for a check (restore them afterwards).
- **Reload mid-session:** `reloadExtension(context, extensionId)` from `browser.mjs` (opens the popup, calls `chrome.runtime.reload()`, waits 1.5 s).
- **Console, network, worker:** `page.on('console')`, `page.on('response')`, `context.serviceWorkers()` (`worker.evaluate` runs in the extension's service worker).
- **Isolated world:** Playwright evaluates in the page's main world. Read extension state through the DOM (`data-rt-*` attributes, `[data-rt-ui]` nodes) or expose it with a debug attribute.

## Measuring components as data (native first)
- **Deep computed-style dump**: walk a root and every open `shadowRoot` beneath it. For each visible element record tag, classes, slot, box (x, y, w, h relative to the root), `display`, `padding`, `margin`, `gap`, `border`, `border-radius`, `background-color`, `color`, font weight/size/line-height, `box-shadow`, `outline` and `transition`. Dedupe repeated subtrees. Save one JSON per state for native and ours, then diff.
- **Markup**: `outerHTML` plus `shadowRoot.innerHTML`, with `data-faceplate-tracking-context`, `<svg>` bodies, `<style>` and comments stripped.
- **Load order**: poll every 100 ms after `page.goto` and record the first time each selector has a non-zero height, for ours and native.
- **Custom element availability**: `page.evaluate(() => Boolean(customElements.get('<tag>')))`.

## Sign-in and limits
- Check sign-in with `(await context.cookies('https://www.reddit.com')).some(c => c.name === 'reddit_session')`. If it's false, tell the user to run `node scripts/live/browser.mjs open --headed-desktop --url https://www.reddit.com/login`. Never type credentials.
- Never get past "Prove your humanity" or 403 pages. About 40 loads in 30 minutes gets HTTP 429: reuse the page and space out loads.
- Strictly read-only: no voting, joining, posting, commenting, saving, reporting or Reddit settings changes.

## Where things go
Probes, captures, timelines and screenshots go in `artifacts/research/verify/<slug>/` and `artifacts/research/shots/` (git-ignored; never commit them). Validation records go in `artifacts/validation-v<version>/validation.json`.

The older CDP relay tools (`relay.mjs`, `cdp.mjs`, `probe-*.mjs`, `fixture-browser.mjs`) stay in `scripts/live/` but are retired; use them only if the user asks.
