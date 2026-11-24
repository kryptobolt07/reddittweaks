# Visual Search Spec (`infini.wtf`)

## Overview & Opt-In Contract

Visual Search integrates credential-free visual media search and reverse image similarity from `infini.wtf` directly into Reddit Search, the header search box, and Reddit media posts.

- **Off by default:** `visualSearch: false` in `RTPostModel.SETTINGS_DEFAULTS`. `visualSearchPostMenu: true` controls the post overflow (`⋯`) item only while `visualSearch` is enabled.
- **Host permissions:** `host_permissions` in `extension/manifest.json` declares `https://infini.wtf/*` and `https://video.infini.wtf/*` (matching Arctic Shift and RedditRaffler; `image.infini.wtf` needs no host permission for `<img>` or `chrome.downloads`). Toggling Visual search in the popup saves immediately with no extra runtime permission dialog.
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

### Pagination, Video vs GIF Distinction & Limits

- **Multi-page pagination:** With a standard browser `User-Agent`, `infini.wtf` returns `page=1, 2, 3, ...` (`10` cells per page) along with `data-infinite-scroll-url-value` triggers (`/view/<slug>-<uuid>` returns up to `20` items across `page=1, 2`), ending cleanly when no next trigger or `204 No Content` arrives. New pages append directly to the shortest `.rt-vs-masonry` columns (`IntersectionObserver` sentinel + `Load more` fallback), deduplicating UUIDs without disturbing existing cards.
- **Video vs GIF classification:** `infini.wtf` sets `is_animated=true` in `data-download-url` on both GIFs and videos; `visual-search-model.js` inspects `data-video` `attributes` (`controls` vs `muted`) and `visual-search-broker.js` enforces strict `videos` vs `gifs` separation.
- **Variable aspect-ratio masonry & icons:** Cards read `data-lg-size` / CSS `aspect-ratio` (with `img.onload` fallback), use `object-fit: contain` so images are never clipped, and display 16×16 community avatars resolved through `RTCommunityIcons` (`peek` / `get`).
- **1:1 Controls & Search Bar parity:** Filter buttons (`.rt-vs-controls .rt-search-inline-filter`) stay transparent at rest and highlight only on hover or selection, reusing Reddit's `nsfw-fill-12` styling for `NSFW`. Submitting via header Enter dismisses `#search-dropdown-results-container` (unless a keyboard-highlighted suggestion row is selected), starts a fixed 2px top `#ff4500` progress bar, prefetches page 1, and navigates via native router links.
- **`/view/...` filters & unindexed posts:** `/view/<slug>-<uuid>.turbo_stream` ignores `media_type`, `time`, and `nsfw`, so filters are hidden in `view` mode. Unindexed Reddit posts show the post thumbnail and explicit 1-click **"Upload post image to search visually"** and **"Search by title instead"** actions without automatic media uploads.

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
| T14 | Phone viewport & bottom sheets | Media/Time filters and header upload menu open via `RTFeedSheet` on `< 768px` viewports; `.rt-vs-masonry` uses 2 columns with `16px` horizontal padding/gap and zero horizontal overflow (`scrollWidth <= innerWidth`). |
| T15 | Extension coexistence | `live-subreddit-filters.js`, `post-discovery.js`, and `subreddit-archive.js` yield when `html[data-rt-visual-active]` or `[data-rt-ui="visual-search"]` is active. `visual-search.js` re-emits `reddit:route` only after mount/teardown changes. |
| T16 | Opt-out | Setting `visualSearch: false` runs `teardownActive()`, restores hidden native `<main>` nodes, removes `.rt-vs-progress` and `[data-rt-ui="visual-search-slot"]`, restores `faceplate-tabgroup` tabs/Shadow DOM selection attributes, removes injected header/menu items, revokes `blob:` URLs, clears parks and worker cache. |

## DOM Ownership Audit

- `html[data-rt-visual-active]`, `html[data-rt-visual-ready]`, `data-rt-visual-restoring`, `data-rt-visual-hidden`: owned exclusively by `visual-search-boot.js` & `visual-search.js`.
- `[data-rt-ui="visual-search"]` (`.rt-vs-host`), `[data-rt-ui="visual-progress"]`, `[data-rt-ui="visual-search-tab"]` (`#search-results-page-tab-visual`), `[data-rt-ui="visual-search-slot"]` (inside `#search-results-page-tabgroup` Shadow DOM), `[data-rt-ui="visual-search-trigger"]`, `[data-rt-ui="visual-search-popover"]`, `[data-rt-ui="visual-search-lightbox"]`, `[data-rt-visual-menu="item"]`: owned exclusively by `visual-search.js` (ignoring mutations inside `[data-rt-ui]` and `RTPostMenuDOM.onlyMenuChanges`).
- `parks` / `urlParks` store detached `.rt-vs-host` subtrees only up to `MAX_PARKS` (`6`) and `PARK_TTL_MS` (`15 min`), cleared on `teardownActive()`.

