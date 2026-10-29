# Reddit Tweaks — improvement plan (review of 0.20.11–0.20.12, October 2026)

How this was produced: six read-only reviews covering chat search, the data/network layer, popup and tooling, profile discovery, post-page restoration, and the calendar UI. A separate pass then checked every finding against the code; many were reproduced with small jsdom scripts. Refuted findings were dropped; they are listed at the end. Line numbers drift, so each item names the function.

Sizes: **S** is under an hour, **M** is a focused session, **L** is a multi-session refactor.

Already fixed during the review:
- 0.20.12: park/adopt left queued renders stuck, dropped retries, kept stale busy flags, and never restarted an interrupted first load while showing "Activity checked".

---

## Phase 1 — correctness and honesty (do first; mostly S)

| # | Problem | Where | Size |
|---|---|---|---|
| 1.1 | **Chat directory can lock itself out indefinitely.** `traffic-cooldown` accepts any finite `until`, persists it as `rcs-request-cooldown-v1:<owner>`, and Clear does not remove it. A huge `Retry-After` (or a page script) blocks directory loading until storage is wiped. Reproduced. | `cache-broker.js` traffic-cooldown; `page-bridge.js` Retry-After handling | S: clamp to now+1h, ignore past values, clear on Clear |
| 1.2 | **A single malformed archived comment stops restoration for its whole batch.** `flush()` applies records in one loop with no try/catch; `markdown-lite.render` recurses without a depth limit (`'>'×9000` throws RangeError, reproduced). Skeletons and hidden avatars then stay up. | `thread-restore.js` flush/apply; `markdown-lite.js` render | S |
| 1.3 | **Restored comments show spoilers in plain text** and miss Markdown styling: `.rt-spoiler` is styled only under `.rt-recovered-md`, which comment bodies don't carry. | `thread-restore.js` apply; `post-discovery.css` | S |
| 1.4 | **Restoration disappears when Reddit re-creates a comment** (load more replies, collapse/expand, edit). Records are applied once and discarded; the re-created element is skipped as already requested. | `thread-restore.js` scan/flush | M: keep a bounded `records` map and re-apply synchronously |
| 1.5 | **Comment and post placeholder checks differ.** An archive body equal to a Reddit notice ("Comment deleted by user", "[ Removed by Reddit ]") is shown as "restored text"; "[ Removed by Reddit ]" comments aren't detected. The notice regex is copied in three files. | `thread-restore.js`, `profile-notice.js`, `post-model.js` | S: one shared `noticeStatus` |
| 1.6 | **Hidden filter makes false claims.** Items older than the part of the feed Reddit has loaded are shown with "Not shown in this profile feed"; the All filter correctly defers them. Reproduced. | `post-discovery.js` deduplicate `older`, matchesActivity | S |
| 1.7 | **Transient archive failure during recovery is permanent.** Ids are marked checked before the request, and a failure shows a red banner instead of the quiet backoff note. During maintenance windows the text is never restored. | `post-discovery.js` scheduleRecovery, reply enrichment, verification | S |
| 1.8 | **Nested deleted replies show Reddit's notice beside our skeleton.** `:not(shreddit-comment[data-rt-settled] *)` fails under a settled parent. | `post-discovery.css` pending rules | S: hide the notice through its own attribute |
| 1.9 | **Pending skeletons can last 15–90 s** on retries, with the identity hidden and no CSS fail-safe. | `thread-restore.js` retry, `profile-notice.js` prepareComments | S: cap the visible pending state at ~5 s, retry silently, CSS reveal fallback |
| 1.10 | Post-page `archive-ids` lookup has no retry; avatar failures are cached as "no avatar" for the session. | `thread-restore.js` restorePost, lookup | S |
| 1.11 | `postStatuses` survive Refresh, so a re-approved item keeps a "Removed" cue. | `post-discovery.js` loadReddit | S |
| 1.12 | Settings changes reset discovery twice (storage event plus worker message), even when nothing changed. | `post-discovery.js` onSettings | S |
| 1.13 | Status wording over-claims: "Removed by moderators" also covers admin, spam-filter and crowd-control removals. Archive-only items with unknown status get the trash icon. | `thread-restore.js`, `post-discovery.js` indicator | S |
| 1.14 | Popup: a failed save reverts the switch but not the dependent-row dimming; Clear saved usernames has no in-flight state; a settings read error shows the switches as off. | `popup.js` | S |
| 1.15 | Chat: `historyMeta.complete !== false` fails open; global search shows no "saved messages only · may be incomplete" note. | `content.js`, `search-core.js`, `unified-search.js` | S |
| 1.16 | Stray `)` makes the `.rt-posts` idle-margin rule invalid, so it is dropped. | `post-discovery.css` (~line 81) | S |

