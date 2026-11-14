# Test tools (scripts/live/)

All browser tools talk to a relay. `RELAY_PORT=9334` is the headless fixture browser (L2); unset or `9333` is the user's signed-in Chrome (L3). In zsh, define `c(){ node scripts/live/cdp.mjs "$@"; }` and run everything from the repo root.

## Browsers
| Level | Start | Notes |
|---|---|---|
| L2 fixture | `node scripts/live/fixture-browser.mjs` (background). Wait for `fixture ready`. | Headless Chrome with a throwaway profile, demo preview on 127.0.0.1:8765, relay 9334. No approval prompt, and background throttling is off. Stop it with TaskStop; that also deletes the profile. |
| L2 + extension | `node scripts/live/fixture-browser.mjs --extension` (after `npm run package`) | Loads `artifacts/reddit-chat-search/` into Playwright's Chromium. Useful for the popup, service worker and storage. Content scripts only match reddit.com, and **real Reddit serves a bot check to headless browsers. Never try to get around it.** |
| L3 live | `node scripts/live/relay.mjs` (background). The user approves Chrome's remote-debugging prompt. | Signed-in Chrome, read-only. Open your own tab, never touch others, close it when done. |

## Tab setup (any level)
```
T=$(c raw Target.createTarget '{"url":"about:blank"}' | grep -o '[A-F0-9]\{32\}')
S=$(c attach $T | cut -d' ' -f1)
c raw Emulation.setDeviceMetricsOverride '{"width":1280,"height":800,"deviceScaleFactor":1,"mobile":false}' $S
c raw Log.enable '{}' $S; c raw Runtime.enable '{}' $S
c nav $S <url>          # direct load. User-like navigation is a click (probe-timeline click:)
c raw Target.closeTarget "{\"targetId\":\"$T\"}"   # always, at the end
```
At L3, also run `c raw Page.bringToFront '{}' $S` **and** `c raw Emulation.setFocusEmulationEnabled '{"enabled":true}' $S`. When the user's Chrome window isn't focused, Reddit's lazy partials can stay empty (for example, a left nav with 0 links) and synthetic mouse input may not arrive, even though `visibilityState` says `visible`. `probe-timeline` then falls back to `element.click()` and says so. Check `document.visibilityState==='visible'` before claiming something "did not load".

## Parallel agents at L3 (one window per agent)
Several agents can share the signed-in Chrome with one window each. What breaks pages is **focus and visibility**, not the window layout. Measured on this machine (2026-11-04): fully or partly covered windows kept rendering at 60 frames/s. Unfocused pages, though, left Reddit's lazy content (for example the left nav) empty until focus emulation was on. Background tabs are always hidden and paused.
1. Create one window per agent: `c raw Target.createTarget '{"url":"about:blank","newWindow":true}'`. Full-size windows are fine. Optionally size them with `Browser.getWindowForTarget` → `windowId` and `Browser.setWindowBounds` (`{"windowState":"normal"}`, then bounds).
2. In each tab, run `Emulation.setFocusEmulationEnabled {"enabled":true}` and `Emulation.setDeviceMetricsOverride` 1280×800. If a window is narrower than 1280px, add `"scale": windowWidth/1280` so the user sees the whole page shrunk instead of cropped. Layout, measurements and screenshots stay at 1280×800.
3. Check each window before handing it over: count `requestAnimationFrame` frames for 1 s (expect >30) and confirm `visibilityState==='visible'`. If any window stalls (for example on another OS or window manager), tile them so none is covered, or run sequentially.
4. Give each agent its own `targetId`, and forbid it from creating tabs, calling `bringToFront`, or moving or resizing windows. Only the focused window gets raw mouse input, so agents click with `element.click()` (probe-timeline falls back automatically).
5. Cap at 2–3 agents (Arctic Shift rate limits). Afterwards, restore the user's window (`{"windowState":"maximized"}`).

## Probes
| Tool | Use it for | Command |
|---|---|---|
| probe-inventory | Visual parity as data: every visible component with position, size, font, weight, colour, image state and control state. Run it on the native region and on ours, then diff. | `node scripts/live/probe-inventory.mjs $S '<root>' [--max 80] [--nth 0]` |
| probe-ui | Standing checks for one region: overflow, clipped text, targets under 24px, covered controls, contrast, tab order and focus ring, console errors | `node scripts/live/probe-ui.mjs $S '<root>' --tab 12 --console` |
| probe-timeline | Timing and transition bugs: flashes, blanks, element replacement, layout shifts across clicks, back, reload, nav | `node scripts/live/probe-timeline.mjs $S --regions 'nav=.left-sidebar ; main=main' --steps 'wait:1500 ; click:<sel> ; wait:4000 ; back ; wait:3000'` |
| probe-shot | Clipped screenshot that also finds elements inside shadow roots | `node scripts/live/probe-shot.mjs $S out.png '<top>' ['<bottom>' --index 2]` |
| probe-pngdiff | Before/after pixel diff. `outsideMask>0` means something changed outside the intended area | `node scripts/live/probe-pngdiff.mjs before.png after.png --out diff.png --mask 'x,y,w,h'` |
| probe-sheet | One labelled contact sheet for a visual judge, native next to ours | `node scripts/live/probe-sheet.mjs sheet.png 'n.png=Native feed' 'o.png=Ours' --cols 2` |
| cdp.mjs | Raw CDP: `eval`, `xeval` (extension isolated world), `events` (drains the session), `raw`, `targets` | see header of `scripts/live/cdp.mjs` |

