# 0.8.0 design test

- Show lazy image/GIF thumbnails in global message results, available latest-message previews, and individual message search instead of JPEG filenames. Filenames remain searchable and available on hover.
- Reuse Reddit’s native media URL conversion, prefer thumbnail references, and retain one bounded credential-free HTTPS preview URL. Keep credentials in the page world and media bytes outside extension storage. No additional profile/history requests or sync loop.
- Preserve preview references through both native IndexedDB import compaction passes, replay, edits and summaries. Redactions remove references; older data requires no schema migration and gains previews as native references become available.
- Cache bounded thumbnail nodes and keep a stable placeholder after failures, avoiding repeated requests on redraw. Account clearing/destruction resets preview views.
- Replace result-navigation outlines with a faded orange left rail; scope tabs retain their underline.
- Tighten text-result spacing, align content to the top, and retain extra space for wrapped headings and image previews. Keep virtual row heights consistent with their contents.

- Same-version visual follow-up: show one faded selection rail, prioritize keyboard navigation, and restore the opened-chat indicator when focus leaves search. Keep People rows at 64 px with short status labels beside previews.
- Remove the common-word hint, compact counts/Refresh, and move loaded counts into the tooltip. Align sender chips to the search field’s left edge and show only their avatar/icon, username and removal control.
- Keep message timestamps on the same line as native-style normal-weight conversation names; exceptionally long names truncate with full-name tooltips.
- Fit visible message cards to measured content with a bounded measurement cache, width invalidation and preserved virtual scroll anchors. Cap match-centered snippets at three lines and extend the rail with consistent 8 px top/bottom padding. Keyboard reveals and manual scrolling remain independent.
- ArrowUp reveals the whole previous card below sticky day headers while preserving downward scrolling.
- Use solid Reddit-orange rails for opened chats/messages and faded rails for keyboard previews. All results retain one rail, preferring the opened message after navigation.
- Reserve compact count slots and fixed scope columns to prevent People/All/Messages from shifting. Enlarge message thumbnails to 96 × 64 px without a visible Image/GIF caption; retain accessible labels and sender prefixes.

Version choice: MINOR for the new image-preview capability; spacing corrections share this release. Storage schemas and independent tooling versions remain unchanged.

Validation: all 290 tests pass; extension JavaScript syntax, ZIP integrity, and source/stable-folder equality pass for all 25 assets. Tests cover URL validation, replay, edits/redactions, native conversion without server calls, double-compaction cache import, lazy node reuse/failure fallback, People summaries, individual image history, and existing search/navigation coverage. The original bundle received Brave synthetic checks for loaded thumbnails, mixed results and stable scrolling/refocusing. The visual follow-up uses headless fixture tests only, as requested; no Brave artifact check was performed.

Limitations: missing or inaccessible references show an Image/GIF placeholder. Old cached filenames cannot reconstruct a preview URL until Reddit exposes the corresponding event again. Saved-history coverage remains incomplete. The signed-in installed bundle requires manual Reload and validation; browser checks use synthetic data.

# 0.7.1 design test

- Match message terms shorter than three characters on Unicode word boundaries. Keep longer substring searches, strict AND across the full message, and quoted exact phrases. Apply the same rule in saved/global and individual search, highlights and excerpts; People and sender completion retain substring matching.
- Keep conversation names/avatars as result headers. Prefix only your messages in DMs; prefix every sender in groups. Add accessible sender/action labels and avoid substituting your own avatar when a conversation avatar is missing.
- Let right-aligned timestamps wrap when needed instead of cutting off username suffixes. Allocate virtual row space for wrapped headings and refresh height calculations on resize. Reuse the excerpt for both visual and accessible text.
- Score relevance by distinct term coverage, with existing occurrence/position tie breaks. AND results all satisfy the required terms; partial matches remain excluded.
- Verify existing year-bearing older day dividers and stable room/event IDs across renamed and identically named conversations.

