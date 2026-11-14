# Spec: "Not yet approved" filter for moderators

Status: implemented 2026-11-14 (`extension/unapproved-filter.js`, bridge actions `mod-status` and `unapproved`, tests in `tests/unapproved-filter.test.cjs`); A1–A5 pass, A6 not verified live yet. A requirement counts as met only when its acceptance check passes. Follows the [interaction and lifecycle contract](interaction-lifecycle-contract.md).

## 1. The problem

A moderator browsing their community's feed can't tell which posts no moderator has looked at yet. Reddit lists them in the mod queue's **Unmoderated** tab, a separate tool with a different layout. The user wants a feed filter in the community itself: "show me only the posts nobody has approved yet".

## 2. Parity target

| # | Capability | Reddit mod queue (Unmoderated) | Ours |
|---|---|---|---|
| P1 | List posts no moderator has approved or removed | Yes (`/mod/<sub>/queue`, Unmoderated) | **Yes**, from the same queue (`/r/<sub>/about/unmoderated.json`) |
| P2 | Shown inside the community feed | No, separate tool | **Yes**, a filter button next to the feed's sort control |
| P3 | Only for moderators of that community | Yes | **Yes**: the button appears only when Reddit says you moderate it |
| P4 | Approve, remove, spam actions | Yes | No (read-only in v1; each row opens the post, where Reddit's own mod tools are) |
| P5 | Newest first, paged | Yes | **Yes**, 100 per request, "Show more" until the queue ends |
| P6 | Comments in the queue | Yes (with "Comments" filter) | No: the filter is for the post feed, so it asks for posts only (`only=links`) |

## 3. Behaviour

- **B1. Who sees it.** On a community feed (`/r/<sub>/`, `/r/<sub>/hot|new|top|rising/`), the extension asks Reddit, from the page world with the user's session, whether the signed-in user moderates `<sub>` (`/r/<sub>/about.json` → `user_is_moderator`). The answer is kept in memory for this page load, for at most 10 minutes per community. Non-moderators, signed-out users and failed checks see nothing, and Reddit's page is unchanged.
- **B2. The control.** One button, "Not yet approved", placed right after Reddit's feed sort control (`shreddit-sort-dropdown`), with Reddit's own plain small-button classes (measured native: 32 px tall, pill radius, 12 px/600, `text-neutral-content-weak`). `aria-pressed` reflects the state; pressed it shows a check icon and the strong content colour.
- **B3. Turning it on** writes `rt_mod=unapproved` to the address (one `replaceState`, never to the same URL, F3), hides Reddit's feed (`shreddit-feed`) and shows our list in its place: a summary line, then the posts as Reddit's search rows (community, time, author, title, votes, comments, thumbnail), then "Show more" when the queue has more.
- **B4. Summary.** "N posts not yet approved in r/<sub>" while loading shows "Loading…"; when the queue has more, "Showing the newest N · Show more". Empty: "No posts are waiting for approval in r/<sub>." Errors say what failed and offer Retry; a failed load never reads as an empty queue (R14).
- **B5. Turning it off** removes the parameter, removes our list and shows Reddit's feed exactly as it was (we never remove or reorder Reddit's cards).
- **B6. Settings.** Popup row "Not yet approved filter (moderators)" in the "On Reddit" card, on by default. Turning it off removes the button and the list from open tabs at once (T10).

## 4. Privacy and safety

- All Reddit reads happen in the page world with Reddit's own session (`credentials: 'include'`, same origin, `redirect: 'error'`), fixed paths, validated community names. Nothing is sent anywhere else, and nothing is stored: the moderator answer lives only in the page's memory.
- Strictly read-only. The rows link to the posts; no approve, remove or report requests are made.

## 5. Requirements and acceptance checks

| ID | Requirement | Acceptance check |
|---|---|---|
| R1 | Button only for moderators of this community | A1: unit: `user_is_moderator:false`, HTTP 403 and network failure give no button; `true` gives one button after the sort control |
| R2 | Bridge reads only fixed same-origin paths for the current community | A2: unit: another community's name, invalid names, URLs or cursors are rejected before any fetch; the queue request is `/r/<sub>/about/unmoderated.json?limit=100&only=links&raw_json=1` |
| R3 | On shows the queue in place of the feed; off restores the feed | A3: unit: native feed hidden while on, unhidden and our list removed when off; URL param written once |
| R4 | Honest states | A4: unit: empty queue text, error text with Retry, "Show more" only with a cursor, repeated cursor stops with an error |
| R5 | Settings apply live | A5: unit: turning the setting off removes button and list and restores the feed |
| R6 | Looks like Reddit's control | A6: L3 measured comparison with the native sort button (sizes, font, colour); **not verified** until the user's live session |

## 6. Transitions

| T | Transition | Expected |
|---|---|---|
| T1 | Direct load with `rt_mod=unapproved` | Feed hidden as soon as the moderator check passes, list loads; if the check fails, the parameter is ignored and Reddit's feed stays |
| T2 | Click a row | Normal Reddit navigation to the post; our list stays until Reddit swaps `main` |
| T3 | Back to the feed | Reddit rebuilds the page (F2); the parameter is in the address, so the list is rebuilt from the cached answer and the posts are read again (v1 does not park the list) |
| T5 | Change Reddit's sort while on | Reddit navigates to the new sort path without our parameter; the filter turns off and Reddit's feed shows |
| T7 | Reddit re-renders the feed header | The button is re-added next to the sort control in the next observer pass; its state comes from the address |
| T10 | Setting toggled | Applies to open tabs without reload |
| T11 | Account switch | Reddit reloads the page on an account switch, which drops the in-memory answer; the new account is checked again |
| T15 | Mobile layout | Same button next to the mobile sort control when present; otherwise not shown (stated limit) |
| T16 | old.reddit.com | Off |

**Lifecycle audit.** Button: created and removed only by `RTUnapprovedFilter.sync()`; triggers: `MutationObserver` on the document, `popstate`, `reddit:route`, settings changes. List container and the feed's hidden attribute: created and removed only by `mount()` / `unmount()`; triggers: button click, route change, settings change, destroy.

## 7. Where we lag

| # | Limit | What the user sees |
|---|---|---|
| L1 | No approve/remove buttons in the list | Rows open the post, where Reddit's mod tools are |
| L2 | Posts only; queued comments are not listed | Summary says "posts" |
| L3 | Back re-reads the queue instead of restoring scroll | A short loading state after Back |
| L4 | The queue may change while reading (another moderator acts) | A post can appear twice or be missed across "Show more"; duplicates are dropped by ID |
