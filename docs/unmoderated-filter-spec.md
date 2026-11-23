# Spec: "Awaiting approval" filter (any community)

Status: moderator source implemented 2026-11-14; any-community source and the feed-menu API implemented 2026-11-23 (`extension/unapproved-filter.js`, bridge actions `mod-status`, `unapproved` and `awaiting-status`, tests in `tests/unapproved-filter.test.cjs`). A1–A5 and A7–A11 pass as unit tests; A6 and A12 are not verified live yet. The feed menu (`extension/live-subreddit-filters.js`, plan item 10 in `feed-controls-ux-plan.md`) is wired separately. A requirement counts as met only when its acceptance check passes. Follows the [interaction and lifecycle contract](interaction-lifecycle-contract.md).

## 1. The problem

A moderator browsing their community's feed can't tell which posts no moderator has looked at yet. Reddit lists them in the mod queue's **Unmoderated** tab, a separate tool with a different layout. The user wants a feed filter in the community itself: "show me only the posts nobody has approved yet". Since 2026-11-23 the user also wants it in communities they don't moderate: which recent posts are held by AutoModerator or Reddit's filters and not yet approved.

## 2. Parity target

| # | Capability | Reddit mod queue (Unmoderated) | Ours |
|---|---|---|---|
| P1 | List posts no moderator has approved or removed | Yes (`/mod/<sub>/queue`, Unmoderated) | **Yes** for moderators, from the same queue (`/r/<sub>/about/unmoderated.json`) |
| P2 | Shown inside the community feed | No, separate tool | **Yes**: Post type → Awaiting approval in the feed menu, or a standalone button for moderators when no menu is present |
| P3 | Held posts in a community you don't moderate | No | **Yes, best effort**: recent posts from Arctic Shift checked against Reddit's current state (needs Use the archive) |
| P4 | Approve, remove, spam actions | Yes | No (read-only; each row opens the post, where Reddit's own mod tools are) |
| P5 | Newest first, paged | Yes | Moderators: 100 per request, "Show more" until the queue ends. Others: one bounded check of the last 7 days |
| P6 | Comments in the queue | Yes (with "Comments" filter) | No: posts only (`only=links`) |

## 3. Behaviour

- **B1. Moderator check.** On a community feed (`/r/<sub>/`, `/r/<sub>/hot|new|top|rising/`), the extension asks Reddit, from the page world with the user's session, whether the signed-in user moderates `<sub>` (`/r/<sub>/about.json` → `user_is_moderator`; `null` there means signed out). The answer is kept in memory for this page load, for at most 10 minutes per community; a failed check is asked again after 30 seconds.
- **B2. The standalone control (moderators, no menu).** One button, "Not yet approved", right after Reddit's feed sort control (`shreddit-sort-dropdown`), with Reddit's own plain small-button classes (measured native: 32 px tall, pill radius, 12 px/600, `text-neutral-content-weak`). `aria-pressed` reflects the state; pressed it shows a check icon and the strong content colour. It is not rendered once the feed menu has registered (`RTUnapprovedFilter.useMenu(true)`, or the `data-rt-unapproved-menu` attribute on `<html>`, which also works before this script loads). Non-moderators never get the button; they reach the filter through the menu.
- **B3. Turning it on** writes `rt_mod=unapproved` to the address (one `replaceState`, never to the same URL, F3), hides Reddit's feed (`shreddit-feed`) and shows our list in its place: a summary line, a source note, then the posts as Reddit's search rows (community, time, author, title, votes, comments, thumbnail), then "Show more" when the mod queue has more.
- **B4. Moderator summary.** "N posts not yet approved in r/<sub>"; while loading "Loading…"; when the queue has more, "Showing the newest N · Show more". Empty: "No posts are waiting for approval in r/<sub>." Errors say what failed and offer Retry; a failed load never reads as an empty queue (R14). Source note: "From your mod queue".
- **B5. Turning it off** removes the parameter, removes our list and shows Reddit's feed exactly as it was (we never remove or reorder Reddit's cards).
- **B6. Settings.** Popup row "Awaiting approval filter" ("Show posts held for review and not yet approved in any community: your mod queue where you moderate, otherwise Arctic Shift (needs Use the archive).") in the "On Reddit" card, `modUnapprovedFilter`, on by default. Turning it off removes the button and the list from open tabs at once (T10). Turning **Use the archive** (`archiveDiscovery`) off removes a non-moderator's list at once.
- **B7. Source selection and the menu API** (`globalThis.RTUnapprovedFilter`):
  - `availability(subreddit?)` → `Promise<{available, source, reason?}>`: moderators `{available:true, source:'modqueue'}`; others with Use the archive on `{available:true, source:'archive'}`; Use the archive off `{available:false, source:'archive', reason:'archive-off'}` (the menu shows "Needs Use the archive"); signed out `{available:false, source:null, reason:'signed-out'}`; failed moderator check `{reason:'error'}`; setting off `{reason:'disabled'}`; not a community feed, or another community's name `{reason:'not-community'}`.
  - `active()` → whether `rt_mod=unapproved` is in the address.
  - `setActive(on)` → `Promise<boolean>`, the resulting state. On checks availability first and changes nothing when unavailable.
  - `onChange(fn)` → unsubscribe function. `fn({subreddit, active, available, source, reason?, pending?})` runs once per real change (route, check answer, settings, on/off).
  - `useMenu(on=true)` suppresses (or restores) the standalone button. `awaitingCategory(category)`, `NOTES`, `PARAM`, `VALUE`, `MENU_ATTR` are exported for the menu and tests. The page fires `rt-unapproved-ready` on `document` once the API exists.
