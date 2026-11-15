# Spec: bulk redaction of your own posts and comments

Status: implemented 2026-11-14 from logic and synthetic tests only (`extension/redaction-model.js`, `extension/redaction-ui.js`, bridge actions `redact-identity`, `redact-list`, `redact-item`). **Never run against a real account by the agent** (user instruction, 2026-11-13); the user tests it (§8). Follows the [interaction and lifecycle contract](interaction-lifecycle-contract.md).

## 1. The problem

Redact.dev lets people bulk delete their Reddit history, overwriting the text first so archives that re-crawl see the overwrite rather than the original. The user wants the same inside Reddit, decided 2026-11-14: **choose overwrite text, delete, or overwrite then delete**. The combined action remains the default.

## 2. Parity target

| # | Capability | Redact.dev (Reddit) | Ours |
|---|---|---|---|
| P1 | Bulk delete your posts and comments | Yes | **Yes** |
| P2 | Overwrite text before deleting | Yes (random or custom text) | **Yes**, custom text (default given); posts without text are deleted only |
| P3 | Filter by type, date, community, score, keyword | Yes | **Yes**: type, older than N days, date range, only/never these communities, keep score ≥ N, only items containing, keep items containing |
| P4 | Keep specific items | Yes (whitelist) | **Yes**: paste links or IDs |
| P5 | Preview before running | Yes | **Yes, required**: the run uses exactly the previewed set |
| P6 | Reach past Reddit's 1,000-item listing limit | Partly (multiple sorts) | **Yes, partly**: newest, top and controversial lists of posts and comments are combined; the preview says how many were found and that older items may be missing |
| P7 | Backup before deleting | Export | **Yes**: "Download a copy" (JSON of the previewed items) |
| P8 | Scheduling, other sites | Yes | No |
| P9 | Runs on their servers with your token | Yes | **No**: runs in your Reddit tab with Reddit's own session; nothing leaves the browser |

## 3. Behaviour

- **B1. Entry.** The popup's Home tab has a Redaction card; its "Start redaction" opens `#rt-redact` on the active Reddit tab, or `/user/me/#rt-redact` in a new tab when outside Reddit; on any Reddit page that address fragment opens the dialog (and is removed from the address). The dialog is Reddit's `rpl-modal-card`, as in the raffle.
- **B2. Identity.** The dialog first confirms the signed-in account in the page world (`/api/me.json`). Signed out → "Sign in to Reddit to redact your posts and comments." The modhash Reddit needs for writes stays in the page world and is never sent to the extension's other scripts.
- **B3. Find (dry run).** "Find matching items" reads your own lists (the signed-in native profile newest-first; unbounded scans also try legacy top and controversial lists), up to 10 pages per source, with progress and explicit limit reporting. The preview shows: "N items match (P posts, C comments) out of M found", the oldest date reached, all matches in a separate scrollable review screen, loaded into the DOM in batches of 50 (type, community, date, score, text, link), individual selection, select/deselect all, and "Download a copy" for the selected items. Filters reuse the shared community picker, icon menu rows and calendar. Content type, date and include/exclude community controls share a 40px height. Only one anchored popover opens at a time; Escape and outside interaction dismiss it, keyboard arrows navigate rows, and dates open outside the form layout within the modal. Include/exclude selectors remain independent and accept exact community names. The vote threshold protects items with that many votes or more, with a concrete example and empty meaning no vote protection. Filters are grouped into Find items, Keep items safe, and Replacement text. A bounded date range uses only the relevant native newest-first feed (Overview, Posts or Comments) and stops after passing the start date, ignoring older pinned items for this decision. It never starts score-sorted scans. Unbounded scans also attempt score-sorted lists for deeper coverage; a failed source or later page preserves the items already found and explicitly labels the review and confirmation incomplete. Irrelevant post/comment sources are skipped. Each discovery starts fresh; reached page limits are reported. Changing any rule clears the preview.
- **B4. Confirm.** "Review N selected items" opens a separate confirmation screen showing the account, selected post/comment counts and replacement text. Back returns to the selection; a new confirmation always clears the typed phrase. The run button stays disabled until you type `overwrite N` for overwrite-only, or `delete N` for either deletion action (N = the selected count). The button and summary identify the chosen action; delete-only hides the replacement message.
- **B5. Run.** Items are processed one at a time, oldest first, using the chosen action: overwrite only, delete only, or overwrite then delete. Overwrite-only excludes items without editable text and never sends a delete; delete-only never sends an overwrite. The combined action overwrites comments and text posts with text before deleting, and deletes textless posts directly. At most one write per 1.1 s; HTTP 429 waits for `Retry-After` (at most 5 minutes); three failures in a row stop the run. Progress: "Done X of N · F failed · about M min left", with Stop. Closing the dialog stops after the current request.
- **B6. Result.** "Deleted X of N. F failed." Failures list each item's link and Reddit's reason. Overwritten-but-not-deleted items are listed separately ("Text overwritten, delete failed").
- **B7. Ownership guard.** The page bridge writes only to items it read itself from the signed-in account's own lists during this page's life, and re-checks the signed-in name at the start of each run. Any other ID is refused before a request.