Version choice: PATCH for visible matching, sender-identity, accessibility and layout corrections within existing search. Storage schemas, native capture/sync behavior and tab styles are unchanged.

Validation: all 279 tests pass; JavaScript parses and all 24 archive files match source and the stable unpacked folder. Brave synthetic checks verify full example usernames, right-aligned/wrapped times, DM/group prefixes, accessible labels, whole-word short matches, strict AND, and distinct 2024/2025 date dividers. Screenshots are in ignored validation artifacts.

Limitations: snippets can omit required terms outside the displayed window even though the full message matches all of them. Long group titles may use two lines with a full-name tooltip. Saved history remains incomplete, and the signed-in installed Reddit bundle still needs manual Reload and validation.

# 0.7.0 design test

- Move applied global sender/media filters out of the editable input into one compact 32 px chip row below it. Hide its horizontal scrollbar, keep removal buttons on the right, preserve draft text, and make Clear filters remove all applied state.
- Preserve explicitly selected People/All/Messages tabs when clearing/replacing a query. Share People matching across People and All, calculate independent counts, apply conversation filters consistently, and reuse count/full-result reads across scope changes. Existing matching remains literal, including regex characters; no arbitrary regex engine is added.
- Retain the preceding design's scope tabs and solid orange active underline. Size tabs around their labels/counts to avoid clipping and use a faded orange underline for hover. Result-navigation outlines use Reddit orange. Compact global sender suggestions and the calendar, and dismiss sender choices outside without discarding the pending draft.
- Make arrows navigate from clicked result buttons as well as the input. Immediate People selection does not wait for message counts. Native message navigation retains Reddit's highlight without additional orange outlines; extension result selection accents remain.
- Add global Images/GIFs/Links and conditional observed Videos/Audio/Files filters using native type/MIME metadata. Capture only the small MIME string through the page bridge, including edits, and exclude redacted media. Individual-room media UI is not expanded.
- Keep search in the existing extension worker, virtualize long lists, reuse unchanged rows/avatars, debounce typing for 180 ms, and batch native capture updates for 750 ms. Capture bursts do not starve queries or replace visible rows per batch.

Version choice: MINOR for the compatible global media expansion and applied-filter state model. No storage-schema bump, second sync loop, automatic full-history crawl, or extra profile/media request. Older missing metadata is filled only when native events are replayed. Work remains on `prototype/unified-chat-search`; no merge or publication.

Validation: all 275 tests pass, including sender/media state, literal/shared People matching, independent counts, count-only-to-full transitions, keyboard focus, outside dismissal, account clearing, capture bursts, bridge-to-worker MIME persistence, edits/redactions and existing history/storage coverage. All JavaScript parses; ZIP integrity and all 24 packaged files match source and the stable unpacked folder. Brave synthetic checks cover full/floating light and dark views, minimized search restoration, sender/media chips, 32 px overflow with hidden scrollbar and right-side removals, compact calendar, scope counts, exact message navigation and result-focused arrows. Screenshots are kept in ignored validation artifacts.

Limitations: saved message coverage remains incomplete. Missing MIME metadata is not guessed, and old events unavailable locally cannot be classified until fetched by native/user-directed history. Videos/audio/files are supported conditionally rather than claimed as universally available in Reddit's current client. Manual browser checks use synthetic data; the signed-in installed Reddit extension requires a manual Reload and has not been verified with this bundle. Browser automation blocks the Brave extension-settings page. No universal latency guarantee is made.

# 0.6.0 design test

Quick follow-up export: sender chips now sit inside the search field, sender matching uses People-style substring matching and the shared People row renderer, and captured updates batch into a 750 ms background search/summary refresh. Account clearing stays immediate. This same-version follow-up is untested at the user’s explicit request; the validation below describes the preceding bundle.

