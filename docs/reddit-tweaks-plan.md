# Reddit Tweaks: rebrand and post discovery

## Branch and release sequence

1. Validate the completed chat-search branch and fast-forward local main to it. Done: 435 tests pass; main includes 0.12.8. No remote push.
2. Implement this expansion on `codex/reddit-tweaks-post-discovery`, preserving the chat installation, caches, account scopes and stable `artifacts/reddit-chat-search/` folder.
3. Commit the plan, provider/model, native integration, settings/rebrand and release as coherent changes. Release as 0.13.0 because this adds a new user-facing feature; no chat storage migration.

## Meaning and scope

- Profile curation can omit public posts from a profile while leaving them available in Reddit search. Discovery does not expose another account's private Hidden list, blocked/private communities or restricted account data.
- Public author search can discover additional posts. Absence from the currently rendered profile is not proof that its author hid or deleted a post.
- Arctic Shift supplies an optional archived snapshot. Archive existence, age, or disappearance from search does not establish current deletion/removal. Confirm status through Reddit metadata where available; otherwise say current status unknown.
- Initial scope: modern Reddit public profile Overview/Posts views and post detail pages, plus the extensible extension popup. Comments discovery and old-Reddit custom rendering are separate future features.

## Interface

- Rename the extension and popup Reddit Tweaks. Keep chat controls and management available under Chat; add Posts settings for public discovery and optional archive discovery.
- Add a small inline discovery action in the profile feed. Show additional posts in that feed's layout, using Reddit typography, color tokens, spacing and native post elements where feasible. Do not replace profile controls, insert a large separate extension panel or alter existing post content.
- Use compact icon indicators with accessible labels/tooltips for search provenance, archived snapshots and confirmed deleted/removed states. A post discovered outside the current feed is labelled as such, without guessing author intent.
- Preserve live content. An optional archived text snapshot is separate from live content and clearly identifies its source. On detail pages, fetch archive text only by explicit action with archive discovery enabled.
- Render text safely. Keep archive text inert. Obtain native cards only from fixed same-origin Reddit fragment endpoints and let Reddit’s own renderer hydrate its controls and modules in the page world. Do not copy another post’s interactive state or invent votes/actions. Preserve native media restrictions and never claim complete history.
- Use explicit Load more. Debounce DOM observation, cancel stale SPA work, deduplicate against native and injected IDs, and remove extension UI when its feature is disabled.

## Data and requests

- Reddit requests stay in the page world and use its existing same-origin browser session. A narrow bridge supports only public author search and bounded post-ID metadata lookup, with strict route/parameter validation and timeouts. No credentials cross the bridge.
- Arctic requests run in the worker against fixed public endpoints with credentials omitted, no referrer and an explicit host permission. The viewed public username/post ID is shared only when archive discovery is enabled and requested. The popup explains this.
- Validate extension message sender/origin/profile route, settings, usernames, IDs, cursors and response shape. Bound response fields and request sizes; no arbitrary URL proxy.
- Normalize live versus archived post records, preserve provenance, prefer current live metadata and retain archived text separately. Do not infer deletion from a missing lookup response.
- Persist preferences only under `rt-settings-v1`. Keep discovery results in bounded, short-lived memory; do not persist archived post bodies, browsed profiles or request history. Existing chat caches remain unchanged.
- Deduplicate simultaneous requests, bound concurrency and pagination, respect Retry-After/rate-limit resets, and surface partial/failure states. No polling, exhaustive background archive scan or automatic server-history build.
- Reddit pagination uses its opaque after cursor. Archive date pagination overlaps boundary timestamps and deduplicates IDs; stop with an explicit partial-history explanation if a dense timestamp boundary cannot progress safely.

## Validation

- Preserve the complete existing chat suite.
- Synthetic provider tests cover input validation, source precedence/status, hostile text/URLs, account-deleted versus post-deleted distinction, route restrictions, settings gates, rate limiting, timeout, deduplication and ambiguous pagination.
- Synthetic UI tests cover regular/curated/empty profiles, native ID deduplication, appended native posts, SPA navigation/stale results, disable cleanup, keyboard/focus, dark theme tokens, loading/error/retry and detail snapshot placement.
- Popup tests cover defaults, persistence/error recovery and existing clear/stat controls.
- Verify syntax, manifest assets, ZIP integrity and source/stable-folder/archive byte equality. Inspect responsive synthetic pages in a real browser when available. Document unverified live integration and archive coverage limitations honestly.