## Phase 2 — calendar redesign (requested)

Audit harness with screenshots: `artifacts/research/calendar-audit/` (git-ignored). `shot.sh <name> <w> <h> "<query>"` renders scenes such as `room-default`, `room-range`, `global-range` and `month-menu`, with `mode=compact`, `theme=dark` and `measure=1`.

**Problems seen:**
- Text is 9–11 px, and cells are 33×26 px (23 px high in floating chat).
- The header has four rows: mode tabs, chips, the month bar, and a stray instruction line between the month and the weekdays.
- A selected range shows as broken pale tiles: the 8% tint is nearly invisible.
- Keyboard focus looks the same as "in range", and a selected day shows no focus at all.
- The today marker and the saved-messages marker are tiny and can't both appear on one day.
- Narrow widths clip the month name, presets, "Between" and Apply.
- Quick ranges are hidden behind an unlabelled footer button, and room and global searches offer different preset sets.
- Clear commits immediately, sitting next to a draft-only Apply.
- The day grid isn't an ARIA grid, and the month/year buttons announce "Calendar month" rather than "October".

**Target design:**
- **Layout:** one calendar, one selection model and one status line, about 288 px wide (264 px in floating chat):
  1. A segmented On / Before / After / Between control, with no orange.
  2. One wrapping chip row. Room keeps its 4 presets; global adds This month, Last month and This year. The Quick ranges sub-view goes away.
  3. `‹  October 2026 ▾  ›` with SVG chevrons.
  4. 12 px weekday headers.
  5. 32 px square, circular day cells, always reserving six rows so changing month never resizes the popover.
  6. A footer with a live status line, Clear (ghost button) and Apply (filled).
- **Range and markers:**
  - A selected range is a continuous band with rounded ends that wraps across rows.
  - Today is a 1 px ring; saved messages is a muted dot. Both can appear together.
- **Focus and colour:**
  - Focus is a `2px var(--rcs-focus)` outline, matching the rest of the extension.
  - Orange is used only for the selected endpoints and Apply. Colours come from Reddit's own variables, with a visible border and shadow in dark mode.
- **Accessibility:**
  - The days form an ARIA grid (`role=grid/row/gridcell`): weekday column headers, `aria-selected` on selected days, `aria-current="date"` for today, and focusable `aria-disabled` days.
  - Every accessible name includes the visible text.
  - Day names include today, saved messages and range position.
- **Keyboard:** the WAI-ARIA date-picker keys, plus Shift+PageUp/Down for the year.
- **Behaviour:**
  - Global search excludes future days, like room search.
  - Clear reads "Clear filter" when a filter is applied.
  - Apply explains why it's disabled.

**Implementation**, in one focused pass (M):
1. Rewrite the `DatePicker.styles` CSS.
2. Restructure `render()`: roles, glyphs, footer status, and removing the quick chooser.
3. Extend the keyboard model.
4. Update the date-picker, room-search-flow, unified-extension-ui, history and global-search-ui tests, and add accessibility tests.

Keep the existing DOM hooks: `.date-popover`, `.calendar-grid`, `[data-date]`, `.selected`, `.range`, `.has-messages`, `[data-mode]`, `[data-preset]`, `.calendar-month`, `.calendar-year`, `.calendar-apply`, `.calendar-clear`, `.calendar-summary` and `.calendar-instruction`. Afterwards, re-shoot every scene and check that `measure=1` reports no overflow and nothing under 12 px.

## Phase 3 — performance