- Start search in People and retain Reddit’s original sidebar until a query or relevant filter is applied. Focus/click exposes underlined People → All → Messages tabs. Keep calendar placement stable with a disabled People control; omit duplicate single-category section headings.
- Add multiple removable sender chips with reused avatars. Repeated `from:` values match alternatives; text, dates and attachment filters remain conjunctive. Expand contextual filters with Direct, Unavailable, Images and Files. Attachment type comes from native message metadata, including edits and replay of older cached events.
- Correct individual snippet highlighting to use the excerpt’s original offsets. Keep first matches visible in responsive windows, wrap long URLs, highlight People titles and restore main’s orange matches/selected-row accents.
- Restore reliable user-requested message navigation: load exact events through the available native client API for initialized rooms, retain cold-room routing, scroll/highlight the exact target, expose loading/failure and ignore obsolete navigation completion. No background scroll or second sync loop.
- Reuse unchanged result/preview/avatar nodes during native updates. Compile query/date checks once, reuse sender identities within each search, sort numeric timestamps, and bypass Unicode mapping for ASCII highlights. Search stays in the existing extension worker.

Version choice: MINOR for multiple sender selection and genuine attachment filters plus the compatible search-flow expansion. No storage-schema bump; older attachment metadata is recovered on native replay. Work stays on `prototype/unified-chat-search`.

Validation: all 254 tests pass. New cases cover multi-sender OR matching and chip removal, native default/focus behavior, deep URL windows, stable clickable rows, attachment replay/edits, cold-room navigation, exact target scrolling, and obsolete navigation completion. All JavaScript parses; ZIP integrity and all 23 files match source and the stable unpacked folder. Brave synthetic checks verify native People on focus, underlined scope order, sender selection/chips, matched-message navigation and orange highlighting. Synthetic benchmark against the previous code measured 100 long-URL excerpts at 48.9 → 1.3 ms and five 5,000-message searches averaging 39.2 → 11.4 ms; these are local fixture timings, not a guarantee for every account.

Limitations: saved-history coverage remains incomplete; unavailable attachment metadata is not guessed. Browser testing uses synthetic fixtures in Brave. The signed-in Reddit account is not yet verified with this bundle; browser automation blocks Brave’s extension-settings URL, so the installed extension needs a manual reload. Native client capabilities can change. Reload the same unpacked extension and refresh Reddit tabs after updating.

# 0.5.2 design test

- Refine message timestamps by sort in global and individual-room search: Newest/Oldest use time-only rows under sticky local-day dividers; Relevant removes dividers and uses date plus time on every result. Dividers use Today, Yesterday, recent full weekdays and compact older dates. Full timestamps appear on hover. Virtualized scrolling retains the active day without changing list height.

- Move the saved-history explanation from chat results into the extension popup, alongside cache statistics and clearing controls. Saving failures remain visible in search status; no completeness guarantee is added.
- Center compact filter menus within the sidebar and individual-room search. People offers chat types and chronological sorting; Messages offers sender selection and message sorting; All offers both. Dormant chat filters no longer constrain Messages, and calendar filters do not hide People results.
- Separate calendar and filter active indicators. Date-only filtering accents the calendar alone; All/People/Messages use Reddit secondary theme colors.
- Remove link, before/after date-operator, and whole-word menu options and autocomplete suggestions. Sender completion retains avatar rows and keyboard selection; dates use the existing calendar. Previously typed query operators remain supported by the parser for compatibility.

Version choice: PATCH for user-visible filter scope and active-state corrections within the existing design-test interface. No storage-schema change, second sync loop, or additional network lookup. Work remains on `prototype/unified-chat-search`. The timestamp display follow-up retains this same version under the small interface refinement policy.

Validation: all 241 tests pass, including chronological/relevance timestamps, local calendar dates, virtualized day continuity, room-search sort switching, context-specific menus, scope switching, calendar/filter independence, sender keyboard selection, popup notice/statistics, saved-query integration and existing storage/history tests. All extension JavaScript parses. The ZIP passes integrity checks and all 23 packaged files match source and the stable unpacked folder. Synthetic browser checks cover light full chat, dark floating chat, centered sidebar/room menus, independent date accent, and minimized search restoration. Timestamp previews verify time-only chronological rows, dated relevance rows and a day header pinned to the result viewport after scrolling.