## Cleanup pass (2026-11-24)

User report: the tile overlay ("▶ VIDEO" and a "Similar" text button) was messy, community icons didn't load properly, the placeholders weren't Reddit's, *Search by image* needed better naming, **All** disappeared after an image search, the bottom bar linking to the Media tab should go, phones needed a better way to reach the media options (including *Preview the one I stop on*), posts opened from results ignored *Post opened directly*, and hover previews were unreliable.

### Measured on Reddit's Media tab (signed in, Chrome Dev, 1440 px and 412 px)

| Part | Reddit | Visual tab now |
|---|---|---|
| Placeholder row | `div.grid.grid-cols-2.xs:grid-cols-3.gap-x-md`; per column `shimmer-placeholder bg-shimmer rounded-2` blocks of 128, 16 and 40 px with 4 px gaps, `rgba(0,0,0,.03)`, no animation; 3 columns (347 px) desktop, 2 (182–198 px) phone | Same classes and sizes (live: 347 × 128 px desktop, 182 × 128 px phone, same colour, radius and gap), also as the load-more row |
| Community row | `mt-2xs`, 16 px `shreddit-subreddit-icon__icon`, label 14/21 px 600 `rgb(92,108,116)` | Same markup and classes; live 14/21 px 600 `rgb(92,108,116)`, icons 16 px |
| Community icon | Hover card marks the real icon `img.shreddit-subreddit-icon__icon`; old `b.thumbs.redditmedia.com` icons are transparent and drawn over the community colour (`background:#AF6401`); no icon = `community-fill` glyph in that colour | `community-icons.js` reads the marked icon and its colour (never a flair emoji), keeps colours for the session; live 10/10 icons loaded with their colours |
| Title | `text-sm font-semibold mt-2xs text-neutral-content-strong line-clamp-2` | Same (live 14/20 px 600) |
| Tile badge | `button-media` pill, top right (gallery count `1/4`) | One symbol in a 24 px dark pill: play mark (video) or GIF mark; `aria-label` Video / GIF |
| Tabs with an empty `q` | Reddit drops **All** | Image, similar and popular searches keep the search's `q` (the `rt_v*` mode still decides the results), so **All** stays (live: `all` present in similar mode) |

### Behaviour

| | Case | Expected |
|---|---|---|
| C1 | Mouse over a clip tile (videoStart / gifStart *Default* or *Preview*) | Plays muted after 200 ms; moving onto the tile's buttons keeps it; leaving the tile stops it; each clip is fetched once even when hovered twice |
| C2 | Touch, *Default* or *Preview the one I stop on* | Once scrolling rests 600 ms, the clip ≥ 60 % on screen nearest the middle plays muted; it keeps playing while ≥ 50 % visible; one at a time |
| C3 | *Autoplay* | Same pick after 150 ms, any pointer |
| C4 | *Only when I press Play* | Nothing starts by itself; the lightbox or the ⋯ sheet's *Play preview here* still play |
| C5 | Touch ⋯ beside the community | Bottom sheet: Play preview here (clips only), Find visually similar, View larger, Download, Open post |
| C6 | Open a result | `video-control.js` treats the opened post as *Post opened directly* (live: *Stay paused* held it at 0:00; *Play muted* played it) |
| C7 | Grid end | No count bar or Media tab link: a 1 px sentinel loads the next page, Reddit's placeholder row while loading, *Couldn't load more results · Try again* on failure |
| C8 | Image search entry | Chip *Search with image* (*Change image* during an image search). Popover *Search with an image*: drop zone, Upload a file, Paste image (⌘V / Ctrl+V hint), Browse popular, and a note that images are resized and stripped of metadata. Phone sheet: Choose a photo, Paste copied image, Browse popular. The image-search banner reads *Your image* with *Remove image* (back to the words searched for, or popular) |

Verification: `tests/visual-search-ui.test.cjs` (placeholder markup, icon-only badges and buttons, quiet load-more, `q` kept, hover/stop-on/autoplay/Play-only previews with one fetch per clip, the ⋯ sheet, community colours) and `tests/community-icons.test.cjs` (marked icon, glyph, colour). Live desktop and phone: `artifacts/research/verify/visual-search/after.mjs` (values above). Not verified live: uploads (no image was sent to infini.wtf), Firefox, and the phone tab row (at 412 px Reddit scrolls a fifth selected tab into view, so **All** slides under the left arrow, as it does for Comments).

## Second pass: streaming, viewer, hand-off and phones (2026-11-24)

