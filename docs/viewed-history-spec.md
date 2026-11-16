# Viewed-posts History beyond Reddit's limit (2026-11-17)

User request: Reddit's History has a limit; make it customizable, including no limit. User decisions: the longer History appears both in the profile's History tab and in List → History search; the default stays Reddit's own limit.

## Measured

Live, read-only (signed-in account): `/user/<you>/history/` serves Reddit's most recently viewed posts with no continuation partial. The page has no `more-posts` link, so Reddit keeps no longer list to page through (10 unique posts parsed on the day; the extension previously said "~20"). Going past it needs the extension's own record of posts you open.

Post pages carry `shreddit-app[logged-in-user-id]` but no username (the user-drawer partial has only `prefix/subreddit/postId`). Content scripts cannot read `chrome.storage` (restricted to trusted contexts); settings come from the worker (`get-settings`) and changes are pushed (`settings-changed`).

## Setting

`historyLimit` in `rt-settings-v1`: 20 (Reddit's own, default: nothing recorded), 100, 500, 1000, 5000, 0 (no limit). Anything else normalizes to 20. Popup: "History length" under "Profile search & hidden activity" (shown only while it is on). The manifest adds `unlimitedStorage` (no install warning) so "No limit" is not capped by the 10 MB extension storage quota.

## Recording

`viewed-history.js` (isolated content script): when the limit is above 20 and the page is a post page, the `shreddit-post` whose ID is the post in the address bar (never feed or related cards) is sent once per visit to the worker: ID, title (≤300), community, author, link, created, post type, score, comment count, NSFW/spoiler. A later visit records it again (newest view wins). Signed out, at 20, or off a post page: nothing.

`viewed-broker.js` (worker): `record` only from this extension's top-level https Reddit pages, keyed by the page's logged-in account ID; `load` only for the account verified in that tab (the removal broker's native identity check). `viewed-store.js`: IndexedDB `rt-viewed-history`, one record per account ID and post, trimmed to the limit after each record. Setting the limit to 20 deletes all recorded views; lowering it trims each account to the new limit.

## Display

- List → History search and the profile History tab show Reddit's own recent views first, in Reddit's order, then recorded views newest first, without repeats, up to the limit in total. Recorded rows use the stored facts; search matches them by title.
- Above 20, `/user/<you>/history/` is drawn by the extension like Removed (section `list:'history'`), hiding Reddit's feed; History stays the selected tab (Removed is never painted selected). Cards are Reddit's own, drawn 25 at a time as you scroll (each card is a Reddit read).
- At 20, nothing recorded is read and History is Reddit's own page and list, as before.
- Changing the limit on the History page swaps between Reddit's tab and the extension's at once.

## Transitions

| | Transition | Expected |
|---|---|---|
| T1 | 20 → 1,000 on the History tab | Extension section replaces Reddit's feed at once; Reddit's recent views shown first |
| T2 | 1,000 → 20 | Recorded views deleted; Reddit's own History tab returns at once |
| T3 | Open a post, then another, then the first again | Three records; the first moves back to the top |
| T4 | Scroll to the end of a long History | 25 more cards per approach to the end, until all are shown |
| T5 | Signed out / other account | Nothing recorded or shown for another account |

## Live check (2026-11-17)

Opening the post already at the top of Reddit's History recorded it (title, community, 136 votes, 103 comments, video) under the account ID. With 25 older views seeded from the account's own posts, the History tab showed Reddit's 10 recent views first, then the older ones (34 without repeats). It drew 25 native cards, then the remaining 9 on scrolling. Setting the limit back to Reddit's 20 deleted every recorded view and restored Reddit's own History tab (10 native cards).

## Limits

Only posts opened in this browser profile are recorded; views on other devices or before the setting was raised are not. Recorded vote and comment counts are as of the view. Reddit's own list order is kept for its recent views; recorded views carry no Reddit-side timestamp, so they follow after Reddit's list.

## Follow-up: limit changes and themed popup picker (2026-11-17)

User reports changing the limit does not change the number shown and the browser-default select is out of theme. Test before implementation: custom menu uses the existing popup theme, selected radio/check state, keyboard navigation, Escape/outside dismissal and no popup resize; failed storage writes restore the saved value and remain retryable. Existing recorded History reloads immediately when the limit changes, including from native default to custom, and still loads cards progressively. A higher cap never invents past visits: wording distinguishes retention capacity from currently available entries.

Recorder lifecycle: after switching to Reddit's default (which clears recorded views), enabling recording again on the same post must record it again; switching accounts on the same post must use the new account; failed/rejected writes must not permanently mark the visit recorded. One in-flight write per visit, bounded retries, stale completions ignored; turning profile discovery off stops recording. No retroactive crawler, extra Reddit/Arctic Shift reads or unverified claims of complete history. Use the popup's existing colors/borders/radii for both color schemes; menu opens as an overlay rather than changing the panel height. Any live inspection remains read-only; resetting real History is not part of verification.

User clarification: preserve the native recent History already available when enabling the longer limit, and make post → profile → History work without reload. Seed missing native recent rows into the account's local store when extended History opens (including an already-open History when enabled), without overwriting real recorded visits or inventing actual view timestamps; older visits Reddit no longer serves remain unrecoverable. Record a visible post promptly and before link navigation, observe native hydration attributes, and invalidate the visit on non-post routes. A completed parked History refreshes its native recent list/local entries when revisited rather than showing a stale completed snapshot. Tests cover seeding/idempotence/account guards, SPA navigation/hydration and parked-view return. No real History clearing during verification.

Seeded rows carry an internal ordering key and `seeded:true`, not a claimed exact visit time; a real later visit replaces that marker. Seed/load errors keep native recent rows visible and explicitly mark History incomplete rather than silently declaring success.