## Primary references

- Ghostddit logic/reference only: https://github.com/ghostddit/ghostddit-extension (MIT; cloned solely under ignored artifacts/research).
- Reddit API: https://www.reddit.com/dev/api/
- Reddit profile-curation announcement: https://www.reddit.com/r/reddit/comments/1l2hl4l/curate_your_reddit_profile_content_with_new/
- Arctic Shift API: https://github.com/ArthurHeitmann/arctic_shift/blob/master/api/README.md
- Arctic Shift dataset notes: https://github.com/ArthurHeitmann/arctic_shift/blob/master/file_content_explanations.md

No reference UI or code is copied. Availability and response schemas can change; archived content can be missing or stale. Public API access and use remain subject to the providers' rules. Historical private chat research and reference clones must remain ignored and uncommitted.

## Implemented outcome

The provider/model, inline profile and detail integration, and popup rebrand are implemented in separate commits. Current public API fields were checked against Arctic Shift's documentation; unsupported field projections were removed. Provider opt-out gates are checked again after queueing and before returning results. Snapshot restrictions combine current and archived NSFW/spoiler flags.

Synthetic tests cover the provider and UI cases above, including delayed settings, route changes and pagination bounds. Brave confirmed current profile/feed and post slot structure, and the synthetic preview was inspected in wide/narrow and light/dark layouts. Direct browser navigation to Reddit's search JSON endpoint was blocked by the client; no restriction was bypassed. Live extension requests and end-to-end recovery remain to be checked after reloading the installed extension. Arctic Shift responses were probed during research, but availability varies by environment. The new host permission is limited to its public API origin.

## 0.14.0 follow-up diagnosis and correction

Live inspection reproduced a storage-boundary defect: the content script could not read `chrome.storage.local` because the existing chat broker restricts it to trusted contexts. The swallowed settings error left discovery disabled. A normalized two-boolean settings message and worker-to-tab updates now bridge that boundary without exposing or weakening chat storage. Failed initialization displays an explicit retry state.

The reported curated profile returned public posts from Reddit search, ten comments through its native search partial endpoint, and a successful Arctic Shift post page. Comment discovery now parses inert native search cards, validates authors and opaque cursors, supports modern long t1 IDs, and uses the archive comments endpoint with its documented field projection. Profile routes distinguish Posts, Comments and Overview; automatic initial reads are bounded, stale work is discarded, and explicit pagination remains incomplete.

The popup's viewport-relative maximum width could collapse its content during intrinsic sizing. Both root and body now specify a stable 360 CSS-pixel intrinsic width. A real-browser synthetic preview measures a single-line brand and a 542-pixel popup body with readable descriptions. No profile text or live diagnostics are committed.

### Native-feed merge correction

The first live follow-up exposed native `shreddit-profile-comment[comment-id]` identities that the initial deduplication missed. Keeping discoveries in a prepended section also placed old search results above recent native activity. The corrected adapter inserts only missing cards between native date anchors, leaves pinned and other native nodes in their original order, and defers discoveries older than the loaded native date window while pagination remains available. It restores placeholders and removes only owned cards on disable/navigation or native feed replacement. Status and icon controls share one compact row. Regression fixtures cover pinned cards, comment deduplication, date-window expansion, cleanup and feed replacement.

### First-party card rendering

The final integration uses the native `/svc/shreddit/partial-feed-post/t3_ID` endpoint with the observed profile view context/type, and `/svc/shreddit/comment/t1_ID?isProfile=true` for profile comments. Matching, bounded HTML remains in the page world and passes through the client’s own `faceplate-partial` fragment renderer; the extension receives only completion metadata. This loads the native modules, media, vote state, icons and menus rather than maintaining a second card design. Archive snapshots remain separately attributed plaintext.

Only nearby, nonduplicate cards hydrate, with two requests in flight and a bounded request budget. Native arrival removes an injected duplicate’s native IDs. Native shimmer/progress elements cover pending cards; ordinary checking/result status stays available to assistive technology without a visible loading banner. A small attachment animation respects reduced motion. Failure provides a retry/link and never fabricates native actions. These internal Reddit endpoints can change, so the implementation validates returned identities and falls back explicitly.

### 0.14.1 native virtualization correction