**Profile discovery** (measured in jsdom: 200 cards took 5.9 s, 400 took 35 s, so the cost grows faster than the card count):
- 3.1 **Memoise the feed model.** Cache `nativeEntries()` and `visibleIds()` per change, and add `entryByFullname` and placeholder-to-card maps. Scope `visibleIds` to the feed rather than the whole document; today a matching card elsewhere on the page hides a search hit. (M)
- 3.2 **Make `deduplicate()` linear.** Use those maps plus a single merge pass over the two sorted lists. It is currently O(cards × entries) per call. (M)
- 3.3 **Stop full reconciles on unrelated mutations.** The page-wide observer and the "nothing changed" path of `scan()` should only compare the identities of route, `main`, feed and dropdown; `deduplicate` should run only from the feed observer. (S–M)
- 3.4 **Skip repeated work in `render()`.** Normalise records once when they arrive and re-decorate only cards whose status signature changed. (M)
- 3.5 **Remove smaller hot-path costs:**
  - `ownsMutation` should recognise placeholders; `slot.hidden` should only be written when it changes.
  - Whole-feed `querySelectorAll` and computed-style walks should only check direct children.
  - `communityAvatar` should be cached.
  - The verify queue needs a Set, and `publicationFloor` should be computed once per pass.
  - Negative `domStatus` results should be cached.
  - The bridge `syncFeed` should read once, then write once. (S each)
- 3.6 Card/Compact view changes are part of the data key, so switching layout refetches everything. (S–M)

**Chat search:**
- 3.7 **Stop scanning every Reddit page.** `page-bridge.js` scans every `div` every 1.5 s, in every frame, on every Reddit page, and content-side refresh has a heartbeat plus a page-wide observer even with no chat open. Run these only when a chat shell exists. (S)
- 3.8 **Make search cheaper.** Each keystroke reads and rebuilds every saved message (`getAll` + `materialize` before `match`); summaries repeat the full read. Prefilter on text before materialising, or keep a per-account in-memory projection. (M)
- 3.9 **Stop re-reading the open room.** Every ingest into the open room re-reads it in full (`limit: Infinity`). Debounce it and read incrementally. (M)
- 3.10 **Stop rewriting whole rooms.** Each ingest rewrites the whole room row, including the full ledger and a JSON size pass. Store one record per event plus a small summary. (L)
- 3.11 Directory loading checkpoints the whole directory on every progress page (O(n²) writes); the speaker map is rebuilt from the whole index on every upsert. (M / S–M)

## Phase 4 — privacy and security hardening

- 4.1 The directory `bootstrap` sends **every account's** conversation directory to every frame on every Reddit page. Fetch only the signed-in account, lazily. (S–M)
- 4.2 Recent search strings (`rcs-unified-recent:<owner>`) survive "Clear saved messages". (S)
- 4.3 Clear buttons wipe all accounts on the device without confirmation, while the info panel says the cache is account-scoped. Add a confirmation and make the wording match. (S)
- 4.4 Revalidate the archived-author avatar URL in the content script (https, allowlisted host). Page-world responses on document events can be spoofed. (S)
- 4.5 `markdown-lite.fromHtml` passes the text of SVG/MathML `<style>`/`<script>` and of `<title>` through as junk text (reproduced; nothing executes). Compare `localName`, drop foreign namespaces, and drop the text of raw-text elements. (S)
- 4.6 `archive-view.image()` builds `aspect-ratio` from unvalidated strings. Require positive integers. (S)
- 4.7 Cap server cooldowns in the archive broker (1 h, like the bridge), persist the Arctic Shift backoff across service-worker restarts (`storage.session`), and release the transport slot before comment-title lookups. (S each)
- 4.8 Use a per-page nonce channel for chat-capture bridge events. Today the owner check limits forgery to the signed-in account. (M)
- 4.9 Dev tooling: `scripts/live/relay.mjs` accepts any local POST. A web page could drive the approved browser while it runs. Require a per-run token, check Host and Origin, catch bad JSON, and exit when idle. `npm run preview` serves the repo root, including `.git`. (S each)

## Phase 5 — simplification and structure

- 5.1 **Delete dead code in `post-discovery.js`:**
  - `nativeObserver`, the `batchedProfile`-false paths, `archiveButton` and write-only fields.
  - The post-detail path. It can't run in production, because the post-page module is always loaded; prune its tests too.
  - On post pages, the restoration module's unreachable text fallback and its duplicate image fallback. (S–M)