## 4. Requests (page world, same origin, Reddit's session)

| Step | Request | Notes |
|---|---|---|
| Identity | `GET /api/me.json` | Name and modhash (kept in the page world) |
| Native newest-first | Reuse loaded own-profile cards, otherwise `GET /user/<you>/{submitted,comments}/?sort=new` (Overview omits the final path segment), then Reddit’s supplied `/svc/shreddit/profiles/profile_…-more-posts/new/` continuation | Same-origin, signed-in, read-only; parsed authored metadata registers allowed IDs; no scrolling/navigation |
| Legacy deeper lists | `GET /user/<you>/{submitted,comments}.json?sort=…&limit=100&after=…` | Unbounded scans only; source failures preserve previous matches |
| Overwrite | `POST /api/editusertext` `thing_id`, `text`, `api_type=json`, header `X-Modhash` | Comments and self posts with text |
| Delete | `POST /api/del` `id`, header `X-Modhash` | Every item |

**Unverified (no live test allowed):** whether `www.reddit.com` still accepts these legacy write endpoints with cookie + modhash. If it doesn't, each item fails with Reddit's HTTP status and the run stops after three failures; nothing is reported as deleted unless Reddit answered success.

## 5. Requirements and acceptance checks (synthetic)

| ID | Requirement | Acceptance check |
|---|---|---|
| R1 | Filters select exactly the stated items | A1: unit, every rule and combination |
| R2 | The run uses exactly the previewed set and needs the typed confirmation | A2: unit |
| R3 | Pacing, 429 back-off, stop after three failures, Stop button | A3: unit with a fake clock |
| R4 | Ownership guard | A4: unit: unread IDs, another account, missing modhash are refused before any write |
| R5 | Overwrite only where there is text; delete always; success only on Reddit's success | A5: unit on the bridge with a fake `fetch`, including `json.errors` |
| R6 | Honest reporting | A6: unit: partial failures, overwritten-not-deleted, stop |

## 6. Transitions

| T | Transition | Expected |
|---|---|---|
| T1 | Load with `#rt-redact` | Dialog opens once; the fragment is removed with one `replaceState` |
| T8 | Escape, Cancel, close button, backdrop | Closes. During a run, the first close asks "Stop the run and close?" in the status line; a second close stops after the current request and closes |
| T10 | Setting off | The popup entry is hidden; an open dialog stays until closed |
| T11 | Account switch | The bridge's allow-list belongs to the page; Reddit reloads on account switch, so it's empty for the new account |
| T12 | Extension reloaded mid-run | The run stops (the content script dies); items already processed stay processed; reopening shows the remaining items in a new preview |

## 7. Where we lag

| # | Limit | What the user sees |
|---|---|---|
| L1 | Reddit listing limits and a 10-page per-source scan cap | "Found M items; Reddit may not list older ones" |
| L2 | No scheduling | — |
| L3 | Archives that already captured the original keep it | Stated in the dialog's intro |
| L4 | Media in posts isn't overwritten (only text) | Posts without text are deleted only, stated in the preview |
| L5 | Write endpoints unverified live | The first failure shows Reddit's reason |

## 8. How the user tests it (dry run first)