Live Brave scrolling revealed that `shreddit-feed` detaches off-screen children into `.virtualized-placeholder` elements, retaining their original nodes in its own stack. The extension was reinserting detached cards after these placeholders. Repeated virtualization therefore inflated the scroll range and replayed attachment/media behavior. Track the DOM replacement pairs without accessing or changing Reddit's private controller state. Resolve native IDs/date anchors through those slots; leave virtualized owned nodes detached until Reddit restores them. Keep hydrated DOM and avoid new requests on ordinary restoration. Retire opted-out content without deleting placeholders still owned by Reddit. Interrupted hydration becomes eligible again after restoration.

The entrance effect now ends without a retained transform/opacity stacking context and is cleared after its first run, allowing native menus to overlap later cards. Move the indicator into the native header action group before Join/overflow. Use distinct crossed-eye, trash, removal and archive glyphs with accessible status labels; an absent public result is not proof of author deletion or a private Hidden-list entry. Explicitly suppress Reddit's styled empty-profile panel while discovered results are present and restore it on cleanup. Native card media markup and controls remain unchanged.

The Welcome notice follow-up moves discovery presentation to `document_start`. A root flag is installed before asynchronous settings/search; a scoped CSS `:has()` rule recognizes Reddit's native `snoo_wave` curated-profile creative, so parser insertion and later replacements are suppressed before the deferred scan. It does not rewrite profile API responses, hide unrelated native empty/error states, or depend on additional results existing. Opt-out/unsupported routes remove the guard. Native card hydration waits for component registration inside its existing bounded/cancellable operation. Synthetic tests cover pending settings, pending/empty results, replacement markup, opt-out, SPA route cleanup and component readiness/cancellation. A temporary live probe verified the actual panel's height changes from 260px to zero; the probe was fully restored.

### 0.14.2 startup registration recovery

Installed Brave tracing of the previous build showed `post-model.js` executing in MAIN at document start but not in the isolated world at the same phase; `post-discovery.js` then exited at its missing-model guard. This affected every supported profile tab. Restore the established isolated `document_idle` model/discovery registration, and leave only a uniquely named, model-independent `profile-notice.js` guard at `document_start`. The guard observes the Document before the root exists, reads only normalized discovery preferences from the worker, and ignores late initial reads after newer opt-out updates. Discovery updates the same guard once initialized. Native fragment rendering returns to its established idle startup path; the temporary component-registration wait is removed. The early CSS rule still handles native replacement notices without rewriting API data.

Feed-scope follow-up: include sort, validated Top time range and card/compact mode in the route key, and include the query string in bridge stale-response checks. Forward sorting to the fixed author-search endpoints. Merge New by date, Top by score with the selected time window (native comment scores come from `shreddit-comment-action-row`), and Hot by source order around matching native anchors; never rearrange Reddit-owned cards. If ranked native anchors are unavailable, append the bounded selection before pagination rather than indefinitely deferring it. Coverage/ranking across independently searched post/comment/archive sources remains a bounded selection, not a complete global ranking.

Keep the bridge’s existing two-request ceiling and rolling start budgets; drain the discovery hydration queue one card at a time in current feed order. Batch visibility notifications before draining so observer delivery order cannot start a lower card first. Return structured backpressure instead of treating queue capacity as a failed card. Preserve native placeholders while paused, cancel timers on route/sort changes, honor server Retry-After once, and stop with a single Refresh explanation if rate limiting repeats. Genuine errors retain a link/retry fallback whose button cannot be clipped by a long title. Use the existing first-party `faceplate-progress` in indeterminate mode with equal host and SVG dimensions and no rotating host; live inspection verified its own track/dash animation.

Separator follow-up: live DOM inspection found native post fragments supplying their own feed rule, while comment fragments omitted it. Supply an `hr` using the observed native border classes only when no feed-level rule exists, excluding body/archived-content rules. Give placeholders and genuine-error fallbacks the same separator. Keep it inside the card wrapper so virtualization, hiding and cleanup retain one owner. Tests cover reversed queue notifications, serial completion, duplicate server rules, body rules and virtualized separator identity.

### 0.15.0 deleted-account archive view

The reported deleted profile renders a direct `shreddit-app > div` containing `img[alt="Deleted user"]` and a heading, with no `main` or `shreddit-feed`. The original discovery mount therefore never ran. Recognize this explicit marker on supported profile routes, preserve the native notice for cleanup, and mount a separate theme-token-based archive view. Never treat a generic 404, missing feed or network error as account deletion.