- 5.2 **Split saved state from in-flight state.** Replace `sharedKeys`, `viewState` and `carryOver` with `createView()` (parked as-is) and `createRuntime()` (fresh on every attach). This removes the blacklist whose failure mode is silent, and is what 0.20.12 patched by hand. (M)
- 5.3 **Split `post-discovery.js` into modules**, with no behaviour change:
  - Route, icons, transport and retries, source scheduler, view/runtime, feed DOM model, menu, cards, unavailable-profile shell.
  - What remains in `post-discovery.js` is an orchestrator of about 250 lines.
  - Order: icons, transport, unavailable-profile shell, menu, cards, feed DOM, sources, view. (L)
- 5.4 One selector table plus a startup check, so a broken Reddit contract disables the dependent feature instead of half-applying it. Bridge errors should carry codes rather than being matched by message text. (M)
- 5.5 Chat: remove the unreachable list branches in `content.js` and duplicate predicates (previewURL, compaction, direct/request/unread). Refresh LRU order on upsert in the 20-room index. Drop the redundant `activityComplete` mapping. (S–M)
- 5.6 CSS hygiene:
  - Replace the structural comment-notice selector chain with `[data-rt-notice]`.
  - Narrow the reduced-motion rule.
  - Remove the dead `.rt-archived-media figure` rule and merge the duplicate skeleton animations.
  - Make the Feed options pre-hide language-independent; it currently matches the English label only.
  - Give dark mode a proper link colour fallback. (S)

## Phase 6 — accessibility and polish

- 6.1 Make the restored-content badge keyboard-reachable (focusable, with a popover or visually hidden text), and expose "from archive" on the archived author link. (S)
- 6.2 Spoilers: give them a role, `aria-expanded`, and click to reveal. (S)
- 6.3 Popup contrast: white on #ff4500 is 3.4:1, and the off-switch track is 1.6:1. Add a forced-colors style, and give dependent rows `aria-disabled` and `aria-describedby`. The About panel closes when text inside it is clicked; give it `tabindex=-1`. (S)
- 6.4 Chat: the scope tabs have no visible focus ring; the combobox/listbox ARIA pattern is off. (S)
- 6.5 Post media: avoid the square-then-resize jump; reserve the badge's width in the credit bar. (S)

## Phase 7 — packaging, tests, docs

- 7.1 `package.py`:
  - Make the ZIP deterministic with fixed timestamps.
  - Package from an allowlist.
  - Validate popup assets and `version_name`.
  - Replace bare asserts with real checks. (S)
- 7.2 Add `"minimum_chrome_version": "111"` to the manifest (required by `world: MAIN`). Check whether the MAIN-world chat bridge needs `all_frames`. (S)
- 7.3 Tests:
  - Discovery tests never run with live observers; add a few that do.
  - Speed up the 10 s saved-search integration test.
  - Convert the jsdom reproductions from this review into tests. (M)
- 7.4 Docs: point the README at the stable unpacked folder. Note that `scripts/icons.py` requires Pillow. (S)

## Feature work already queued

- **Stage 2 restoration:** insert comments Reddit dropped entirely.
  - Find the post's comment ids that are missing from the page.
  - Insert them only under a parent that is present, using a cloned native deleted-comment element.
  - Show the same trash/ban cue, saying Reddit no longer lists the comment.
  - Mark inserted nodes so teardown removes them.
  - Prerequisites: 1.2 and 1.4.

## Refuted or not defects (dropped)

- Stale archive jobs after a profile change: page requests are generation-gated.
- `archiveStatus` trusting upstream values: limited to a 4-value enum and used only as a label.
- Relevance score computed inside the sort comparator: scores are precomputed.
- README plan-file claims: the files exist.

## Suggested order

1. Phase 1, about a day of small fixes.
2. Phase 2, the calendar.
3. Phase 3.7 and 3.3, the cheapest large CPU wins.
4. Phase 4.1–4.3.
5. Phase 5.1 and 5.2, which make 5.3 safe.
6. The rest of Phase 3, then 5.3.

Release each group as its own PATCH, following the version policy.