User report: hover previews failed on some results (r/LivestreamFail clips for *hi*); no seamless carry-over into full screen or the post, and the toggles weren't followed; timeouts weren't handled; Android had no clear playback policy, and the full-screen overlay stayed open after *Open Reddit post*; the full-screen viewer looked basic and was hidden in the ⋯ menu on Android; the image-search button should be just a mark (better designed), and it was missing from the phone Home search bar; requests for an embedded-media filter and a click-behaviour option; a play mark on Reddit's own embed thumbnails; the permission prompt didn't always appear and the description was too tall.

### Findings

- The failing clips parsed fine (10/10 tiles of *hi* · Videos page 2 had video URLs) but were 9.5–13 MB. Each preview downloaded the whole MP4 in the worker, then base64 over messaging (~ +33 %), before the first frame, and anything over 16 MB failed. Reddit's `media-src` blocks `video.infini.wtf`, but `frame-src` rules don't apply to the extension's own web-accessible page.
- infini.wtf only indexes Reddit-hosted media (`i.redd.it`, `v.redd.it`, galleries; checked against Arctic Shift post data for *trailer*, *twitch clip* and *youtube*). There are no YouTube/Twitch embeds to filter, so Visual gets no *Embedded* filter; Reddit's feed Post type filter already has *Embedded media*.
- Phone Home's `prominent-search` is one large *Search Reddit* button (`#expand-search-button`, 374 × 48 px) with no input until it opens, so the header trigger never attached there.
- The broker never reported missing site access, and the popup switch never asked for it.

### Design

| | Case | Expected |
|---|---|---|
| S1 | Any clip preview, viewer clip | Streams in `visual-player.html` (web-accessible on reddit.com only; validates `https://video.infini.wtf/<id>/original.mp4` and the parent origin; talks only to its parent). Commands in, state out (`hello`, `playing`, `time` 4×/s, `error`). If no `hello` arrives within 2.5 s, later clips use the old bounded `blob:` download |
| S2 | Expand / click choice *Open in full-screen viewer* | Black full-screen viewer: community and title top left; *Find visually similar*, *Download* (desktop), *Open post*, *Close* top right; ← / → buttons, keys and swipes move through the results; swipe down, Esc or the backdrop close it. A clip continues from the tile's moment, with controls; sound follows *Media click audio* (`clickAudio`) |
| S3 | *Open post* (viewer, ⋯ sheet) or a click on a playing tile | The viewer closes, then the clip's moment goes to `video-control.js` (`rt-visual-continue`), and *Seamless post transition* decides (Keep time / From start / Reddit Default). Sound: viewer keeps its own; media click follows `clickAudio`; title follows `cardClickAudio` |
| S4 | Popup *Clicking a result* (`visualClick`) | *Open the post* (default) · *Open in full-screen viewer* · *Play clips in the grid* (images open the viewer). Titles always open the post |
| S5 | Touch | Expand sits on the media (bottom right, 32 px); Find similar, Download, Open post and Play preview here stay in the ⋯ sheet; playback still follows the start choices (C2–C4) |
| S6 | Image search entry | A 36 px icon-only button with a lens mark (viewfinder corners around a lens), also used in the header. Phone Home: a 40 px button inside the right end of *Search Reddit*, a sibling of Reddit's button |
| S7 | Slow or failed answers | Each page request has a ceiling (query 25 s, video 40 s, upload 45 s…) above the broker's own fetch timeouts; a timed-out or dropped first page retries once quietly behind the placeholders, then says *infini.wtf is taking too long* with *Try again*; rate limits say *infini.wtf asked us to slow down*. A clip that can't play turns its badge red briefly |
| S8 | Turning Visual search on | The popup asks for `infini.wtf` / `video.infini.wtf` access (the browser prompts only if it is withheld); refused leaves it off with a note. The broker answers `permission-required` when access is missing. Description shortened to one line |

### Verification

Unit: `tests/visual-search-ui.test.cjs` (frame URL and parameters, foreign messages ignored, viewer continues from the preview time, ← / →, *Open post* closes and hands over, *Play here*, frame fallback to download, lens button, phone Home trigger, timeout retry and message), `tests/video-control.test.cjs` (hand-off under Keep time / From start / Reddit Default; embed play mark), `tests/tweaks-popup.test.cjs` (access asked on, refused stays off).

Live, signed in (`artifacts/research/verify/visual-search/after2.mjs`): desktop *hi* · Videos: hover → playing in 1.15 s through the frame (no download), viewer opened with the clip continuing, ← / → over 10 results, *Open post* closed the viewer and the post's video played on from 2.4 s (7.5 s six seconds later). Phone: Home lens at 349, 60 (40 × 40) inside the search bar; expand visible on every clip tile; viewer 412 × 915; *Open post* closed it. r/videos with Embeds *Preview*: the mark showed on every YouTube still that had loaded.

Not verified: in Chromium's phone emulation every cross-site frame (the player, and an ordinary YouTube frame alike) is laid out at 1/2.625 of its size, an emulator issue, so clip sizing on phones was not checked on a real device; Firefox; the browser's permission prompt itself (unit only); image uploads.
