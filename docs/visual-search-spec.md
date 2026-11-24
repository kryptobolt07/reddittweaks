# Visual Search Spec (`infini.wtf`)

## Overview & Opt-In Contract

Visual Search integrates credential-free visual media search and reverse image similarity from `infini.wtf` directly into Reddit Search, the header search box, and Reddit media posts.

- **Off by default:** `visualSearch: false` in `RTPostModel.SETTINGS_DEFAULTS`. `visualSearchPostMenu: true` controls the post overflow (`⋯`) item only while `visualSearch` is enabled.
- **Runtime host permissions:** `optional_host_permissions` in `extension/manifest.json` declares:
  - `https://infini.wtf/*`
  - `https://image.infini.wtf/*`
  - `https://video.infini.wtf/*`
- **Popup permission timing:** Enabling `#visual-search` in `extension/popup.js` calls `api.permissions.request({ origins: [...] })` synchronously inside the checkbox `change` handler before any `await`, preserving user activation across Chrome and Firefox. Denial reverts the checkbox to `false`; disabling or clicking `#visual-search-revoke` clears the worker cache (`clear-cache`).
- **Pre-paint session gate:** `extension/visual-search.js` mirrors `visualSearch` into `sessionStorage['rt-visual-enabled-v1']`. `extension/visual-search-boot.js` runs at `document_start` and sets `html[data-rt-visual-active]` only when `rt-visual-enabled-v1 === '1'` and the URL is a search route with `rt_visual=1` (on initial load, `popstate`, and `navigation.currententrychange`). `extension/visual-search.css` suppresses native Reddit search panes under `html[data-rt-visual-active]` with a 6s `rt-visual-failsafe` reveal animation if the controller does not mark `data-rt-visual-ready`.

## Measured Reddit Baselines & CSP (Desktop & Phone, 2026-11-24)

Measured read-only on signed-in `https://www.reddit.com/search/?q=ice+cream&type=media` (Chrome Dev 160):

- **Content Security Policy:**
  - `img-src 'self' data: blob: https:` permits direct `<img src="https://image.infini.wtf/..." referrerpolicy="no-referrer">` without proxying.
  - `media-src 'self' blob: data: *.redd.it www.redditstatic.com cf.redditstatic.com matrix.redditspace.com` **blocks** direct `<video src="https://video.infini.wtf/...">`, while permitting `blob:` URLs. `visual-search-broker.js` fetches bounded MP4 previews (`<= 16 MB`) with `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, and `redirect: 'error'`, returning base64 to the page to create a single active `blob:` object URL at a time.
- **Desktop (`1440×900`):**
  - `#search-results-page-tabgroup` is a `faceplate-tabgroup` whose shared Shadow DOM contains `<div class="container"><div class="tablist" role="tablist"><span role="tab"><slot name="...">` wrappers; tabs are `40px` tall pills (`14px`, weight `600`, `border-radius: 999px`) styled with `faceplate-tab-selected` and inline `background-color: var(--color-secondary-background-selected)`.
  - Because `visual-search.js` runs in an isolated content-script world, setting `tg.pageNames` expandos does not update Reddit's Lit component. Instead, `visual-search.js` projects `<a id="search-results-page-tab-visual" slot="visual">` by inserting `<span role="tab" data-rt-ui="visual-search-slot"><slot name="visual"></slot></span>` directly inside `tg.shadowRoot`'s `.tablist` after the `media` wrapper and keeping it guarded by `tabShadowObserver`.
  - `[slot="filters"]` sits at `y: 120, h: 40`; desktop media grid is 3 columns (`346.66px` columns, `16px` gap inside `1072px` container at `x: 313`).
  - Clicking another search tab (`Posts`) replaces `<main>` (`sameMain: false`).
- **Phone (`412×915`):**
  - `vw: 412, sw: 412` (zero horizontal overflow required).
  - 2-column grid (`182px` tiles, `16px` horizontal padding and `16px` gap: `16 + 182 + 16 + 182 + 16 = 412`).
  - Mobile filters sit above `<main>` (`filter-drawer` rail, `y: 120, h: 40`); header `<faceplate-search-input name="q">` inside `reddit-search-small` / `reddit-search-large` / `prominent-search` exposes slot `trailingContent` inside Shadow DOM (with light-DOM trailing fallback).

## Allowed `infini.wtf` Endpoints & Provider Limits

`extension/visual-search-model.js` and `extension/visual-search-broker.js` call **only** these verified endpoints:

| Purpose | Endpoint | Notes |
|---|---|---|
| Keyword search | `GET /search/<query-slug>.turbo_stream?page=1` | Hyphenated lowercase slug (`slugifyQuery`); optional `nsfw=true`, `media_type`, `time` |
| Subreddit media | `GET /search/r/<subreddit>?format=turbo_stream&page=1` | Lowercase subreddit name (`r/pixelart` works; mixed case can redirect) |
| User media | `GET /search/u/<username>` | HTML/Turbo Stream grid cells |
| Popular media | `GET /popular.turbo_stream?page=1` | Landing / empty-query popular feed |
| Related searches | `GET /related_searches?query=<text>` | Suggestion chips |
| Autocomplete | `GET /autocomplete?query=<text>` | Query suggestions |
| Permalink lookup | `GET /r/<subreddit>/comments/<postId>/` | Lowercase `<subreddit>`; `HEAD` first, fallback bounded `GET`; resolves 301 to `/view/<slug>-<uuid>` |
| Similar items | `GET /view/<slug>-<uuid>.turbo_stream?page=1` | Provider ignores `nsfw` / `media_type` / `time` filters on `/view/...` |
| Check upload hash | `GET /image-queries/<sha256>` | Checked before upload to avoid redundant POST |
| Upload image | `POST /image-queries` | Multipart `image` + `image_hash` (EXIF stripped via canvas resize first) |
| Upload results | `GET /search-by-upload/<uuid>.turbo_stream?page=1` | Optional `nsfw=true`, `media_type`, `time` |
| Download media | `GET /download/<uuid>?is_animated=false` | Dispatched via worker `chrome.downloads.download` |
| Image CDN | `https://image.infini.wtf/<uuid>/<width>/<quality>/original.webp` / `thumbnail.webp` | Validated by `safeImageUrl` / `safeSrcset` |
| Video CDN | `https://video.infini.wtf/<uuid>/original.mp4` | Validated by `safeVideoUrl`, worker-fetched into `blob:` URL |

### Known Provider Limits

- `page=2` and higher return `204 No Content`, capping direct endpoint queries at **10 results** (`RESULT_LIMIT = 10`). The UI communicates this honestly in the footer rather than pretending infinite scroll exists.
- `/view/<slug>-<uuid>.turbo_stream` ignores filter parameters (`media_type`, `time`, `nsfw`). The UI hides or labels filters accordingly in `view` mode so users are never misled.
- Unindexed Reddit posts return non-view redirects/HTML from `/r/<subreddit>/comments/<postId>/`. The extension **never** auto-uploads Reddit media; instead it shows the post thumbnail and explicit 1-click actions: **"Upload post image to search visually"** and **"Search by title instead"**.

## NSFW, Privacy & Safe Parsing Contract

- **Strictly forbidden filters:** `gay` and `trans` are never rendered in UI, accepted by `normalizeFilters()`, stored in settings/history, or emitted in any URL or broker request.
- **NSFW off by default:** `nsfw` defaults to `false` on every search unless `rt_vnsfw=1` is explicitly present on the current search URL. Omitted/`false` omits `nsfw` from `infini.wtf` URLs; turning `nsfw` off fires `clear-cache({ nsfwOnly: true })` so `|1|` cached results are purged immediately.
- **Cache isolation:** `cacheKey(spec)` encodes `kind|target|nsfw(0/1)|mediaType|time` so safe and `nsfw=true` result sets never bleed across modes.
- **Zero credentials & sanitized uploads:** All worker fetches use `credentials: 'omit'` and `referrerPolicy: 'no-referrer'`. Clipboard/file/post uploads are decoded and re-encoded through canvas (`max 1280px` `MAX_IMAGE_DIM`, WebP/JPEG fallback) to strip EXIF metadata before hashing (`SHA-256`) and checking `/image-queries/<sha256>`.
- **Zero HTML sinks & bounded streams:** `parseGridCells()` and `parseSuggestions()` in `visual-search-model.js` use a linear quote-aware tag scanner without DOM HTML injection (`innerHTML`/`outerHTML`/`insertAdjacentHTML` are never used). Worker streams enforce byte limits (`2 MB` HTML, `10 MB` image, `16 MB` video) and exponential backoff (`rt-visual-backoff-v1`) on 429/503 responses.

## Lifecycle & Transition Matrix (T1–T16)

