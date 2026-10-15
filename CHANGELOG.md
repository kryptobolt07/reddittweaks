# 0.10.0 design test

- Remove startup navigation waits on initial sync and the bulk saved-cache pass. Keep authentication/router readiness, exact-event failure handling and interactive request coordination. Skip redundant native event lookup when that event is already loaded; reveal visible room messages directly.
- Make individual search a full-width results view over the thread with one result status. Remove the extra close button and Ctrl+F-style counter/arrows. Preserve the native identity header, show an active search icon and support room-scoped Ctrl/Cmd+F. Esc peels the calendar/filter popup, results, then search.
- Add compact From/Date/Sort controls with independent active values, multi-sender selection and existing typing shortcuts. Use actual sender avatars/names with the same native font/spacing measurements as global results, match-centered three-line snippets, stronger orange highlights, sticky day headings, lightweight scrollbars and a quiet incomplete-coverage footer. Native message navigation expands recognized Read more controls and briefly paints hits without rewriting message text.
- Keep selected senders in a separate removable tag rail, matching global search. The field remains one line and contains only editable text; filter state stays separate from that draft.
- Default the room calendar to On, expose Today/Yesterday/Last 7/Last 30 days, disable future days, mark cached message days, use a neutral disabled Apply state and anchor it to the date control. Earlier uncached dates remain selectable. Global calendar behavior is preserved.
- Compact recognized settings/popout native buttons into an accessible ⋯ menu in rooms at most 440 px wide. Retain native handlers and restore original presentation when wide or destroyed.

Version choice: MINOR to 0.10.0 for the substantial individual-search interface expansion. No storage schema change. Reload the extension and refresh existing Reddit tabs.

Validation: all 376 tests pass, including blocked-startup navigation, native-event reuse, sender/date/sort chips, keyboard layers, exact local jumps, shadow-text highlights, calendar bounds and native action restoration. All 20 extension scripts parse. Synthetic headless Chrome checks 820/420/320 px room widths: results span the room and reach its bottom, controls and quick ranges fit, sender tags stay outside the single-line field, the clear button stays contained, and future days are disabled. Archive integrity and source/stable-folder/ZIP equality pass for all 26 assets; the convenience archive matches.

Limitations: uncached/inaccessible events can still require or fail Reddit requests; server cooldowns remain respected. Native action grouping and Read more expansion only apply to recognized accessible controls. Per-word thread highlights require the browser Custom Highlight API and accessible text roots. Cached-day dots describe available saved data, not complete history. Rendered checks use synthetic fixtures, not a signed-in Brave session.

# 0.9.1 design test

- Keep the restored month-grid interaction and refine its structure: flat mode tabs with the same solid active/faded hover underline as People/All/Messages, softly squared date selections, softer range fills, compact month/year selectors and footer controls, and orange keyboard cues instead of inherited blue outlines. Use #ff4500 for selected dates and Apply, with neutral text on active mode/chooser labels. Selected choices have a solid side accent; keyboard previews have a faded accent.
- Reduce the full picker to 264 px and keep the narrow layout at 228 px. Tighten spacing and omit only unused trailing weeks, retaining real four-, five- and six-week months and every selectable day. A synthetic five-week layout measures 300 px high instead of 372 px; the compact layout measures about 268 px instead of 304 px.
- Tighten individual-room search results to a 2 px gap below the search field in full/floating/narrow layouts. Reserve a fixed tabular-number slot for the navigation match count so loading or moving through matches cannot resize the search field. Preserve the full counter text and existing matching/navigation behavior.
- Add a quiet clock-labeled Quick ranges control to the existing Clear/Apply footer. Five options replace the calendar area without opening an external dropdown: Last 7 days, Last 30 days, This month, Last month and This year. Show compact date previews. Presets use inclusive local-calendar periods, including leap months/year boundaries, and only modify the draft until Apply. Escape returns to the calendar; dismissing the draft restores the applied dates.
- Preserve On/Before/After/Between semantics, explicit Apply/Clear, strict validation, removable date chips, date-grid and chooser keyboard navigation, chat-bounded placement and listener cleanup. Keep the bulky date-entry experiments removed. Scope runtime changes to the date-picker and individual-room search styles; search, capture, cache, image and retained-profile behavior is unchanged. No dependencies, additional server requests or storage schema changes.