Reuse the existing opt-in, credential-free worker author queries and cursor limits for both posts and comments. Deleted profiles automatically request one bounded selection only when the existing archive preference is enabled. No Reddit search, metadata or server-rendered-card calls are issued in this mode. Use inert archive text and safe links with unknown current item status, historical score/date labels and no fabricated live controls. Preserve NSFW/spoiler restrictions, empty/error states, failed-refresh results, opt-out, SPA cleanup and replaced-notice handling. Other profiles retain the native-card path.

Live Brave inspection confirmed the example account's native deletion marker and absent feed. Direct Arctic Shift API probes returned HTTP 403, and browser navigation was blocked by the client; coverage for that username is unverified. No restriction was bypassed. A synthetic Brave preview verified the archive layout and mixed post/comment ordering. Tests cover archive-only requests, empty/error states, retained results, cleanup and inert/restricted snapshots.

### 0.15.1 native interface and SPA authorization correction

Brave's `sender.url` can remain the original document profile while `sender.tab.url` reflects the current SPA tab. Requiring equal paths rejected Posts and Comments. Authorize the requested username against both supported profile routes and the same origin, while retaining strict detail-ID path checks and rejecting other profiles/private tabs.

Remove the custom archive cards and tabs. Use Reddit's actual `faceplate-tabgroup`/`faceplate-tabpanel`, overflow slots, native header utilities and `shreddit-feed`; use the regular bounded native card hydration path for archive-discovered identities. Discovery continues to use only Arctic Shift, without Reddit author search/status reads. Native rendering can return live cards even after account deletion. If a fragment is gone, use native `shreddit-post` or `shreddit-profile-comment` layout and action components populated with inert archive text/values. Keep vote actions inert (the entire post stays inert until its shadow action bar can be isolated), omit executable archive markup, retain source status and restrictions, and avoid a second card design or misleading live controls.

Installed inspection found 50 archive records for the reported account, a valid native post fragment, and a missing older comment fragment. Native component definitions were available on the deleted-account page. A temporary post probe identified the native shadow action bar and was removed. Automated coverage checks same-profile sender/current-tab permutations, rejected origins/profiles/private tabs, native tab scopes/selection, native hydration, fallback action inertness, restrictions and cleanup.

### 0.15.2 native profile chrome, avatars and notice lifecycle

Detach the native curated-profile and deleted-account notices at document start, retaining comment anchors for mounting and restoration. Incremental mutation scans cover replacement panels without scanning the full document for each timeline mutation. Preserve the profile surface beneath native post overlays; returning to the profile resumes pending native card hydration rather than exposing the original notice. Opt-out or leaving the profile restores the retained notices. Replace circular progress graphics with Reddit's existing shimmer placeholder structure for both discovery and card loading.

Use exact username/alias matches in the active account's existing RCSDirectory startup snapshot and change events to reuse retained chat-member avatars, plus matching native card icons. Do not scan storage for other accounts, start chat/profile requests, persist new data, use group pictures for members, or treat a missing avatar as recoverable from Arctic Shift. Clear retained account hints and navigation on account changes. Keep avatar dimensions stable while loading; failed URLs fall back without automatic retry loops.

Deleted-account SSR omits the native grid and left navigation. Recreate the observed native profile grid/columns and render the actual left-navigation fragment from one fixed, bounded same-origin GET through Reddit's page-world renderer. Keep personalized HTML and credentials in MAIN; return only render status to the isolated script. Reuse existing request/concurrency budgets, cancellation and rate limits, preserve navigation across same-profile tabs, and leave ordinary Home/Popular/News/Explore links and explicit Retry on failure. The right column uses native panel utilities and clearly labels loaded post/comment counts and earliest/latest loaded dates. Never infer total karma, account age or complete history. Summary writes update only changed text to avoid a mutation/scan loop.

Synthetic coverage includes avatar safety/account isolation, early notice removal/restoration, post overlays, repeated notice insertion, native desktop columns, retained sidebar identity, failure/retry, no-op summary scans, and sidebar-only rendering with same-origin/scope validation. Live inspection confirmed Reddit's native layout and that its homepage contains the missing left-navigation fragment. The packaged update requires an extension reload before installed end-to-end verification.