- **B8. Archive source (non-moderators).** The newest posts of `<sub>` from Arctic Shift through the worker's existing `archive-search` path (`post-broker.js`: its single slot, cooldown, 429/5xx backoff, timeout, size bound and the Use the archive check): `posts/search?subreddit=<sub>&sort=desc&limit=100&after=<now − 7 days>`, paging backwards with the worker's `before` cursor, at most 3 pages, and stopping at the first post older than 7 days. After each page, Reddit's current state of those IDs is read in the page world with the user's session (`awaiting-status`: `/api/info.json?id=t3_a,t3_b,…&raw_json=1`, at most 100 IDs, each `^[a-z0-9]{1,10}$`, `credentials:'include'`, `redirect:'error'`). A post is awaiting approval when Reddit's `removed_by_category` is `automod_filtered` or `reddit`; `moderator`, `deleted`, `author`, any other category and none (approved or visible) are excluded. Rows use Reddit's current copy when it answers. A failure keeps what was already verified, and Retry resumes from the step that failed (the archive page is not read again).
- **B9. Archive summary.** Loading: "Checking recent posts in r/<sub>…". Results: "N posts held for review in r/<sub> in the last 7 days". Empty: "No posts are waiting for approval in r/<sub> in the last 7 days." A check that stopped short says so instead of "in the last 7 days": "only the newest 300 posts were checked; older posts from the last 7 days weren't", "the archive listing stopped early; older posts weren't checked", "K posts couldn't be checked with Reddit"; an empty but short check reads "No posts found waiting for approval in r/<sub> · …". Errors: "Couldn't check posts awaiting approval: <what failed>." with Retry. Source note: "Held for review and not yet approved (from Arctic Shift, last 7 days)". The list never says "complete".

## 4. Privacy and safety

- All Reddit reads happen in the page world with Reddit's own session (`credentials: 'include'`, same origin, `redirect: 'error'`), fixed paths, validated community names and IDs. The only other service is Arctic Shift, through the worker's existing opt-in archive path, and only with Use the archive on; it receives the community name and time bounds, nothing about the user. Nothing is stored: answers live only in the page's memory (and the worker's 30-second archive cache).
- Strictly read-only. The rows link to the posts; no approve, remove or report requests are made.

## 5. Requirements and acceptance checks