Version choice: keep 0.9.1 for refinements to the current unreleased calendar bundle, including restoring quick periods already trialed in that bundle. Historical releases and independent tooling versions are preserved.

Validation: all 351 tests pass, including 11 calendar and 71 unified-interface tests. Fixtures cover inclusive presets, leap months/year boundaries, draft isolation, Apply/cancellation, quick-menu keyboard navigation, all needed calendar weeks, existing date semantics and saved-search integration without extra native requests. All 19 JavaScript scripts parse. Synthetic headless Chrome verified full/compact light/dark layouts, exact orange selection color, no focus outline, bounded quick-menu/footers and no horizontal overflow. A rendered individual-room fixture confirms a 2 px result gap and identical field width/right edge for empty, small and five-digit counters at 820, 420 and 320 px room widths. No signed-in Brave artifact check was performed. ZIP integrity and source/stable-folder/archive equality pass for all 25 assets; the convenience ZIP matches the versioned export.

Limitations: quick periods use the browser's local date and calendar; named month/year periods include their full end date. Short chat windows scroll the picker contents. Reload the extension and refresh Reddit to apply this export. Saved-history coverage remains incomplete; no global-history build or persistent history cursors are added.

# 0.9.0 design test

- Extend recovered native identities to retained avatars. Pass the saved safe HTTPS reference to Reddit’s room-icon/profile controllers and user-avatar renders, including chat-list rows, room headers, introductions and message senders. Newly connected native components receive the presentation override before their first render. Reuse avatar models and bypass native avatar cache-miss lookups when a retained reference is available.
- Preserve original profile objects, account/NSFW/community-agent flags and component properties. Overrides are tied to the authenticated account and native user IDs, follow recycled rows, update when only the avatar changes and restore native behavior when cleared. Reject credential-bearing and non-HTTPS avatar references. No additional directory, profile or history requests, storage schema change, history build or sync loop; the browser loads the retained image reference normally.
- Add a compact unavailable-account icon beside conversation names in All and Messages results, with a descriptive tooltip and accessible label. Keep timestamps on their existing line and update cached rows when availability changes. Group messages identify the unavailable sender, preserving the group’s own identity. People/chat rows keep their existing Unavailable text.
- Retain 0.8.7’s immediate loading placeholders and Down Arrow entry from the input/scope tabs into results, including cached drafts, pending message queries, dismissed menus and empty results.

Version choice: MINOR to 0.9.0 for the requested expansion of retained-identity presentation across native chat and global results. Storage schemas and independent tooling versions remain unchanged; existing saved data is reused.

Validation: all 346 tests pass, including 9 native presentation and 69 unified interface tests. Synthetic fixtures cover full/floating layouts, first connected avatar render, stable avatar models, original profile preservation, account switching, clearing/recycling, unsafe URLs, avatar-only updates, availability changes and group-sender labels. All 19 JavaScript scripts parse. ZIP integrity and source/stable-folder/archive equality pass for all 25 assets; the convenience ZIP matches the versioned export. No signed-in Brave artifact check was performed.

Limitations: restoration requires a retained, accessible avatar reference; an old photo cannot be reconstructed if no reference was saved or the image is no longer served. Unavailable does not distinguish deletion from suspension or banning. Native integration is based on the inspected client’s presentation methods and synthetic fixtures; future native component changes may require updates. Reload the extension and refresh Reddit to apply this export. Saved-history coverage remains incomplete, and persistent global-history cursors/full-history building are not added in this release.