Limitations: saved-message history may be incomplete. Browser checks use synthetic fixtures in the Codex in-app browser; the installed bundle has not been verified in the signed-in Brave Reddit tab. Reload the unpacked extension and refresh Reddit tabs after updating.

# 0.5.1 design test

- Refine chat/message rows, search fields, scope pills, and sticky day separators to use Reddit's native theme. Restore the selected-chat highlight from Reddit's active room, keep keyboard focus distinct, and show an optional one-line last-message preview in People when already saved. Missing, blank, or older-than-known-activity messages leave the preview absent; dates retain the latest known activity.
- Replace the enlarged filter menu with compact icon actions and short inline chat/sort choices. Completing `from`, `has`, `before`, or `after` offers an operator action; click or Enter inserts its query token and keeps focus in the search field.
- Choose senders with reused avatar rows in the main results area, choose Link for `has:`, and type or choose dates through the existing calendar. Individual-room search follows the same flow. There is no separate scrolling sender popup or message-context expander.
- Hold message/history reads while an operator value is being chosen. Keep flat results virtualized, reuse cached sender candidates, fix keyboard selection repainting, and return to Reddit's native sidebar when the query is cleared.

Version choice: PATCH, at the user's request, for fixes and interface refinements to the existing 0.5.0 search/filter behavior. No storage-schema change, new sync loop, or additional profile lookup is introduced. This remains on the unmerged `prototype/unified-chat-search` test branch.

Validation: 236 tests pass, including query insertion, sender selection with spaces, keyboard navigation, native selected-room changes, date-query completion, local pagination, and room-search integration. All extension JavaScript parses. Export validation checks ZIP integrity and byte equality with source and the stable unpacked folder. Synthetic browser checks cover full/floating chat, minimized search restoration, light/dark menus, individual-room sender selection, and date completion.

Limitations: saved-message coverage remains incomplete. Browser UI validation uses the Codex in-app browser and invented fixture data; the updated installed bundle has not been validated against the signed-in Brave Reddit account. Native selection/navigation relies on Reddit's current components. Reload the unpacked extension and refresh Reddit tabs after updating.

# 0.5.0 design test

- Integrate the unified chat/message design into the actual extension on `prototype/unified-chat-search`. All, People, and Messages share an input, independent counts, and account-scoped recent searches.
- Put icon-only filter/calendar controls inside the chat search ribbon, without a separate empty toolbar row. Individual message search shares the compact filter menu and Discord-style operator/sender suggestions. Active filters have removable chips.
- Add `from:`, `before:`, `after:`, `has:link`, quoted phrases, Me/Them, whole-word matching, and newest/oldest/relevance sorting to saved searches. Reuse known native unread metadata; unknown state is not invented.
- Show last-message previews, partner avatars and conversation titles, compact timestamps/full tooltips, centered snippets, and a normal-weight You: prefix. Group message matches, reveal saved context on demand, and highlight native message jumps. Window long lists and expanded groups with local pagination and accurate total counts.
- Consolidate result status, use skeleton/empty states, preserve captured matches during updates, and keep incomplete coverage in a footer. Keep search above native chat rows/Threads and give only the native header a higher layer, so its dropdowns paint above search controls. Restore scoped header style overrides when search unmounts. Tighten the status/Refresh strip and suppress the common-word hint while browsing without a query.
- Replay loaded native timelines once when cache listeners attach late; retain full snapshot references afterward to avoid repeatedly saving unchanged startup history. No new server calls or second sync loop are introduced.

Version choice: MINOR for the new unified search interface and compatible search/filter expansion, once for this design-test bundle. Directory/message storage schemas and tooling versions are unchanged. This branch is not merged or published.

