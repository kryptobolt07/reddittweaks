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