# 0.8.7 design test

- Trial compact day/month/year segments instead of a month grid in global and individual message search. Between shows From and To; On, Before and After show a single row. A small themed condition dropdown replaces a row of mode tabs, retaining Reddit accents and a narrower floating layout.
- Support typing, complete-date paste (ISO or DD/MM/YYYY), arrow-key stepping, Home/End and segment navigation. Validate Gregorian dates, leap years, four-digit years and range ordering; preserve the applied filter when dismissing unfinished edits. On/Between remain inclusive and Before/After exclude the selected day. Apply/Clear and removable date chips reuse the existing search/history paths.
- Remove People scans, count recalculation and result-list rebuilding from ordinary keystrokes. Global result work waits for the existing 180 ms pause; room-local matching and progressive redraws wait 150 ms. Capture, completed-query, media and resize redraws defer while typing. Retain cached result nodes during that interval, showing a bounded loading placeholder immediately in People, All and Messages. Reuse that placeholder across keystrokes and progress updates; use Reddit’s native shimmer when registered, with a themed reduced-motion-aware fallback.
- Explicit filter/operator choices and Enter/arrow navigation can flush immediately. Clearing, closing, changing accounts or switching rooms cancels pending input timers; a dismissed timer cannot reopen the menu. Empty room queries skip matching. Global saved-message queries continue in the existing extension worker.
- Down Arrow moves focus from the search field or scope tabs into the result cards in People, All and Messages. Reopen dismissed results, handle cached drafts immediately and retain navigation through pending message queries; subsequent arrows move between cards without opening them.
- Keep the date experiment separate in commit 1378c4e and typing improvements in fa72432, making date-only rollback possible. No new dependencies, server requests, history rebuild, storage schema or sync loop.

Version choice: PATCH to 0.8.7 for the compact replacement of existing date controls and typing responsiveness; keep 0.8.7 for the requested placeholder and keyboard-navigation amendments. Independent tooling versions and storage schemas remain unchanged.

Validation: all 342 tests pass. Coverage includes segmented entry/paste, keyboard navigation, invalid and reversed dates, leap-day corrections, draft cancellation, existing whole-day search semantics, no per-keystroke People scanning or result DOM rebuilds, late query/capture/resize updates during typing, immediate keyboard navigation, dismissed-timer cleanup, immediate placeholders in all three scopes, placeholder reuse, native/reduced-motion selection and arrow entry from the field/tabs through cached and pending searches. All 19 JavaScript scripts parse. Synthetic headless Chrome layouts were reviewed for full-size, floating and dark date controls; no signed-in Brave artifact check. ZIP integrity and source/stable-folder/archive equality pass for all 25 assets; the convenience ZIP matches the versioned export.

Limitations: this is an experimental numeric DD/MM/YYYY editor; traditional month-grid browsing is intentionally replaced. People and individual-room matching still run in the page after debouncing, and native Reddit work can still occupy that thread. Reload the extension and refresh Reddit to apply this export. Saved-history coverage remains incomplete.

# 0.8.6 design test

- Preserve the visible result’s screen position when decoded image previews change height. Commit updated row/spacer geometry before assigning a corrected scroll offset, avoiding browser clamping against the old shorter list near the bottom.
- Reuse virtual spacer nodes and temporarily reserve the track while reconciling rows, avoiding transient shortening. Remeasure only changed image rows and preserve unrelated cached heights. Skip redundant scroll assignments so ordinary scrolling is not interrupted.
- Align the outer message result at the top as well as its avatar/name content. Images in a visible row expand downward; images below the viewport do not move it. Individual-chat search captures its visible row before changing image geometry and compensates for changes above it, with browser scroll anchoring disabled on that result menu.
- Keep existing dimension hints, shimmer, proportional previews, search/import behavior and native chat navigation. No additional network requests, storage schema or history rebuild.