| ID | Requirement | Acceptance check |
|---|---|---|
| R1 | Standalone button only for moderators of this community, and only without a menu | A1: unit: `user_is_moderator:false`, HTTP 403 and network failure give no button; `true` gives one button after the sort control |
| R2 | Bridge reads only fixed same-origin paths for the current community | A2: unit: another community's name, invalid names, URLs or cursors are rejected before any fetch; the queue request is `/r/<sub>/about/unmoderated.json?limit=100&only=links&raw_json=1` |
| R3 | On shows the list in place of the feed; off restores the feed | A3: unit: native feed hidden while on, unhidden and our list removed when off; URL param written once (both sources) |
| R4 | Honest states | A4: unit: empty queue text, error text with Retry, "Show more" only with a cursor, repeated cursor stops with an error |
| R5 | Settings apply live | A5: unit: turning the setting off removes button and list and restores the feed; turning Use the archive off removes the archive list |
| R6 | Looks like Reddit's control | A6: L3 measured comparison with the native sort button (sizes, font, colour); **not verified** until the user's live session |
| R7 | Source chosen per community, with a reason when unavailable | A7: unit: moderator → `modqueue`; non-moderator → `archive`; archive off → `archive-off`; signed out → `signed-out`; failed check → `error`; setting off → `disabled`; other routes → `not-community` |
| R8 | Only held, not-yet-approved posts are listed | A8: unit: `automod_filtered` and `reddit` listed; `moderator`, `deleted`, `author`, other categories and null excluded |
| R9 | Bounded archive read | A9: unit: the read stops at the first post older than 7 days; at most 3 pages, each with `before` from the previous page and `after` = the cutoff; a capped check says so |
| R10 | Bounded, validated status reads | A10: unit: bridge rejects more than 100 IDs and anything other than bare base36 IDs before any fetch; one `/api/info.json` request with only `id` and `raw_json`; other communities' posts are dropped; HTTP 403/500 are errors |
| R11 | A failed or partial check never reads as empty or complete | A11: unit: archive and Reddit failures show the error and Retry; Retry resumes without re-reading the archive; IDs Reddit leaves out and a stalled cursor are stated |
| R12 | Reddit answers the status read for a signed-in reader | A12: L3 live read on a community the reader doesn't moderate; **not verified** (see L8) |
| R13 | The menu can drive it | A13: unit: `setActive` on/off, `onChange` notifications, `useMenu` and the `<html>` attribute suppress the button |

## 6. Transitions

| T | Transition | Expected |
|---|---|---|
| T1 | Direct load with `rt_mod=unapproved` | Feed hidden as soon as the source is known (moderator check, plus Use the archive for others), list loads; if no source is available, the parameter is ignored and Reddit's feed stays |
| T2 | Click a row | Normal Reddit navigation to the post; our list stays until Reddit swaps `main` |
| T3 | Back to the feed | Reddit rebuilds the page (F2); the parameter is in the address, so the list is rebuilt from the cached answer and the posts are read again (the list is not parked) |
| T5 | Change Reddit's sort while on | Reddit navigates to the new sort path without our parameter; the filter turns off and Reddit's feed shows |
| T7 | Reddit re-renders the feed header | The button is re-added next to the sort control in the next observer pass; its state comes from the address |
| T10 | Setting toggled | Applies to open tabs without reload (filter setting and Use the archive) |
| T11 | Account switch | Reddit reloads the page on an account switch, which drops the in-memory answer; the new account is checked again |
| T15 | Mobile layout | Through the feed menu; the standalone button only next to the mobile sort control when present |
| T16 | old.reddit.com | Off |

**Lifecycle audit.** Button: created and removed only by `RTUnapprovedFilter.sync()`; triggers: `MutationObserver` on the document, `popstate`, `reddit:route`, settings changes, `useMenu`. List container and the feed's hidden attribute: created and removed only by `mount()` / `unmount()`; triggers: button click, `setActive`, route change, settings change, destroy. `onChange` subscribers are dropped on destroy.

## 7. Where we lag

| # | Limit | What the user sees |
|---|---|---|
| L1 | No approve/remove buttons in the list | Rows open the post, where Reddit's mod tools are |
| L2 | Posts only; queued comments are not listed | Summary says "posts" |
| L3 | Back re-reads the list instead of restoring scroll | A short loading state after Back |
| L4 | The mod queue may change while reading (another moderator acts) | A post can appear twice or be missed across "Show more"; duplicates are dropped by ID |
| L5 | Arctic Shift ingests new posts with a lag (usually minutes, longer when it is behind) | The newest held posts may be missing; the note names Arctic Shift and the list says "held for review", never complete |
| L6 | Posts removed or filtered before Arctic Shift ingested them are not in the archive at all | They can't be listed; same note |
| L7 | Reddit's spam filter (`reddit`) also holds posts no moderator will ever review, and busy communities can post more than 300 posts in 7 days | They are listed as held; a capped check says only the newest 300 were checked |
| L8 | Reddit has refused `/api/info.json` on www.reddit.com with the session (HTTP 403, measured 2026-11-15 and 2026-11-20 in other features) | If it still does, non-moderators see "Couldn't check posts awaiting approval: Reddit refused the post status check (HTTP 403)." with Retry, never an empty list. Live behaviour is unverified (A12) |