Limitations: global search covers saved data, not the complete archive. Context is limited to saved messages in the same thread. Unread filters require native metadata. Global results load in 500-message local pages, and exact navigation depends on Reddit's private native client. This build requires reloading the unpacked extension and refreshing Reddit tabs. Browser checks use actual extension scripts against a synthetic native fixture in Brave; the updated installed build has not yet been tested on the signed-in Reddit account.

Validation: 233 tests pass; all extension JavaScript parses. Package validation confirms ZIP integrity and byte equality between extension source, the versioned ZIP, and the stable unpacked folder. Synthetic Brave checks cover the compact full/floating search ribbon, individual-room filters/suggestions, dark calendar, native navigation, and minimized restoration.

# 0.4.1

- Show already-committed global/room matches without draining queued captures. Worker reads run separately from ordered mutations; whole-room reads use a single snapshot.
- Preserve explicit save barriers and invalidate stale reads after clearing or changing accounts. Remove the redundant full stats scan during initialization.
- Keep saved matches searchable during saving failures, show Saving paused, and let Refresh retry pending writes without turning ordinary searches into a retry loop.
- Document proportional version decisions in AGENTS.md. This meaningful startup performance fix receives a PATCH bump; no feature or cache-schema version change is required.

Validation: 181 tests pass, including paused client/worker/storage queues, snapshot consistency, durable barriers, clear protection, saving failure/Refresh behavior, and existing native catch-up/UI tests. Authenticated-account readiness, an active IndexedDB write, and local matching can still take time; global coverage remains incomplete.

# 0.4.0

- Persist messages already fetched by Reddit or individual searches, scoped by account and shared between individual and global search.
- Add People / All chats search scope, local message/date filtering, compact sender rows, and exact room/event/thread navigation. Global search explicitly shows incomplete coverage.
- Capture existing native events, loaded timelines, edits and redactions without another sync loop or background history crawl.
- Reconcile supported locally cached Reddit history on each chat attachment, using readonly 200-row chunks and durable write acknowledgements. Persist successful reconciliation timestamps; skip unchanged message/identity writes.
- Add cache statistics and a separate Clear saved messages control. Failed writes retry within bounded memory; account switches and clear operations invalidate stale work.
- Initialize Git and document the repeatable commit/validation policy in AGENTS.md.

Buffer fix within 0.4.0: throttle startup/sync capture as well as native database import, coalesce native bursts, skip unchanged snapshots, and recover rejected captures locally instead of latching the buffer error indefinitely. The buffer limits are unchanged.

Search fixes within 0.4.0: return saved global/room matches while the initial local import continues; coalesce incoming capture updates without cancelling queries or clearing visible results; avoid saved-room reads in hidden controls. Preserve unresolved invitations/departed rooms when their participant endpoint denies access, continue accessible username resolution, retain invite state, and persist denied status to avoid repeated failures on reload. Unexpected participant failures remain visible.

Sidebar fixes within 0.4.0: keep All chats visible behind its calendar and while interacting with a conversation or opening a matched message. Outside clicks and Escape close the calendar without reverting the global sidebar to Reddit's native list. People search and individual message menus remain dismissible.

Reconnect fixes within 0.4.0: automatically reconcile messages Reddit cached while capture was disabled, including new messages, older edits and redactions. An old import-complete flag no longer blocks catch-up. Late database readiness and replacement clients/databases attach without a second sync loop; searches keep using saved data during reconciliation. Individual history completion waits for saved writes. Pending invitations avoid forbidden member reads, acceptance updates saved room metadata, and named community conversations appear in People with a distinct caption.

After re-enabling, reload open Reddit tabs. Local catch-up cannot recover events that Reddit no longer retains; persisted extension history is not removed merely because Reddit evicted it.

The optional full-history build is deferred. Existing local tails and newly fetched pages do not establish complete global coverage. No fixed storage ceiling is promised.