Same-version cosmetic follow-up: rotate Refresh inside a fixed 12 px HTML wrapper with an explicit center, a 3D transform and a busy-only compositor hint rather than rotating the SVG paint surface directly. Keep the existing linear cadence, idle icon, reduced-motion behavior and truthful activity labels. This amendment adds no JavaScript animation loop or data requests. All 57 unified interface tests pass; live animation FPS was not profiled.

Version choice: PATCH to 0.8.6 for image-loading scroll stability; keep 0.8.6 for the requested animation amendment.

Validation: all 328 tests pass. A synthetic browser-clamp regression reproduces a 64 px visible-row shift with the prior implementation and passes with the fix. Fixtures cover image changes above/in/below the viewport, near-bottom restoration, persistent spacers, unrelated height retention, individual-search anchoring and capture-before-reveal ordering. All 19 JavaScript scripts parse. Archive integrity and source/stable-folder/ZIP equality pass for all 25 assets; the convenience ZIP matches the versioned bundle. No Brave artifact check was performed.

Limitations: validation uses synthetic layout and scroll-clamping fixtures rather than signed-in browser pixel rendering. Missing or incorrect dimension hints can still require a first-load preview size correction; the surrounding viewport is anchored during that correction. Reload the extension and refresh Reddit to apply this export. Saved-history coverage remains incomplete.

# 0.8.5 design test

- Replace the raw “Extension context invalidated” error and perpetual search label with a clear instruction to refresh the Reddit tab after the extension is reloaded or updated. Preserve loaded results, latch the discarded transport state and stop repeated worker calls, capture buffering and scheduled search retries in that tab.
- Give Refresh a busy indicator and accessible activity label for local searching, preview reads, native-cache import and capture saving. Show a compact import status while it is active; honor reduced motion. Import and saving progress notifications update controls without rerunning message queries or rebuilding the directory.
- Keep the existing cache policy: message Refresh rereads saved results and retries pending writes rather than forcing another full native-history import. A page refresh reconnects scripts and performs the existing local reconciliation; no new server requests or sync loop.

Version choice: PATCH to 0.8.5 for stale-tab recovery messaging and activity feedback. Storage schemas and independent tooling versions remain unchanged.

Validation: all 325 tests pass, including a discarded runtime rejecting once without repeated capture/search transport calls, preserved visible matches, activity during a deferred local query, import start/end feedback without additional searches or directory reads, and manual Refresh returning to idle. All 19 JavaScript scripts parse. Archive integrity and source/stable-folder/ZIP equality pass for all 25 assets; the convenience ZIP matches the versioned bundle. No Brave artifact check was performed.

Limitations: browser-invalidated extension scripts cannot reconnect themselves; existing Reddit tabs must be refreshed after an extension update. The live reported tab was not inspected, so a particular browser reload/update event is not attributed. Saved-history coverage remains incomplete.

# 0.8.4 design test

- Replace fixed 96 × 64 cropping with proportional message previews up to 128 px wide and 128 px high. Keep small returned images small and preserve compact People previews within 28 × 20 px. Use automatic image height and contain rendering, without stretching or cover cropping.
- Retain validated native image dimensions during the existing message import, history reads and event captures. Bind hints to the chosen preview source, including separate thumbnail metadata when that source is used. Reserve the final preview dimensions before assigning its image URL; no additional history pass or metadata request.
- Reuse Reddit’s registered faceplate-shimmer component for loading images, with a themed fallback when it is unavailable and static placeholders for reduced motion. Keep the loading image hidden inside the same sized placeholder and reveal it when decoded; errors stop the shimmer and retain a stable fallback.
- Learn missing or incorrect dimensions from decoded previews and batch at most 100 small account-scoped layout updates. Reuse these hints on later visits without saving image bytes, broadcasting message changes or restarting active searches. Protect edited/redacted attachments against stale load callbacks and preserve learned proportions during native replay.
- Reuse existing image nodes and notify layout when an active cached image loads offscreen as well as onscreen. Batch image-load measurements per frame, invalidate image-row measurements and preserve virtual scroll anchors without rerunning search or directory loads. Cancel queued image-layout work on suspension, account/cache reset and destruction.
- Align message-result avatars with the conversation heading at the top, above image content. Sender prefixes remain above message images. Scale thumbnail requests retain their existing 384 × 256 bounds and source reuse.