1. Reload the extension, open the popup’s Home tab and choose "Start redaction" on the Redaction card.
2. Set a narrow filter (for example one community and an old date range) and choose "Find matching items". Check the preview and "Download a copy".
3. Select a small set of test items, choose "Review N selected items", and type `delete N` for a small N (1–2 test items you made for this), run, and confirm on Reddit that the items show the overwrite text and then `[deleted]`.

Default overwrite text: “This comment has been redacted by Reddit Tweaks.” These words remain editable before discovery.

Follow-up (0.34.2): native discovery supports posts on the authenticated author’s profile (`/user/<you>/comments/…`, community `u_<you>`) as well as `/r/…` posts. Unreadable individual cards are counted and excluded from the write allow-list without discarding other readable items; review and confirmation disclose incomplete discovery. Layout resets Reddit’s inherited input/textarea block margins, uses explicit full-width text fields to fill odd grid rows, and caps community menus at 256px width with a 160px scrolling list and compact 40px rows.

## 0.35.0 review and suggestion follow-up

- Long comments and post bodies expand the existing excerpt in place, with Read less to collapse; there is no second copy of the text.
- The scrollable review appends more rows near its end (IntersectionObserver plus a scroll fallback), preserves selected/deselected items that are not rendered yet, and has no Show next button. No existing rows are unloaded. Observers disconnect on reset and close.
- The shared community selector first offers authored activity from the signed-in native profile and already loaded profile counts. When Arctic Shift is enabled, it also reuses the existing post/comment subreddit aggregates; opted-out users send no aggregate requests. Typing adds debounced native Reddit `/svc/shreddit/search-typeahead` community matches. Exact names remain selectable and stale responses never replace a newer query. Clear returns to activity suggestions.
- Native suggestion results are held only in page memory, scoped to the verified account and query for five minutes (bounded to 50 entries). The archive helper retains its existing ten-minute cache. Failed native profile reads are not cached and can fall back to archive suggestions. Suggestions do not register writable IDs, fetch modhashes or start full redaction discovery.
- Replacement message is an editable textarea prefilled with “This comment has been redacted by Reddit Tweaks.” Changing it after review invalidates the review. Confirmation provides an editable message for actions that overwrite; final-step edits preserve the selected set, update the setup textbox and clear the typed confirmation. Empty or oversized messages block the run; the editor locks while writes are in progress.
- Successful writes invalidate native-DOM reuse for subsequent discovery, so a new scan reads updated data. Closing a run aborts subsequent steps after the in-flight request even on browsers without AbortSignal.any.

## 0.35.1 review follow-up

Matched Posts and Comments appear in separate labelled sections, each with selected counts and its own scroll continuation. Global select/deselect still spans both, and execution keeps the original oldest-first order. Every row reuses the shared 24px community icon with its cached image or themed fallback; icons load as their rows approach view. Old observers disconnect on reset and close. A single nonempty section retains the larger list area; mixed sections are capped so both remain reachable. Confirmation message edits are supported directly, preserve navigation state and require the typed phrase again.

## 0.35.2 confirmation action switch

The confirmation screen can switch between Overwrite text, Delete, and Overwrite, then delete. Overwrite-only removes selected items without editable text from the run; other modes keep the reviewed selection. The typed phrase, primary label, summary and replacement editor follow the chosen action, and message edits persist across switches.

## 0.36.0 styled confirmation action and header

The confirmation step's Action is the same menu control and icon menu as step 1 (no native select); its value is kept outside the filter form, so switching it never clears the reviewed selection, and focus returns to the control. Step 1's Action and Content type controls show the chosen value's icon. The header shows the step as a kicker with a three-part progress bar above an 18/24 title, with tighter spacing around the header, body and footer. The calendar's quick ranges are no longer forced to wrap in this dialog: they scroll sideways like everywhere else.

The popup itself was reorganised in 0.36.0: Home (Redaction and Raffles cards, a features-on summary with Manage), Settings (Browsing, Tools and Arctic Shift archive groups, each counting what is on) and Data (saved chat history). Every tab has the same fixed height (longer tabs scroll with no visible scrollbar), so the popup never changes size. The last tab is remembered; touch screens get a fluid width and 44 px targets.
