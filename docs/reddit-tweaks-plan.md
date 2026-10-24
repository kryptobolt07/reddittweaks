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
- Render text safely. Never insert API-supplied HTML, copy live interactive controls, impersonate votes, auto-play media, expose spoilers/NSFW thumbnails without respecting their flags, or claim complete history.
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