Version choice: PATCH for uncropped preview proportions, stable image placeholders and avatar alignment. This correction amends the existing 0.8.4 bundle without another version bump. Storage schemas and independent tooling versions remain unchanged.

Validation: all 322 tests pass. Coverage includes proportional image fitting, native metadata through both import compaction passes, edited/redacted images, decoded-hint persistence across reloads, account/source isolation, batched writes without search notifications, native shimmer reuse, reduced motion, error placeholders and virtual measurements without search restart or scroll movement. All 19 JavaScript scripts parse. ZIP integrity and source/stable-folder/archive equality pass for all 25 assets; the convenience ZIP matches the versioned bundle. No Brave artifact check was performed.

Limitations: images with missing or incorrect metadata can resize on their first decoded load; learned hints reduce this on later visits. Native shimmer reuse depends on Reddit registering its component before the preview is created, otherwise the themed fallback is used. A larger request cannot recover detail absent from a low-resolution source. Pixel rendering in the signed-in browser was not checked; tests use synthetic events/layout fixtures. Reload the extension and refresh Reddit to apply this export. Saved-history coverage remains incomplete.

# 0.8.3 design test

- Request 384 × 256 scale previews through Reddit’s existing media conversion helper, using the original image reference when available instead of first enlarging an already-small thumbnail. Prefer the safe converted reference during storage compaction and fall back to another valid reference if conversion or URL validation fails.
- Upgrade recognized credential-free Reddit Matrix thumbnail URLs at display time, including references already saved by older versions. Preserve the media identifier, avoid reducing existing larger dimensions, and leave arbitrary CDN/download URLs unchanged. No history reload or extra profile/directory requests.
- Stack You/group-sender prefixes above message-result image previews in global and individual search. Keep compact People summaries inline. Reserve the extra sender-line height in the virtual list and retain measured-height correction.
- Keep the existing 96 × 64 display size, lazy loading, bounded node cache, failure placeholders and unchanged-row image reuse. Higher-resolution image responses may contain more bytes; image bytes remain outside extension storage.

Version choice: PATCH for image-quality and sender-layout corrections within the existing preview feature. Storage schemas and independent tooling versions remain unchanged.

Validation: all 314 tests pass; all 19 extension JavaScript files parse. Coverage includes original-reference selection, 384 × 256 native conversion, safe fallback on conversion failure, existing-cache URL upgrades, credential rejection, unchanged external URLs, stacked/compact CSS layouts, image-node reuse, sender-row height, import compaction, edits and redactions. ZIP integrity and equality with source and the stable unpacked folder pass for all 25 assets; the convenience ZIP matches the versioned export. No Brave artifact check was performed.

Limitations: requesting more pixels cannot restore detail absent from the source. Old cached references to a separate low-resolution thumbnail file cannot reconstruct the original image reference until Reddit supplies that event again. Live server image quality and signed-in rendering were not checked; validation uses synthetic events and layout fixtures. Reload the extension and refresh Reddit to apply this export. Saved-history coverage remains incomplete.

# 0.8.2 design test