| Case | Scenario | Controller Behavior & Invariants |
|---|---|---|
| T1 | Initial load with `rt_visual=1` | `visual-search-boot.js` sets `html[data-rt-visual-active]` at `document_start`; controller hides native `<main>` children via `suppressNativeInMain()` (`hidden` + `data-rt-visual-hidden`), mounts `.rt-vs-host` (`[data-rt-ui="visual-search"]`), marks `data-rt-visual-ready`, then dispatches `reddit:route` cleanly under `dispatchingRoute` guard. |
| T2 | Click Visual result tile -> Reddit post | `startDeparture({ clickedUuid, clickedOffset, expectPost: true })` parks `{ host, state, scrollY, clickedUuid, clickedOffset }` in `parks` & `urlParks` and holds `.rt-vs-host` + native suppression on outgoing `<main>` until Reddit replaces `<main>` or inserts `shreddit-post[view-context="CommentsPage"]` (with `LEAVE_FAILSAFE_MS = 6000` safety timeout). Scrolls newly opened post to `top: 0` unless `userScrolledRecently` is set. |
| T3 | Browser Back from Reddit post -> Visual | `handleRoute` detects `popstate` / `traverse` from `CommentsPage` or non-search route and sets `waitingForReplacedMain` (with 3s timeout) so Visual does **not** mount into the outgoing post/home `<main>`. Once `<main>` swaps or search DOM (`#search-results-page-tabgroup`, `search-media-feed`, `[data-testid="search-sdui-post"]`, `[data-testid="search-error-message"]`) arrives, `adoptPark()` re-attaches the parked DOM instantaneously with **zero refetch** and runs `restoreScrollAfterReturn()` (anchoring `[data-uuid]` top offset first, falling back to `scrollY`, aborting immediately on `wheel`/`touchstart`/`pointerdown`/`keydown`). |
| T4 | Browser Forward back to post | Re-enters outgoing departure hold cleanly with parked `host` preserved in `parks` / `urlParks`. |
| T5 | Native `Media` <-> `Visual` tab switch & Back | Clicking `Visual` strips `cId`/`iId`, sets `rt_visual=1`, calls `history.pushState` + pops/syncs natively without full page reload. Clicking native `Media` (or Back to `baseNativeUrl`) saves Visual park, unmounts `.rt-vs-host`, and immediately restores `hiddenNodes` (0ms swap, no 6s hold). |
| T6 | Switch from `Visual` -> `Posts` / `All` / `Comments` | Clicking any non-Media native tab calls `startDeparture()`, holding Visual visible until Reddit replaces `<main>`, eliminating native empty/error flashes mid-transition. |
| T7 | Header camera trigger (`reddit-search-large`/`small`/`prominent-search`) | Injects 1 button (`[data-rt-ui="visual-search-trigger"]`) into `trailingContent` slot (or trailing container). Opens desktop popover or phone `RTFeedSheet` with File pick, Clipboard paste, Drag & drop, and Popular feed launch. |
| T8 | Post `⋯` `"Find visually similar"` | `RTPostMenuDOM` synchronizes `"Find visually similar"` on media posts into inline menus and native phone `r-post-menu-sheet`, routing to `?q=&rt_visual=1&rt_vpost=<sub>/<id>`. |
| T9 | Unindexed Reddit post lookup | Shows seed card with post thumbnail + explicit upload button & title-search fallback (zero automatic Reddit image upload). |
| T10 | Image upload hash hit vs new upload | Checks `GET /image-queries/<sha256>` first; only POSTs when unindexed, then polls with visibility-aware interval (paused while tab hidden). |
| T11 | Filter changes (`media_type`, `time`, `nsfw`) | Replaces Visual query URL cleanly; safe -> NSFW keeps safe cache separate; NSFW -> safe calls `clear-cache({ nsfwOnly: true })`. |
| T12 | Query operator stripping | Strips `subreddit:`, `r/`, `author:`, `u/`, `flair:`, `nsfw:`, `self:`, `spoiler:`, `type:`, `site:`, `url:`, `title:`, `selftext:`, `body:` and shows honest notice banner with 1-click "Search all of Reddit". |
| T13 | Video preview under Reddit CSP | Hover/focus desktop preview or click Play in lightbox loads one `blob:` MP4 at a time via worker `fetch-video`, pausing and revoking/stopping when scrolled out of view (`IntersectionObserver`). |
| T14 | Phone viewport & bottom sheets | Media/Time filters and header upload menu open via `RTFeedSheet` on `< 768px` viewports; `.rt-vs-grid` uses 2 columns with `box-sizing: border-box` and zero horizontal overflow (`scrollWidth <= innerWidth`). |
| T15 | Extension coexistence | `live-subreddit-filters.js`, `post-discovery.js`, and `subreddit-archive.js` yield when `html[data-rt-visual-active]` or `[data-rt-ui="visual-search"]` is active. `visual-search.js` re-emits `reddit:route` only after mount/teardown changes. |
| T16 | Opt-out / permission revoke | Setting `visualSearch: false` or revoking `infini.wtf` permissions runs `teardownActive()`, restores hidden native `<main>` nodes, removes `[data-rt-ui="visual-search-slot"]` and restores `faceplate-tabgroup` tabs/Shadow DOM selection attributes, removes injected header/menu items, revokes `blob:` URLs, clears parks and worker cache. |

## DOM Ownership Audit

- `html[data-rt-visual-active]`, `html[data-rt-visual-ready]`, `data-rt-visual-restoring`, `data-rt-visual-hidden`: owned exclusively by `visual-search-boot.js` & `visual-search.js`.
- `[data-rt-ui="visual-search"]` (`.rt-vs-host`), `[data-rt-ui="visual-search-tab"]` (`#search-results-page-tab-visual`), `[data-rt-ui="visual-search-slot"]` (inside `#search-results-page-tabgroup` Shadow DOM), `[data-rt-ui="visual-search-trigger"]`, `[data-rt-ui="visual-search-popover"]`, `[data-rt-ui="visual-search-lightbox"]`, `[data-rt-visual-menu="item"]`: owned exclusively by `visual-search.js` (ignoring mutations inside `[data-rt-ui]` and `RTPostMenuDOM.onlyMenuChanges`).
- `parks` / `urlParks` store detached `.rt-vs-host` subtrees only up to `MAX_PARKS` (`6`) and `PARK_TTL_MS` (`15 min`), cleared on `teardownActive()`.