Reading timelines: a new `#id` means the element matched by the region selector was replaced. With a selector list it can also mean a placeholder gave way to the real component inside the same wrapper, which is normal on first render. Before calling it a remount, log the wrapper's own identity (for example its `id`) with a start-of-page MutationObserver. `paint=` shows what is actually drawn at the region's centre, `route` is an in-page navigation, and a new `[doc]` means a full page load. Compare every timeline with the same transition on a native page; only the differences are defects.

## Extension network and reload (L3)
- Service-worker requests (for example Arctic Shift): open a page that uses the feature first, which wakes the worker. Then `c targets`, find `service_worker …/cache-broker.js`, `c raw Target.attachToTarget '{"targetId":"<id>","flatten":true}'`, `c raw Network.enable '{}' <sw>`, and later `c events <sw>`. Attach again if the worker restarts.
- Reload the extension: open `chrome-extension://<id>/popup.html` in a **temporary** tab (`Target.createTarget`) and eval `setTimeout(()=>chrome.runtime.reload(),50)`. **Keep that tab attached about 1.5 s before anything closes it.** If the popup closes first, the reload never runs and every later check silently tests stale code. Get `<id>` from `Target.getTargets` (the `service_worker` whose URL ends in `cache-broker.js`) or from `executionContextCreated` events.
- Confirm the version: on a Reddit chat page (`https://www.reddit.com/chat`), deep-search for `[data-rcs-version]` and compare it with `extension/manifest.json`. If they differ, stop and report.

## Measuring components as data (native first)
- **Deep computed-style dump**: walk a root and every open `shadowRoot` beneath it. Record for each visible element its tag, classes, slot, box (x, y, w, h relative to the root), and `display`, `padding`, `margin`, `gap`, `border`, `border-radius`, `background-color`, `color`, font weight, size and line-height, `box-shadow`, `outline` and `transition`. Dedupe repeated subtrees. Save one JSON per state (`native-1-idle.json`, `native-3-focused.json`, …) and the same for ours, then diff.
- **Markup**: `outerHTML` plus `shadowRoot.innerHTML`, with `data-faceplate-tracking-context`, `<svg>` bodies, `<style>` and comments stripped.
- **States**: drive them with real input: `Input.dispatchMouseEvent` (pressed and released at the element centre after `scrollIntoView`), `Input.insertText`, and `Input.dispatchKeyEvent` for Enter and Escape (Ctrl+A is `modifiers:2`).
- **Load order**: poll every 100 ms after `Page.navigate` and record the first time each selector has a non-zero height, for ours and native.
- **Custom element availability**: from the page world, `customElements.get('<tag>')`. Defined elements can be reused by parsing markup; undefined ones need CSS fallbacks.
- **Logged-out view**: `Target.createBrowserContext` plus `Target.createTarget({browserContextId})` gives a cookie-free context. Reddit currently answers it with "Prove your humanity"; don't try to get past it. Dispose of the context afterwards.
- **Worker requests**: attach to the `service_worker` target and `Runtime.evaluate` there. `fetch` from the worker shows what the extension's background sees, including its host permissions.

## Relay housekeeping
- Start: `node scripts/live/relay.mjs` (background), then wait until the output says `connected on port 9333`. If the user approves Chrome's prompt after the relay has given up, it prints `closed` and exits: start it again.
- After live work: stop the relay and delete `artifacts/research/live-probe/relay-token*`.
- The version marker `[data-rcs-version]` exists only on chat pages; elsewhere, confirm the version from the reload step.
- Helper scripts written during a session (tab helpers, style dumps, reload) live in that session's scratchpad and disappear. Rebuild them on `scripts/live/relay-client.mjs` (`call`, `ev`, `events`, `sleep`).

## Where things go
Captures, timelines and screenshots go in `artifacts/research/verify/<slug>/` (git-ignored; never commit them). Validation records go in `artifacts/validation-v<version>/validation.json`.