- Reconcile sidebar routing and header hydration before paint, bypassing the ordinary 120 ms UI debounce for those changes. Mobile Back restores retained search chrome and existing matches alongside a ready native sidebar.
- Observe the native sidebar header’s size as well as the sidebar. Reveal search when the header is hydrated and laid out, and measure the result viewport only after mounting beneath it. Retain the scroll anchor while readiness is pending.
- Use at most two route-local animation-frame follow-ups to discover shadow roots attached during the native render. Keep the existing discovery heartbeat as a fallback; add no network polling or server requests.
- Keep ordinary timeline mutations batched and exclude extension-owned changes across shadow boundaries, avoiding repeated discovery caused by search redraws. Cancel scheduled restore work on page unload.
- Return to already-ready matches without another local message query or directory load. Query/filter/scope/page state, account isolation and the compact nonwrapping count layout remain intact.

Version choice: PATCH to 0.8.2 as requested, for smoother mobile search restoration. Storage schemas and independent tooling versions remain unchanged.

Validation: all 310 tests pass. Lifecycle fixtures verify hidden/replaced sidebar restoration on the first frame, no additional query/directory load on return, immediate reveal after header layout, next-frame shadow hydration, preserved scroll/filter state, ordinary timeline batching, ignored search redraws and unload cancellation. All 19 JavaScript scripts parse. Archive integrity and source/stable-folder/ZIP equality pass for all 25 assets; the convenience ZIP matches the versioned bundle. No Brave artifact check was performed.

Limitations: search still needs Reddit’s native header and mounting structure to become ready. Unusually late unobserved shadow hydration can use the existing discovery fallback. First-frame behavior is verified with synthetic lifecycle fixtures, not a live signed-in mobile rendering session. UI restoration remains within the current document/account; saved-history coverage remains incomplete. Reload the extension and refresh Reddit to apply this export.

# 0.8.1 design test

- Keep People/All/Messages labels centered in equal-width columns without clipping Messages. Reserve counts below labels in narrow panels, and beside labels when the chat container has enough room. Count changes do not shift the labels.
- Wait for Reddit’s actual header to hydrate and acquire layout before revealing the search host. Mount sidebar search beside the native header wrapper and individual message search beneath its header, avoiding the initial above-header flash in full-screen, floating and narrow/mobile chat.
- Suspend hidden or detached mobile sidebar controllers when opening a result. Back to the same account and chat surface restores query text, applied filters, scope, loaded results and the scroll anchor. Keep native message navigation running while the sidebar is away.
- Refresh already-browsed local result pages after capture updates instead of resetting to the first 500 matches. Anchor the viewport by stable room/event IDs while retaining visible results during the local refresh.
- Bound detached controller retention to four chat surfaces within the current document, destroy evicted controllers, and clear retained state on account changes and page unload. No new server requests, sync loop or storage schema.

Same-version cosmetic follow-up: reduce scope-tab vertical padding, remove the label/count gap and shrink the reserved count slot. Labels remain centered and readable; counts retain a stable position with enough nonwrapping space for `999+`. All 53 unified interface tests pass, updated styles parse, and all 25 packaged assets match source and the stable unpacked folder. No browser artifact check.

Version choice: PATCH for mobile search restoration and responsive mounting reliability fixes. Independent tooling versions remain unchanged.

Validation: all 306 tests pass, including hidden/replaced mobile sidebars, account isolation, loaded-page catch-up and viewport restoration, delayed header content/layout, nested shadow toolbar anchoring, and both sidebar and individual-room mount readiness. All 19 JavaScript scripts parse. ZIP integrity and source/stable-folder/archive equality pass for all 25 assets; the convenience ZIP matches the versioned archive. No Brave artifact check was performed, as requested.

Limitations: restored UI state is temporary within the same document and native chat surface; a page reload or browser restart starts a fresh search UI while persistent saved messages remain available. Readiness and navigation still depend on Reddit’s native component structure. Headless fixtures cover lifecycle behavior but do not validate final rendered pixel layout or the installed signed-in bundle; reload the extension and refresh Reddit to apply this export. Saved-history coverage remains incomplete.

# 0.8.0 design test

- Show lazy image/GIF thumbnails in global message results, available latest-message previews, and individual message search instead of JPEG filenames. Filenames remain searchable and available on hover.
- Reuse Reddit’s native media URL conversion, prefer thumbnail references, and retain one bounded credential-free HTTPS preview URL. Keep credentials in the page world and media bytes outside extension storage. No additional profile/history requests or sync loop.
- Preserve preview references through both native IndexedDB import compaction passes, replay, edits and summaries. Redactions remove references; older data requires no schema migration and gains previews as native references become available.
- Cache bounded thumbnail nodes and keep a stable placeholder after failures, avoiding repeated requests on redraw. Account clearing/destruction resets preview views.
- Replace result-navigation outlines with a faded orange left rail; scope tabs retain their underline.
- Tighten text-result spacing, align content to the top, and retain extra space for wrapped headings and image previews. Keep virtual row heights consistent with their contents.

- Same-version visual follow-up: show one faded selection rail, prioritize keyboard navigation, and restore the opened-chat indicator when focus leaves search. Keep People rows at the native sidebar height with short status labels beside previews.
- Remove the common-word hint, compact counts/Refresh, and move loaded counts into the tooltip. Align sender chips to the search field’s left edge and show only their avatar/icon, username and removal control.
- Read native row fonts, colors, padding, gaps, line heights and avatar sizes through shadow roots. Reuse client typography/spacing tokens as fallbacks and refresh styles on resizing, existing native discovery, late fonts and root theme changes. Invalidate measured heights when needed without server calls, new polling loops or search restarts.
- Use Reddit-logo orange (#ff4500) for accents in both chat layouts and calendar highlights, rather than the darker brand-button token. Center People/All/Messages in equal-width columns while reserving count space.
- Escape dismisses global results, tabs, chips and menus from the search field or opened result rows, retaining the query and filters for reopening. Background updates do not reopen dismissed search.
- Match global message rows to People/discovery typography and spacing, reusing title/time classes and native avatar dimensions, normal-weight names and native preview typography capped at three lines.
- Keep message timestamps on the same line as native-style normal-weight conversation names; exceptionally long names truncate with full-name tooltips.
- Fit visible message cards to measured content with a bounded measurement cache, width invalidation and preserved virtual scroll anchors. Cap match-centered snippets at three lines and extend the rail with consistent 8 px top/bottom padding. Keyboard reveals and manual scrolling remain independent.
- ArrowUp reveals the whole previous card below sticky day headers while preserving downward scrolling.
- Use solid Reddit-orange rails for opened chats/messages and faded rails for keyboard previews. All results retain one rail, preferring the opened message after navigation.
- Reserve compact count slots and fixed scope columns to prevent People/All/Messages from shifting. Enlarge message thumbnails to 96 × 64 px without a visible Image/GIF caption; retain accessible labels and sender prefixes.

Version choice: MINOR for the new image-preview capability; spacing corrections share this release. Storage schemas and independent tooling versions remain unchanged.

Validation: all 294 tests pass; extension JavaScript syntax, ZIP integrity, and source/stable-folder equality pass for all 25 assets. Tests cover URL validation, replay, edits/redactions, native conversion without server calls, double-compaction cache import, lazy node reuse/failure fallback, People summaries, individual image history, and existing search/navigation coverage. The original bundle received Brave synthetic checks for loaded thumbnails, mixed results and stable scrolling/refocusing. Synthetic tests also cover responsive font/height changes, replacement native rows, font loading, theme changes and absence of appearance-related server/search requests. The visual follow-up uses headless fixture tests only, as requested; no Brave artifact check was performed.

Limitations: native appearance falls back to client tokens until a rendered native row is available. Missing or inaccessible references show an Image/GIF placeholder. Old cached filenames cannot reconstruct a preview URL until Reddit exposes the corresponding event again. Saved-history coverage remains incomplete. The signed-in installed bundle requires manual Reload and validation; browser checks use synthetic data.

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
