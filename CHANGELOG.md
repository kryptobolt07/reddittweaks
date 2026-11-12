# 0.32.0 preview

- **Search tips** open with **Ctrl+/** (⌘/ on Mac) in any search box that uses the query language, as a compact card limited to that box's fields. The buttons and menu entries are gone.
- Header search with many filters stays usable: when the filter pills would crowd the field, they fold into one **N filters** pill. Its card lists each filter as a removable pill, with Clear all.
- Search Comments on archived posts is rebuilt from Reddit's own comment search, using measured sizes and Reddit's search box. The button opens the box with Cancel. Enter searches, the result cards and "All Comments" match Reddit's, and no matches shows Reddit's no-results box. The toolbar now appears with the post instead of before it. Opening a result shows that comment's thread first, highlighted as Reddit does, with the toolbar just under the header.
- Archived comments use Reddit's comment geometry: a full-width column, a 36 px author row and Reddit's body spacing. Archived post pages use Reddit's post-page box.
- Archived video and GIF posts keep the preview inside the media box while loading. When the archive can't play the file, they say the original video isn't available, without a play button.
- Chat: choosing a conversation no longer collapses the opened list search. Applied filter chips in chat use the same Reddit pill as the header and feed filters.
- Profile and list searches no longer rebuild or reload their list about a second after opening.

Version choice: MINOR to 0.32.0 for the Ctrl+/ tips and the folded header filters, bundled with fixes. No new permissions or storage schema migration.

Validation: all 1,320 automated tests pass; ZIP integrity (sha256 cb1cd2a8…532eb0) and source/stable-folder byte equality checked.
Live comparison on Reddit (signed-in Chrome, read-only) covered:
- Search Comments sizes, states and result cards against a live post (sort 109x32, button 178x40, box 542 + Cancel 70, card 620x193).
- The permalink highlight and scroll position.
- Load order: the toolbar now appears with the post.
- The folded "3 filters" pill and its card.

The chat changes were checked in the chat demo in a headless browser, not on live Reddit. Archive pages use Reddit's older colour palette there, so field and card greys differ slightly from live communities; sizes match. The archive header search bar comparison (spec I4) is not done.

# 0.31.0 preview

- Your own profile's search has a **List** filter: All activity, Saved, History, Hidden, Upvoted or Downvoted, keeping your query and filters. List searches can switch lists the same way.
- One query language in every search box: words, "phrases", OR, -word/NOT, ( ) and fields such as u/, r/, title:, site:. Search Comments on archived posts now supports it too.
- **Search tips** in each search box (Feed options and the filter row on profile and list search, a button beside archive searches) list the syntax with examples that fill the box. docs/search-syntax.md documents it all, and the popup points to it.
- Floating chat: switching conversations no longer makes the search bar collapse and re-expand.
- List and filter pills no longer blink on a direct visit to a list or filtered search.

Version choice: MINOR to 0.31.0 for the List filter and Search tips, bundled with fixes. No new permissions or storage schema migration.

Validation: all 1,314 automated tests pass; ZIP integrity and source/stable-folder byte equality checked. The chat fix was reproduced and checked in the chat demo in a headless browser. Not checked on live Reddit (no browser access to Reddit in this session): the pill blink fix, the List filter and the Search tips placement. Archive search bar and comment search parity with live communities (spec items I4 and I5) are not done yet.

# 0.30.3 preview

- Opening a result from a profile or list search keeps the results and the Saved/History pill on screen until Reddit shows the post, instead of a blank page; going Back shows them again at once, pill included.
- A fresh list search no longer restarts from the first page when Reddit swaps its page during start-up.
- The Subreddit menu's community list uses compact rows on desktop.

Version choice: PATCH to 0.30.3 for display and performance fixes. No new permissions or storage schema migration.

Validation: all 1,308 automated tests pass; ZIP integrity and source/stable-folder byte equality checked. Live Chrome check (read-only) on a Saved search: results and pill stayed until the post appeared (0.8 s), came back together 0.13 s after Back, and the Subreddit menu rows measured 36 px.

# 0.30.2 preview

- Going Back to your own Saved, History, Hidden, Upvoted or Downvoted search puts the loaded results back at once instead of reading the whole list again; a list that was still loading continues where it stopped.

Version choice: PATCH to 0.30.2 for a performance fix. No new permissions or storage schema migration.

Validation: all 1,307 automated tests pass; ZIP integrity and source/stable-folder byte equality checked. Live Chrome check (read-only) on a Saved search for "termux": a result opened and Back pressed; all six results were back within 0.15 s with no list request (only the signed-in account check).

# 0.30.1 preview

- Going Back to a profile or list search from one of its results puts the loaded results back at once, at the same scroll position, instead of searching Reddit and the archive again from the first page. The last three searches are kept for 15 minutes.

Version choice: PATCH to 0.30.1 for a performance fix. No new permissions or storage schema migration.

Validation: all 1,305 automated tests pass; ZIP integrity and source/stable-folder byte equality checked. Live Chrome check (read-only): a filtered search scrolled through three pages, a result opened and Back pressed; results were back within 0.15 s, the scroll position by 0.4 s, with no new Reddit search or archive requests.

# 0.30.0 preview

- The popup groups its options: **On Reddit** (profile search and clean shared links, using Reddit only) and **Arctic Shift archive** (optional, third party: one switch, with restore and banned/private communities under it). Options that need a switch that's off fold away, and a dimmed option names the switch it needs.
- Your Saved, History, Hidden, Upvoted and Downvoted searches keep their list pill (now Reddit's own scope pill style with the list's icon) after searching, instead of losing it when Reddit re-renders the header.
- Filter pills (date, post type, subreddit, Oldest first) use Reddit's own search scope pill everywhere. On desktop profile search they sit in the header search next to u/name, several communities share one pill, and a new query typed there keeps them.
- Profile search and Saved/History/Hidden/Upvoted/Downvoted searches show results as Reddit's own search rows (community · time, title, votes · comments, thumbnail; comments in Reddit's grey comment box with Go To Thread), with Reddit's "Show results from all of Reddit" line, instead of full feed cards with an "Open post on Reddit" link. Reddit's own results no longer load a full card each; archive results still check their current Reddit status in the background.
- Opening a result from a filtered or list search no longer flashes Reddit's unfiltered results while the post loads.
- Community icons in the Subreddit menu appear sooner: icons that came with search results are used at once, more load in parallel, and found icons are remembered for the browser session.

Version choice: MINOR to 0.30.0 for Reddit-style search rows on profile and list search, filter pills in the header search, and the regrouped popup, bundled with fixes (pill creation error on community pages, flashes of Reddit's unfiltered results, faster community icons). Setting keys and their meaning are unchanged. No new permissions or storage schema migration.

Validation: all 1,304 automated tests pass; ZIP integrity and source/stable-folder byte equality checked. Live Chrome checks (read-only) compare profile search posts and comments with Reddit's own profile search, cover a Saved search and opening one of its results with no visible Reddit results during the transition, header pills on a profile search, and Subreddit menu icon timing. The popup was checked in a headless browser in light and dark.

# 0.29.0 preview

- Profile search filters (Date, Post type, Subreddit and the rest) are each Reddit's own dropdown style, with clear labels, and close on a second click. Old is added to Reddit's own sort menu instead of a duplicate Sort button. On mobile they open as Reddit's bottom sheets.
- Profile search loads with Reddit's own skeleton and no longer shows "Reddit's post search format changed" on direct visits; Reddit's newer result cards are read.
- The Subreddit menu shows community icons, keeps every community listed after a pick, and supports picking several.
- Changing a filter reloads results once, not twice: Reddit treated our unchanged-address write as a page reload.
- Clicking a result card's body opens the post. Filter buttons are spaced like Reddit's, and filter pills keep their size on direct visits instead of starting large.
- NSFW and spoiler text in profile cards and on archived post pages is blurred behind Reddit's View NSFW content / View spoiler pill instead of a "NSFW or spoiler snapshot" note.
- Banned and deleted profiles show Reddit's grey suspended snoo in the header; their posts, and suspended or deleted authors in archived threads, use Reddit's small snoo-back avatar.

Version choice: MINOR to 0.29.0 for the Reddit-style filter dropdowns, mobile bottom sheets and search skeleton, bundled with profile search fixes. No new permissions or storage schema migration.

Validation: all 1,298 automated tests pass; ZIP integrity and source/stable-folder byte equality checked. Live Chrome checks (read-only) cover one feed rebuild and no Reddit page refetch per subreddit pick (first and second pick), 26px pills from the first frame on a direct visit with three subreddits, and on a deleted profile the grey snoo header (64px, contained) with no NSFW snapshot note.

# 0.28.1 preview

- Fast scrolling into an archive feed's loader no longer jumps past newly loaded posts.
- On profile feeds, waiting at the loading halo no longer pulls the page back up after a moment; the halo keeps its space while paused.
- Filter chips load each community's own icon again (fetched when not cached), in a fixed slot that doesn't shift the label.

Version choice: PATCH to 0.28.1 for scrolling and icon fixes. No new permissions or storage schema migration.

Validation: all 1,294 automated tests pass; ZIP integrity and source/stable-folder byte equality checked. These fixes were not checked live at the user's request.

# 0.28.0 preview

- Archived threads have Reddit's comment toolbar between the post and the comments: **Sort by** (Best, Top, New, Old over loaded archive comments) and **Search Comments** over loaded comments.
- Profile search shows the Feed options filters inline in Reddit's sort row, styled like Relevance / All time / Safe Search.
- The subreddit archive shows users' real profile pictures (the poster's on post pages) and Reddit's grey silhouette for deleted accounts, with square, centred avatars.
- Archived NSFW and spoiler posts look like Reddit's: the NSFW tag (Reddit's icon and colour) above the title, the flair pill below it, and media blurred on black under a scrim with a View NSFW content pill. A click anywhere on the blur reveals it instead of opening the post.
- Images pasted into archived text posts (preview.redd.it links) render inline, blurred when restricted, and reserve their size before loading.
- Archive scrolling stays steady while posts, comments, loaders and images load: positions are kept relative to the page, so the reader's own scrolling is never corrected. The feed position is restored after visiting a post (including after reloading it); reloading the feed itself starts fresh.
- Archive timeouts retry automatically before showing a compact Retry pill. Profile post and comment searches retry quick and temporary (HTTP 403/429) failures quietly; notes appear only for long waits or repeated failures.
- Following a link out of an archived community no longer flashes Reddit's banned notice. Posts opened from extension-drawn profile cards start at the top. Community icons in filter chips are centred, and stacked toolbar notices share one left edge.

Version choice: MINOR to 0.28.0 for the new comment toolbar, inline profile-search filters and real profile pictures, bundled with archive display, scrolling and retry fixes. No new permissions or storage schema migration.

Validation: all 1,294 automated tests pass. Live Chrome checks (read-only) cover the inline post image, NSFW tag, flair, blur and click-to-reveal on an archived post, and wheel scrolling through loads on two archived threads and a feed with no visible jumps. ZIP integrity and source/stable-folder byte equality pass for all 48 packaged files.

Limitations: the profile-card scroll fix and the quiet profile retries are covered by automated tests only. Reddit's own "error loading the next page" message on profile feeds was not reproduced and is unchanged. Comment sorting and search apply to loaded archive comments, not the full thread.

# 0.27.0 preview

- Added separate opt-ins for browsing unavailable communities and opening their archives automatically. Both require Arctic Shift and profile discovery; automatic mode holds the matching banned/private notice before paint. Disabling the preferences restores Reddit's notice. Existing users must enable the new community preference.
- Archive layouts initialize with Reddit's persisted collapsed/expanded navigation state. The native sidebar controller receives that state before connection, waits for its renderer during startup, and no longer remains hidden while loading.
- Loaded feed cards stay attached during scrolling rather than becoming empty placeholders. Comment updates preserve connected siblings, Reddit-assigned nested slots and collapsed state; later archive pages append without reshuffling comments already being read.
- Top-level comments continue on scroll with the Reddit halo instead of Load more comments/View more comments buttons. Reply controls use the circle-plus and small native-style spinner. Repeated cursors stop paging; empty advancing pages pause after three reads with an explicit Retry.
- Added **Clean shared links**, an independent opt-in for normal post/comment permalinks without sharing identifiers. Native clipboard/share feedback remains in place; opaque Reddit share paths use the clicked source permalink without resolver requests.
- Moved archive-thread attribution and read-only/partial-coverage information into the right sidebar. Archive comments are excluded from early restoration skeletons. Restored the halo component's native layout and added visible fallback artwork during component startup.

Version choice: MINOR to 0.27.0 for the new community archive and clean-share preferences, bundled with loading and continuity fixes. No new permissions or storage schema migration.

Validation: all 1,279 automated tests pass. Live Brave checks cover direct archive loading, collapsed navigation, feed/comment continuation, reverse scrolling, two reply expansions, sticky sidebar geometry, and canonical copied post/comment URLs. ZIP integrity and source/stable-folder byte equality pass for all 48 packaged files. See [validation details](docs/subreddit-archive-loading-validation.md).

Limitations: retaining revealed cards uses more page memory on very long feeds. Reply counts and ranking describe loaded archive records; archive exhaustion never proves complete history. Private-community handling remains covered by synthetic tests. Opaque share links without a matching active source are preserved rather than redirected to an invented target. A live archive timeout recovered through Retry; provider failures remain explicit.

# 0.26.0 preview

- Archived subreddit feeds use Reddit's own subreddit card: author avatar and name, archive badge and a disabled overflow menu, flair, and media by real post type (full-width images, galleries and videos; link thumbnails with a domain line; no borrowed previews on self posts). Votes are marked unavailable and deleted images show an "Image no longer available" notice.
- Archived post pages have a Back button, the community and author header, a read-only action row (score, comment count, Share copies the link) without duplicating Reddit's own, native comment avatars, and focused-comment links that scroll to the comment. Posts opened from the feed render immediately.
- Archived comments follow Reddit's comment view (approximated): best-first, 20 top-level comments then "View more comments", "N more replies" per comment, a seven-level depth limit, and Reddit's small loading icon. Thread restore no longer runs inside the archive, so no skeleton lines appear there.
- Feed loading uses Reddit's Snoo halo, reveals 25 posts at a time, drops stale results when filters change, shows explicit scanning and empty states, and unmounts far off-screen cards. Collapsed comments hide their replies.
- The masthead, notice button and sort, date and type controls match Reddit's sizes and icons; menus have no visible scrollbar and the custom date presets wrap. The right sidebar shows an archive card, coverage among loaded posts, most active posters and Reddit's footer links.
- Archive search: truthful sort label ("New" where the archive can't rank), a Media tile grid, relative times without author, native thumbnails, comment avatars, and continued scanning until about 25 results.
- Developer tooling: configurable relay port, headless fixture browser, probe tools, and the verify-loop and council skills.

Version choice: MINOR to 0.26.0 for new archive features (sidebar cards, Media tiles, paged loading) plus fixes. No new permissions or storage schema migration.

Limitations (not yet verified live): left-nav "Home" highlight removal, archive title colour token, search sort relabel inside Reddit's control, Media tile sizing, scroll stability while off-screen cards are swapped, comment thresholds approximate Reddit's "Best" view. The sidebar's content is still under discussion.

Validation:
- All 1258 tests pass.
- Package integrity and source/stable-folder byte equality verified.

# 0.25.0 preview

- Archived banned/private community post links open a thread reader with nested comments, focused-comment links, bounded pagination and explicit partial-coverage status.
- Community pages reuse Reddit's native left navigation. Snapshot card links remain usable while voting and other snapshot actions are blocked.
- Comment feeds and thread comments use page-level Arctic Shift attribution instead of repeated archive badges. Thread comments retain native author, avatar, body and action-row styling.
- Archive reader comments are excluded from live deletion detection.

Version choice: MINOR to 0.25.0 for archived community thread browsing. No new permissions or storage schema migration.

Validation:
- All 1216 tests pass, including scoped thread reads, focused comments, stalled pagination, native navigation, snapshot action guards and comment attribution.
- Package integrity and source/stable-folder/archive byte equality verified.

Limitations:
- This continuation has automated coverage only; the final interface and installed-extension clicks have not been rechecked live in Chrome.
- Archive coverage remains partial. Missing parent comments cannot be reconstructed, and voting/posting are unavailable in the reader.

# 0.24.0 preview

- Search: shared `AND`, `OR`, `NOT`, grouping, phrases and supported field queries across chat, profile and archived-community searches. Invalid queries explain the problem; archive pushdown uses supported fields and checks residual expressions locally. Profile and profile-search filters share outline icons.
- Your own profile: header search can search Saved, History, Hidden, Upvoted and Downvoted lists. Private list contents stay out of Arctic Shift requests. History is limited to Reddit's recent-view records; other lists retain Reddit's own limits.
- Archived communities: replace the duplicate search bar and feed tabs with Reddit's header search and native search-page controls. The feed uses community masthead geometry, an overlapping avatar, sidebar and sort/date/type dropdowns. One native `shreddit-feed-page-loading` community Snoo halo replaces grey skeleton cards in both feed and search.
- Banned-community search tabs left empty by Reddit are initialized through the native paging API and restored on exit. Comment results can include parent thread titles. Link-only cards display their destination domain instead of a missing-text warning; genuinely uncaptured removed text remains explicit.

Version choice: MINOR to 0.24.0 for the shared query language and own-list search features already integrated in this bundle. Archive presentation corrections are included in the same release. No new permissions or storage schema migration.

Validation:
- All 1207 tests pass, including native search restoration, query matching, paging, errors, opt-in title enrichment and both loading paths.
- Chrome remote debugging: compared the installed archive masthead against a normal subreddit; verified archived feed cards on r/greatawakening, one real native Snoo halo in a controlled pending state, and a 390px mobile layout without horizontal overflow.
- Live header search for `control` opened Reddit's scoped search page and returned archived post rows without a second search field. Native Comments navigation returned archived comments with parent titles. Verified visible Posts/Comments/Media tabs in the final 0.24.0 build.
- JavaScript syntax, archive integrity, and source/unpacked/archive byte equality verified.

Limitations:
- Archive coverage and metadata may be missing. Missing banner/avatar artwork uses a neutral banner and generic community icon; no original artwork is invented.
- The archive cannot rank by Reddit relevance. Relevance/Hot use newest first; Top and Most commented rank only loaded records. Keyword timeouts and locally filtered scans may return partial results; failures remain retryable.
- Private-community handling has synthetic coverage; this live pass used a banned community.
- This continuation's live validation focused on archived communities. Earlier own-list testing reported a status/result mismatch; that separate issue remains to be rechecked. Chat and own-list flows were not newly validated end to end here.

# 0.23.1 preview

- Profile search: clicking the native search field on a profile and pressing Enter with no text now opens that author's search results. Both the server-rendered input and Reddit's hydrated shadow-root textarea are supported. Nonempty queries, other fields, removed author scopes, composition and modified Enter retain Reddit's handling. The action requires public activity and archive discovery to be enabled.

Version choice: PATCH for a user-visible navigation bug fix. No new permissions or storage schema changes.

Validation:
- All 1067 tests pass, including empty Enter navigation, search-feed mounting and negative controls for both field structures.
- Reproduced before the fix in signed-in Chrome with the installed extension: empty Enter on u/spez left the profile URL unchanged.
- Reloaded the rebuilt extension and repeated the same real mouse/keyboard path: it opened `/user/spez/search/`, displayed native Posts/Comments/Media tabs and visible result cards (100 result nodes loaded).
- Direct signed-in fetch of `/user/spez/search/` with no query parameters returned HTTP 200, native search tabs and 4 native post units before extension processing.
- Package integrity and source/unpacked/archive byte equality verified.

Limitations:
- This fixes empty profile-search navigation. It does not fix the separately observed Reddit response-format error for nonempty post queries.
- Live validation used Chrome debugging; Brave was not separately tested.

# 0.23.0 preview

- Chat: deleted and banned accounts are now actually saved as such. Since the first release, `directory-model.js` was listed for both the page world and the extension world at the same injection time. Chrome injected it only into the page world, so every answer reached storage as "no answer" and the markers fell back to "Unavailable account". The classifier also starts as soon as Reddit's chat client attaches.
- Chat search: avatars that are already loaded appear immediately instead of starting as a letter and popping in.
- Profiles: comments their author deleted are marked "Deleted on Reddit" instead of "Arctic Shift snapshot · Current Reddit status unknown". Reddit's legacy info endpoint now refuses these checks (403), and Reddit answers a deleted comment exactly like one that never existed. Archive comments that Reddit still serves are marked available. Reddit's "New" sort no longer flashes on the Comments tab before Feed options replaces it.
- Profiles of unavailable accounts say plainly, in Reddit's own words, that the account was deleted or suspended, and show Reddit's own artwork (snoo-404 or the suspended snoo) instead of a default avatar.
- Post pages: a restored comment author opens Reddit's own profile card (karma, cake day, Follow, Start chat) like any other author. Restored authors with a custom avatar show it: the hover card offers only the full-body Snoovatar, and the extension now uses its published headshot. On a deleted comment's permalink, Reddit's "This comment no longer exists" toast says "Deleted comment retrieved from Arctic Shift" once the text is restored. Otherwise it plays unchanged.
- Docs: `docs/ghostddit-feature-gaps.md` lists 22 features from a live review of Ghostddit, with how we could build each.

Version choice: MINOR to 0.23.0 for the new profile card, account-state line and toast wording, plus PATCH-level fixes. No new permissions and no storage schema change.

Validation:
- All 918 tests pass.
- Checked live in Chrome:
  - Pulse8279 is saved and shown as deleted after a reload.
  - u/TheMLguy07's restored comments show the custom avatar and open Reddit's card.
  - The deleted comment on u/TheMLguy07's profile shows the trash icon.
  - The permalink toast shows the new wording.
  - The Comments-tab sort never becomes visible.
  - A deleted account's profile shows the new line and artwork.
  - Chat search avatars are complete when inserted.

Limitations:
- A comment removed by its author can't be told apart from one hidden because the subreddit was banned or made private; both show as deleted.
- The filter-pill × problem reported for chat search could not be reproduced. Sort, sender, typed-date and chat-list status pills all clear with a real mouse click.
- Result rows are still rebuilt twice as results refresh; their avatars no longer flash.

# 0.22.0 preview

- Chat: unavailable accounts are now told apart. Reddit's chat data only says "deleted" for both deleted and banned accounts; the extension asks Reddit's small public hover card (about 2-3 KB, works signed out) once per person who is actually on screen and has a known username, then remembers the answer. Deleted accounts show a trash icon, banned accounts a circle-slash, and ones not yet known the person-x icon, labelled "Deleted account", "Banned account" or "Unavailable account" (plus "Retained username"). Requests run one at a time, at least 2.5 s apart, pause on rate limits, and failures retry after about ten minutes without being saved.
- Chat: the marker now also appears in Reddit's own chat list (right side of the preview line) and inline next to the name in the room header, intro and message authors; in search results it always sits at the right edge, also on rows without a preview. Searching "banned" or "suspended" finds banned accounts.
- Phone layout: the chat search field is 40 px high, matching Reddit's mobile controls.
- Profiles: in compact view the status cue sits inline in the subreddit row instead of on its own line; the Comments tab shows the same Feed options button and grouped Sort / Activity menu as Overview and Posts.
- Archived-author avatars no longer use /user/<name>/about.json (unavailable signed out); they come from Reddit's hover card headshot.

Version choice: MINOR to 0.22.0 for the new deleted/banned distinction and the chat-list markers; no new permissions; the saved directory gains an accountStates map (older data stays readable).

Validation: all 911 tests pass; hover-card behaviour verified live for live, deleted and suspended accounts; chat markers verified live in Reddit's chat list, header and messages, and placement in the demo in full, floating and phone widths. Limitation: the end-to-end live check that a classification is saved and shown after reload, done after the fix in this release, is still pending (it was found and fixed from live evidence; the fix is covered by a regression test).

# 0.21.1 preview

- Calendar: compact again (264 px wide, 320 px tall for a five-week month; 240 px in floating chat), smaller than the pre-0.21 calendar, with Reddit's accents back: brand underline on the active On/Before/After/Between tab, today in the brand colour, brand selection and Apply. Days are rounded squares, presets stay on one row with short labels ("7 days"), and the status reads "Pick a day".
- Deleted chat accounts: names and avatars now also come from the deleted account's membership record in chats Reddit has already loaded, so they show in a browser where the extension never saw the person before. The "…" placeholder lasts at most 6 s instead of the whole chat-list load.

Version choice: PATCH to 0.21.1 for presentation and reliability corrections to 0.21.0.

Validation: all 890 tests pass. Live Chrome: calendar measured 264x320 in the room search, checked in light and dark with a selected range; the deleted account's chat shows the retained name everywhere (no "[deleted]" left on the page). Limitation: the new membership-record path was verified with tests and by confirming the record keeps the name in Chrome; it is not yet checked in the second browser.

# 0.21.0 preview

Work from the full review in docs/improvement-plan-2026-10.md (Phases 1, 2 and parts of 3, 4 and 6), done as five parallel workstreams.

- Chat search calendar redesigned: one header row (On/Before/After/Between, one preset row, month-year heading), 32 px circular days with a continuous range band, today ring and saved-messages dot together, fixed six-row height, 12-14 px text, visible focus on every control, proper dark mode, no clipping in floating chat, ARIA grid semantics and Shift+PageUp/Down for years. Global search no longer offers future days; the Quick ranges sub-view became preset chips.
- Deleted chat partners now show the username and avatar the extension saved while their account still existed, instead of "[deleted]" and the default avatar.
- Post pages: one malformed archived comment no longer stops restoration of the others; spoilers in restored comments stay hidden until revealed (and are keyboard-accessible); restored text survives Reddit re-rendering a comment; Reddit's own notices are never shown as "restored text"; pending placeholders give way after about 5 s; cues say "Removed on Reddit" and only say "by its author" when Reddit does; badges are keyboard-focusable.
- Profiles: the Hidden filter no longer labels items Reddit simply has not loaded yet; archive recovery retries quietly after transient failures (including Arctic Shift maintenance) instead of a permanent error; Refresh clears stale removed/deleted cues; settings changes apply once; archive-only items with unknown status use the archive icon. Discovery is several times faster on long profiles (jsdom: 400 cards 41.5 s -> 3.0 s).
- Chat reliability and privacy: a huge server cooldown can no longer block chat directory loading indefinitely; missing history metadata counts as incomplete and global search shows "Partial history"; pages without chat no longer scan the page every 1.5 s; each tab reads only the signed-in account's saved directory; Clear saved messages also removes recent searches.
- Popup: Clear actions ask for confirmation and say they apply to every Reddit account on this device; better contrast, forced-colors support and screen-reader links; unreadable settings show as unavailable.
- Archive requests: server cooldowns capped at one hour and the Arctic Shift backoff survives service-worker restarts.
- Tooling: deterministic, allowlisted packaging; minimum Chrome 111; hardened local dev relay and preview server.

Version choice: MINOR to 0.21.0 for the redesigned calendar and the new confirm-before-clear behavior alongside many fixes; no new permissions, and no storage schema change.

Validation: all 889 tests pass on a clean tree; jsdom timing for profile discovery as above; calendar and popup rendered in headless Chrome (light, dark, floating, narrow). Limitations: not yet re-checked live in Chrome for this release; deleted-account names can only be shown for people the extension saw before they deleted their account; plan items 3.1/3.2/3.4 (further discovery memoization), 3.8/3.10/3.11 (chat storage layout) and 5.2-5.4 (state split, module split) remain.

# 0.20.12 preview

- Leaving a profile while it is still loading and pressing Back now picks up where it stopped: unfinished searches restart, cards that were waiting to render finish, scheduled retries (including the Arctic Shift maintenance wait) keep their note and timing, and Refresh activity stays usable. Previously cards could stay as loading placeholders and the status could read "Activity checked" although loading had been cut off.

Version choice: PATCH to 0.20.12 for a reliability fix to 0.20.10's profile parking.

Validation: all 820 tests pass, including new cases for leaving mid-load, queued renders, scheduled retries and stale in-flight flags. ZIP integrity and source/stable-folder/archive byte equality pass. Not re-checked live in Chrome for this release; the scenarios were reproduced and verified in jsdom.

# 0.20.11 preview

- Feed options no longer changes under the reader: Reddit's original rows stay invisible from the moment Reddit renders the menu until discovery has grouped it into Sort, View and Activity, instead of being visible for about half a second first. If discovery ever fails to take over, the rows reveal themselves after 2.5 s. Discovery also starts slightly sooner by reusing the settings read made at page start.

Version choice: PATCH to 0.20.11 for a user-visible presentation fix; no new permissions or storage.

Validation: all 816 tests pass. Live Chrome on a profile load: native rows hidden from 352 ms (menu rendered) until the grouped menu at 941 ms; the opened menu shows Sort · New, View · Card, Activity · All. ZIP integrity and source/stable-folder/archive byte equality pass.

# 0.20.10 preview

- Back returns to the same place after any navigation away from a profile, not only after opening a post: subreddit, home feed and another user's profile too. Reddit keeps the profile's feed element and restores it with its own scroll offset; discovery now parks its state with that feed instead of removing its cards and re-inserting copies, and resumes when the feed comes back. Up to four profile views are kept; older ones, and all of them when discovery is turned off or the account changes, are cleaned up properly.
- Simpler internals: the saved-copy restore path, card cloning and the post-Back scroll correction are gone.

Version choice: PATCH to 0.20.10 for a user-visible reliability fix; no new permissions, requests or storage.

Validation: all 814 tests pass. Live Chrome on u/chuggingdeemer: Back from a post, a subreddit, the home feed and another profile returned the reading card to its exact offset, up to 15,000 px deep, with one discovery header and the discovered cards in place. ZIP integrity and source/stable-folder/archive byte equality pass.

# 0.20.9 preview

- Arctic Shift maintenance is recognized: its 503 "Under maintenance" (and other 502/503/504 outages) pauses all archive requests for a minute, doubling up to ten, instead of retrying every few seconds. The feed shows one quiet note, "Arctic Shift is down for maintenance. Retrying in about 1 min.", with Retry now sending a single probe. The next successful response lifts the pause.

Version choice: PATCH to 0.20.9 for a reliability fix; no new permissions or storage.

Validation: all 815 tests pass. Live during an actual Arctic Shift maintenance window: a single maintenance note with the one-minute retry. ZIP integrity and source/stable-folder/archive byte equality pass.

# 0.20.8 preview

- No more blank space while scrolling profile results, especially upward. Discovery's inserted cards broke assumptions in Reddit's feed virtualizer (placeholders in one top block, in stack order), leaving out-of-order, duplicate and detached entries that Reddit stopped at. While discovery owns a profile feed, the page bridge now drives that same controller from the document: it restores any placeholder within ~1.5 viewports wherever its entry sits, drops stale entries, and only virtualizes cards far above the viewport, in Reddit's own entry shape. Other feeds keep native virtualization; a released feed is fully restored first. This replaces the 0.20.7 restore helper.
- Back from a post or comment returns to the same place. Reddit keeps the profile feed while a post is open and restores its own scroll offset on Back, but discovery removed its cards on leaving and re-inserted them after return, so that offset was wrong by thousands of pixels. Opening a post now pauses discovery and leaves its cards in Reddit's retained feed; Reddit's restore then lands exactly. Other navigation still tears down and uses the remember/restore fallback.

Version choice: PATCH to 0.20.8 for two user-visible reliability fixes; no new permissions, requests or storage changes.

Validation: all 812 tests pass. Live Chrome on u/chuggingdeemer: 0 blank frames across ~5,700 wheel-scroll frames down and up plus fast flings, with no lost or duplicated cards; Back returned the reading card to its exact offset at 1,200 and 16,285 px. ZIP integrity and source/stable-folder/archive byte equality pass. Limitation: other kinds of navigation (for example profile → subreddit → Back) still use the older fallback and may not land exactly.

# 0.20.7 preview

- Restore already-loaded profile cards before their virtual placeholders enter the viewport. Use actual placeholder positions instead of repeating Reddit's cached-height calculation, which can drift after filtering or duplicate removal. Ask Reddit's own synchronous devirtualization method to reconnect its retained original nodes without waiting for feed hydration or another scroll event.
- Apply one viewport of overscan in both scroll directions. Large jumps continue in bounded chunks only while the native controller makes progress. Traverse Reddit's zero-height loader entries without inventing heights or changing its stack. Cancel stale work after navigation, feed/controller replacement or disabling discovery; unsupported contracts keep Reddit's normal behavior. No additional search/card requests are introduced.

Version choice: PATCH to 0.20.7 for a user-visible scrolling reliability fix. No permissions or storage/schema changes.

Validation: all 813 tests pass, including 78 bridge checks. All 34 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 38 assets. Live Brave inspection on chuggingdeemer's Comments profile confirmed the native controller retains original nodes and zero-height loaders, and that cached placeholder heights differed from the displayed layout. A temporary current-code patch reduced four visible blank placeholders to zero before the next paint on a large reverse jump; five subsequent forward/reverse checks also found zero visible blank placeholders. The complete installed bundle still requires an extension reload and Reddit refresh. This repair depends on the inspected internal native controller contract; it safely does nothing when that contract is unavailable. An extreme run of more than 8,192 zero-height stack entries retains native fallback behavior. The stable local export includes the user's pre-existing uncommitted profile verification scheduling change, preserved outside these commits.

# 0.20.6 preview

- Restore the existing comment avatar strategy: reuse a matching native headshot, then identity-checked `about.json` `icon_img`, with the hover-card fallback. Keep the stronger skeleton contrast; alternative profile metadata remains research only.
- Reapply recovered text, titles and media when returning to a profile, including retained native cards, native replacements and virtualized cards. Repeated reconciliation does not remount unchanged media. Restore the visible native or discovered card's viewport offset after Reddit reconnects the combined list; cancel the correction if the reader intervenes.
- Retain Arctic Shift's image previews, gallery metadata, video posters/streams and comment attachments, which the former text-only field projection discarded. Normalize a bounded media list and validate Reddit HTTPS hosts and stream identities. Put compact profile previews in Reddit's actual thumbnail grid cell, use Reddit's HLS player on opened posts, and display body-referenced comment images inline. Preserve signed URLs and existing restrictions; no media files or profile bodies are persisted.
- Keep the native selected-comment background painted while its author and content are loading, so the cream highlight covers the full skeleton instead of cutting off at the metadata row.

Version choice: PATCH to 0.20.6 for restoration, return-position and media reliability corrections. No new permissions or storage/schema changes.

Validation: all 811 tests pass. All 34 extension/demo JavaScript files parse; ZIP integrity, aliases and source/stable-folder/archive byte equality pass for 38 assets. Live Brave checks using temporary current-code patches confirmed retained recovered comments on Back with the same visible card and offset, a decoded 960×1482 inline comment image, a decoded native-sized profile thumbnail, and the uninterrupted native cream loading highlight. The complete installed bundle still requires an extension reload and Reddit refresh. Unprojected archive activity responses are larger but retain existing transport/record bounds; parent context requests stay projected. Archive availability remains incomplete, and expired signed video streams cannot be reconstructed. Opened archived galleries currently use ordered native image frames rather than Reddit's unverified carousel contract; image-bearing comments use the lightweight Markdown renderer, which may render complex formatting less faithfully than archive HTML. The stable local export includes the user's pre-existing uncommitted profile verification scheduling change; it remains preserved outside these commits.

# 0.20.5 preview

- Give archive restoration skeletons an opaque, theme-aware base instead of Reddit's nearly transparent shimmer token. Body, title and pending author/avatar placeholders remain visible in light and dark themes; native shimmer and reduced-motion support are retained.
- Replace the comment avatar `about.json` lookup with the native profile HTML fragment's identity-matched `reddit-page-data.profile.icon`. Reuse matching metadata or comment headshots already on the page before fetching. Preserve exact signed headshot URLs, image-host validation, bounded reads, cache and server cooldowns, with the hover-card fallback. Restored usernames still come from the archive snapshot.

Version choice: PATCH to 0.20.5 for avatar lookup reliability and restoration presentation corrections. No new permissions or storage/schema changes.

Validation: all 795 tests pass, including 99 focused native-bridge/restoration checks. All 34 extension/demo JavaScript files parse; ZIP integrity, aliases and source/stable-folder/archive byte equality pass for 38 assets. Live Brave inspection confirmed that the reported account's native profile fragment provides its signed headshot, while its hover card only provides full-body artwork. A temporary comparison using Reddit's actual shimmer component confirmed clearer skeletons in both themes and was removed after capture. The complete installed bundle still requires an extension reload and Reddit refresh. Native profile HTML is an internal client contract, not a guaranteed public API, and is larger than the old JSON response; bounded reads and caching remain. Reddit's public Data API migration announcement does not specify a removal date for the signed-in website's particular about.json route. The stable local export includes the user's pre-existing uncommitted profile verification scheduling change; it remains preserved outside these commits.

# 0.20.4 preview

- Restore comment avatars using the author's native comment headshot, preserving signed preview URLs when present, or Reddit's matching profile `icon_img`. Reject the full-body `snoovatar_img` artwork and use Reddit's SVG headshot clipping. Keep cached, bounded lookups, host validation and page-world credentials.
- Prepare deleted/removed comment notices in the document-start mutation guard after restoration preferences are known, before the delayed restorer scan. Mask the comment's own deleted avatar/name with placeholders while showing the body skeleton; normal replies remain visible. Keep the skeleton through bounded archive backoff and retain an avatar placeholder until its lookup settles. Empty archives and terminal failures restore Reddit's notice honestly.
- Enable Reddit's native Share menu for deleted/removed comments by restoring its comment ID and permalink, without enabling voting or replying. Reapply sharing when Reddit replaces an already processed comment, without another archive read. Opt-out restores the original attributes and controls. Include an in-progress profile retry check that preserves published cards under one continuation loader.

Version choice: PATCH to 0.20.4 for comment avatar, restoration presentation and native sharing corrections. No new permissions or storage/schema changes.

Validation: all 793 tests pass, including 300 discovery/native-bridge/thread checks. All 34 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 38 assets. Live Brave inspection confirmed the reported full-body hover-card image, the distinct profile headshot field, Reddit's signed native headshot markup and the deleted Share component's empty identity fields. Applying the Share identity repair in a temporary test tab opened the native Copy link / Share as post / Embed menu; votes and replies remained disabled. Initial pointer clicks were covered by the native chat overlay; the native control worked after uncovering it. The complete installed 0.20.4 bundle, cold-load paint sequence and final avatar appearance still require an extension reload and Reddit refresh. The stable local export includes the user's pre-existing, uncommitted profile verification scheduling change; that source edit is preserved and was not included in these commits.

# 0.20.3 preview

- Popup settings share one left edge instead of indenting further on each level; dependent settings stay dimmed until the setting they need is on, with a small connector stub.
- "About saved chat history" opens as an overlay instead of expanding in place, and status lines reserve their space, so the popup never grows a scrollbar or shifts. Default, overlay, long status and error states all measure 579 px in headless Chrome.

Version choice: PATCH to 0.20.3 for popup layout corrections.

Validation: all 784 tests pass; ZIP integrity and source/stable-folder/archive byte equality pass. Popup states rendered and measured in headless Chrome (light and dark); not yet checked on Windows fonts, where the headroom is about 20 px.

# 0.20.2 preview

- Deleted and removed posts always show their status cue on the post page, even when the Arctic Shift snapshot adds no text (it was captured after deletion) or the post is not archived; the tooltip says which. A deleted post's [deleted] author is replaced by the archived username in Reddit's author style, and comments whose snapshot text is [deleted]/[removed] still gain their archived author and cue while keeping Reddit's notice. Reported case: r/LenovoLOQ 1xark12.
- Tell author deletions from moderator removals by the wording of Reddit's banner (both use the same banner slot), so author-deleted posts show the trash cue instead of the ban cue.
- New detailed mascot icon (antenna-topped tinkerer with glasses, gear antenna and screwdriver among settings tiles), with a simplified head-and-glasses variant for 16/32 px and the popup header. Icons are rendered from the SVG sources with headless Chrome.

Version choice: PATCH to 0.20.2 for restoration and status corrections plus the icon artwork; no new permissions or storage changes.

Validation: all 784 tests pass. Live Chrome check on r/LenovoLOQ 1xark12: trash cue, archived author TheBrokenChad in Reddit's author style, tooltip noting the snapshot adds nothing more. ZIP integrity and source/stable-folder/archive byte equality pass.

# 0.20.1 preview

- Show restored images exactly like Reddit's image posts: the same rounded frame and hairline border, an aspect-ratio box at the image's own proportions (minimum 220 px, capped to the viewport), a blurred dimmed backdrop and the contained image on black. Live check: a restored removed post renders in the same 620×319 box as a native image post. Applies on post pages and in profile cards.
- Give restore skeletons the same design as the chat search skeletons: Reddit's pill shimmer with the same rhythm and line widths, and the same sweeping-highlight fallback, shown where the body or comment text will appear.
- Redesign the popup: grouped cards with icon tiles, Reddit-style switches, a nested hierarchy that dims dependent settings until the setting they need is on, a version chip, a compact chat row and light/dark themes. It fits Chrome's 600 px popup without scrolling.
- Replace the extension icon with an original tinkerer mascot (gear antenna, goggles, wrench) on Reddit orange, legible at 16 px. It is not Reddit's Snoo, which is Reddit's trademark.

Version choice: PATCH to 0.20.1 for presentation corrections and the redesigned popup and icon; no new behavior, permissions or storage changes.

Validation: all 781 tests pass, including the media builder structure and URL validation, skeleton fallbacks and popup behavior. All extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass. The image layout, skeleton, popup (light and dark, 600 px) and icon sizes were checked live in Chrome.

# 0.20.0 preview

- Restore deleted and removed content on post pages. Comments Reddit shows as "Comment deleted by user" or "Comment removed by moderator" get their archived text, the original author's name and Reddit profile picture (in Reddit's own comment and avatar markup), and a status cue; restored comments open so the text is visible. Removed or deleted posts get their archived title, body and, for image posts, the Reddit-hosted image inside Reddit's post element. A Reddit-style shimmer replaces the notice while the archive is asked, and every path settles back to Reddit's notice when nothing is archived.
- Fix removed posts not recovering when opened from a profile. After Reddit's in-page navigation the archive worker still saw the content script's first page (the profile) and refused the lookup; requests now carry the current page. Post pages are handled by a URL-driven thread module, so recovery works however a post is opened.
- Recognize Reddit's current deletion markup (notices, "[ Removed by moderator ]" titles, removal banners) everywhere, which also makes recovered text appear in profile Deleted cards, including link-post bodies and removed image posts' images.
- Render archived text through Arctic Shift's server-side markdown, rebuilt from a strict allowlist (no scripts, media, frames, styles or unsafe links), with a local renderer as fallback.
- Group Reddit's Feed options into Top-style Sort, View and Activity submenu entries that show the current choice; the menu stays inside the viewport. Use Reddit's own icons throughout, and show each item's real status: trash for deleted, ban for removed by moderators, eye-slash for hidden. Fix the Comments feed menu painting under the feed.
- Back to a profile reuses the rendered cards instead of re-rendering copies; separators return on fully hidden profiles; animations play only for cards inserted between Reddit's own; the tail card no longer jumps when results load; rate limits and timeouts retry with backoff behind a quiet note; Deleted no longer stalls or pauses on unrelated search errors; blocked profiles use credential-free search because Reddit refuses the legacy JSON route.
- Performance: the page-wide observer ignores feed changes the feed observer already handles, scroll virtualization swaps skip reconciliation, loader updates skip layout work when unchanged, All activity no longer pre-checks archive status that rendering proves (about half the Reddit requests for archive items), status checks batch through info.json when allowed, thread comments are only re-examined when new ones load, and Arctic Shift pages hold 100 records.

Version choice: MINOR to 0.20.0 for new user-facing features (post-page restoration with authors and images, grouped Feed options). No new permissions; archive data and avatars are not persisted; chat sync is unchanged.

Validation: all 779 tests pass, including new regressions for in-page-navigation authorization, post and comment restoration, skeleton settling, native author markup, menu grouping and teardown order, card reuse on Back, separators, status icons and the performance paths. All 33 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 34 assets. Live Chrome checks: profile -> removed post now restores title, image and cue (the reported r/TwentiesIndia case); Back returns all tagged cards as the same rendered elements with scroll kept; a deleted thread comment shows its archived text, author and avatar matching native neighbours; the grouped menu measures 157 px on Posts and Comments; separators appear on a hidden profile. Not done: inserting comments Reddit dropped entirely (planned), and Reddit's info.json is refused in the tested session, so status checks there use per-card reads. Archive coverage remains incomplete, and a snapshot never proves current deletion.

# 0.19.1 preview

- Name the search that failed in Reddit request errors. The previous "Reddit could not load public posts (HTTP n)" also appeared for comment searches.
- Treat an HTTP 403 from the cookie-free comment search as a pause, not a failure. That supplement is skipped for about ten minutes behind a muted note ("Some comments may be missing · Reddit is blocking logged-out search"), and its tooltip explains the cause. Signed-in search, the native feed and the archive continue, and coverage stays incomplete. Other failures remain explicit and retryable.
- Show errors and notes as Reddit's secondary text with a small icon (only the error icon is red) instead of plain red text.

Version choice: PATCH to 0.19.1 for a user-visible reliability and presentation correction. No permissions or persistent storage/schema changes.

Validation: all 747 tests pass, including new checks that a 403 from the logged-out stream becomes a note and pauses for the session, and that other logged-out failures remain errors. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. No live browser verification was performed.

# 0.19.0 preview

- Merge Arctic Shift records into profile New views automatically whenever the archive preference is on, alongside Reddit search; Deleted uses the archive in every sort. The separate archive button is gone. **Refresh activity** moves into Reddit's **Feed options** menu, and the toolbar above the feed collapses unless an error or paused-loading Retry needs to show.
- Load Reddit search and the archive independently. Continuation advances every provider at the shared frontier, and one provider's request no longer blocks the other. Repeat requests join the in-flight page.
- Bound the merge waits. Cards Reddit has already painted are never hidden again. Later native pages wait at most about 1.2 s for discovery coverage. A source unanswered after 2.5 s stops holding back the others, and its late results are still placed by date.
- Fetch 100 archive records per page instead of 25 (a live probe measured about the same latency). Fill archived comment post titles through a batched, cached archive lookup, show snapshot dates in cues, and honor `X-RateLimit-Reset-At`.
- Check archive candidates through one queue. The page bridge asks Reddit's info endpoint once per batch of up to 25 items (own 4 s deadline) and falls back to native card fragments, which remain the authority. Any info failure suspends the fast path for ten minutes. Deleted keeps up to one page of unchecked candidates ahead instead of waiting for every check.
- When Reddit no longer serves a deleted item and an archive snapshot exists for that item and author, show the snapshot in Reddit's own card layout, attributed in the cue, instead of a bare link with a Recovered text box. Items without archive text keep a Retry row built from Reddit's button and text classes.

Version choice: MINOR to 0.19.0 for the new automatic archive merge and the Feed options Refresh entry, a substantial compatible expansion of profile discovery. No new permissions or persistent storage/schema changes; archive data is still not persisted, and chat sync is unchanged.

Validation: all 745 tests pass. New regressions cover painted-card visibility, bounded native and source waits, automatic and Refresh archive starts (off without opt-in and outside New/Deleted), independent provider continuation, 25-item status batches, Deleted look-ahead, archive-card fallbacks, the Refresh menu row, 100-record archive pages, title fill and its failure modes, snapshot dates, the info fast path with its 403/timeout/foreign-author fallbacks, and Reset-At cooldowns. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Per the requested scope, there was no live browser verification. In particular, whether Reddit's info endpoint answers a signed-in session (otherwise the fragment fallback applies), how deleted comment fragments render, and the timing of the new wait budgets are unverified on real profiles. Reload Reddit Tweaks and refresh Reddit to activate the bundle. Search-index and archive coverage remain incomplete, and an archive snapshot never proves current deletion.

# 0.18.17 preview

- Retry an unrecognized profile-search continuation response once at the same cursor before showing a pause. Keep strict response validation, cancellation, server cooldowns and explicit repeated failures; an unknown response never counts as exhausted history.
- Retry loading resumes only failed Reddit search sources at their retained cursors instead of restarting healthy sources from the newest page. Preserve existing cards and Hot ranking. Refresh activity retains its explicit refresh behavior.

Version choice: PATCH to 0.18.17 for profile continuation recovery and retry reliability. No permissions, persistent storage/schema or chat sync changes.

Validation: all 718 tests pass, including 241 discovery/native-bridge checks. Five new regressions cover transient recovery, bounded repeated failure, cursor-specific manual retry, Hot ordering, first-page recovery and cancellation/rate-limit exclusions; four recovery regressions fail against 0.18.16. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspection found the reported profile paused on an unrecognized cookie-free comment-search response after the other sources ended. Re-reading the same cursor succeeded. Resuming that source in the existing 0.18.16 tab advanced from 28 to 33 source pages, preserved existing card objects and cleared the pause and source errors. The original failing response body was unavailable, so its precise HTML cause is unconfirmed. The complete 0.18.17 bundle still needs an extension reload and Reddit refresh; live recovery used the existing continuation path, while new retry behavior was validated with synthetic tests. Search coverage and server responses remain external limitations.

# 0.18.16 preview

- Preserve native card-bearing continuation wrappers while merge gating is active, and collapse orphaned native separator runs inside known nested feed batches and pager wrappers. Keep visible card boundaries and leave rules inside card and media content untouched. Nested virtualization retains original native cards and restores presentation on opt-out.
- Live inspection of 0.18.15 showed 30 rules in a 25-card batch; eight approximately 0.555-pixel rules stacked between seven zero-height load-more observers. Each observer contained a native card, but merge-waiting styling hid the wrapper. The corrected installed bundle has not been verified in the browser.

Version choice: PATCH to 0.18.16 for the profile-feed separator and card visibility reliability correction. No permissions or persistent storage/schema changes.

Validation: all 713 tests pass, including nested separator, card-bearing wrapper and virtualization regressions. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live inspection confirmed the 0.18.15 cause, but browser access ended before the corrected CSS or complete installed bundle could be checked. A partial JavaScript diagnostic was applied to the existing tab; reload the extension and refresh Reddit to replace it and check the final appearance.

# 0.18.15 preview

- Collapse orphaned runs of standalone native profile-feed separator rules when extension filtering or merge gating hides intervening cards. Keep one boundary between visible cards, preserve normal native boundaries and unrelated rules, and restore rules on opt-out. Original and virtualized nodes remain in place; the extension does not generate separators.
- The supplied computed styles identify a one-pixel native rule with no margin. Synthetic fixtures reproduce stacking when hidden cards are skipped, but the number of rules in the live report and the final installed appearance remain unverified.

Version choice: PATCH to 0.18.15 for the profile-feed separator reliability correction. No permissions or persistent storage/schema changes.

Validation: all 711 tests pass, including synthetic separator regressions for hidden and gated cards, native boundaries, virtualization and opt-out restoration. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. No live browser or installed-build verification was performed; reload the extension and refresh Reddit to check the final appearance.

# 0.18.14 preview

- Keep profile feed borders supplied by Reddit. Remove generated card separators and stop hiding native horizontal rules around the feed, toolbar and loader; supplemental linear progress suppression remains scoped separately.
- Earlier fixes created rules with Reddit utility classes inside extension card wrappers and later hid some native rules. Matching classes alone do not establish matching layout. The precise cause of the reported vertical thickness has not been verified with computed styles.
- Document observed profile-history visibility signals and their limits. No speculative request-skipping based on a profile visibility assumption is introduced; search and archive coverage remain incomplete.

Version choice: PATCH to 0.18.14 for the profile border correction. No permissions or persistent storage/schema changes.

Validation: all 708 tests pass. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Synthetic regressions cover native separators through hydration, filtering and virtualization, and preserve native rules around controls and the loader. No live browser or installed-build verification was performed; the precise visual cause of the reported thickness remains unverified. Reload the extension and refresh Reddit to apply the bundle.

# 0.18.13 preview

- Fix the page-unresponsive regression introduced by 0.18.12 scroll preservation. The loading observer was responding to temporary inline feed-style writes by starting another viewport transaction, which wrote the same styles again and indefinitely restarted the mutation microtask. Exclude feed style records from loading-state triggers while retaining native loader visibility/content observations.
- Hide the actual horizontal rules identified in the supplied inspector screenshot around the extension toolbar and native continuation. Include loader-owned shadow rules, retain card/body separators and restore native presentation on opt-out. The earlier progress-only selectors did not target this divider.

Version choice: PATCH to 0.18.13 for the responsiveness regression and divider correction. No permissions, persistent storage/schema or chat sync changes.

Validation: all 708 tests pass, including 231 discovery/native-bridge checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. A bounded regression detects six recursive callbacks on 0.18.12 versus none from viewport style writes with the fix, verifies timers run and confirms actual native loader changes remain observed. Divider checks preserve native halos and card/body rules and verify opt-out cleanup. Diagnosis used the supplied inspector screenshot and extension-level synthetic diagnostics; no browser automation or installed-build verification was performed. Reload Reddit Tweaks and refresh Reddit. If the previous build has frozen a tab, disable the extension and reload that tab before enabling the corrected build.

# 0.18.12 preview

- Preserve the reading position across complete profile batch updates, including enrichment, native card visibility, filtering and loader handoff. Temporarily protect the feed height against intermediate bottom clamping and suppress native anchoring only during the synchronous update, then compensate the retained reading card once. Restore original inline style values and priorities; leave no permanent spacer.
- Keep an already displayed discovery in its current slot while a matching incoming native duplicate is still gated, avoiding an empty gap before native handoff.
- Suppress supplemental linear progress tracks in native feed/continuation components while retaining the Snoo halo. Scope shadow styles away from card/media roots, avoid duplicate injection and restore native presentation on opt-out.

Version choice: PATCH to 0.18.12 for bottom-scroll stability and loading presentation in existing profile discovery. No permissions, persistent storage/schema or chat sync changes.

Validation: all 706 tests pass, including 229 discovery/native-bridge checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Three scroll regressions fail on 0.18.11 and pass here: late enrichment, temporary bottom clamping and gated duplicate collapse. Additional coverage checks native halo retention, scoped media controls and loading-style cleanup. Validation used extension code and synthetic layout diagnostics without browser automation, as requested; the installed browser and exact screenshot element were not inspected live. Reload Reddit Tweaks and refresh Reddit to activate the bundle. Final document shortening at known exhaustion remains constrained by the browser's actual scroll range; no blank space is retained merely to preserve an impossible offset. Native response latency and search-index coverage remain external limitations.

# 0.18.11 preview

- Coordinate incoming native profile pages with discovered activity in New / All activity. Keep new native cards out of the displayed layout until discovery covers their dates and preceding discovered cards are ready, then reveal the combined chronological prefix. Retain the original native cards and already published discoveries through reverse scrolling and refresh.
- Pause the native continuation while its new cards wait and retain one shared native halo. Predictive continuation now follows the combined displayed prefix rather than a distant, uncovered native tail. A full buffer of older deferred discoveries cannot strand the shallower search cursor. Ignore pagination markers embedded inside individual cards.
- Remove temporary merge gates on filtering, navigation and opt-out, transfer them through native virtualization, and release native results after a failed initial discovery while keeping the source failure explicit and retryable.

Version choice: PATCH to 0.18.11 for mixed-feed ordering and continuation reliability in existing profile discovery. No permissions, persistent storage/schema or chat sync changes.

Validation: all 702 tests pass, including 225 discovery/native-bridge checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. The two mixed-feed regressions fail on 0.18.10 and pass with the fix. Additional checks cover automatic cursor progress, CSS and loader ownership, retained native identity, virtualization, full deferred buffers, failures, filtering and opt-out. This bundle was validated through extension code and synthetic diagnostics without browser automation, as requested; installed-build behavior was not rechecked live. Reload Reddit Tweaks and refresh Reddit to activate it. Search-index coverage and native response latency remain dependent on Reddit; source failures do not establish complete history. Chronological coordination applies to New, while Top and Hot retain their existing loaded-result ordering.

# 0.18.10 preview

- Recover a native-card transport timeout, transient gateway error or failed fetch once before exposing a manual Retry row. Keep the pending card behind the shared native loader during recovery, preserve its identity and native actions on success, and retain explicit failures after the bounded retry. Manual Retry starts a fresh attempt; definitive missing/malformed cards, canceled views and rate-limit pauses do not enter the retry path.
- Prepare up to four comment cards concurrently while retaining two physical post slots and a shared four-read ceiling across native render/status consumers. Keep status batches at two workers, native-fragment coalescing, bounded page-world caches and server cooldowns. Parallel responses still publish only the chronological ready prefix.
- Correct current documentation of native throughput and remove obsolete rolling card-count quota descriptions. Search-page timeout recovery and bounded predictive prefetch from 0.18.9 remain in place.

Version choice: PATCH to 0.18.10 for transient native-card recovery and comment-loading throughput in existing profile discovery. No permissions, persistent storage/schema or chat sync changes.

Validation: all 695 tests pass, including 218 discovery/native-bridge checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. The timeout-recovery regression fails on 0.18.9 and passes with the fix. New checks cover bounded retries, manual recovery, definitive-error exclusions, four-comment ordered publication, mixed post/comment capacity, and status/render saturation without exceeding the shared physical ceiling. Live Brave identified the screenshot's exact native-card timeout; a later authenticated read returned the matching card successfully in about 0.36 seconds. Final installed-build verification requires reloading Reddit Tweaks and refreshing Reddit. Persistent native/API failures remain retryable, and server latency/coverage cannot be guaranteed.

# 0.18.9 preview

- Fix the 0.18.8 ordering regression when Reddit's native profile feed is populated and signed-in search returns an empty page with a valid continuation. Such a page retains its cursor but cannot establish an infinite date boundary that blocks healthy public-search discoveries. Older native-horizon deferrals also no longer strand newer candidates that need another source page.
- Prime one additional cursor round on initial automatic discovery when the unpublished buffer has room, including archive-only profiles. Prefetch ahead of the feed tail between completed hydration batches as well as during active hydration, retaining the existing buffer, concurrency, cooldown and route-cancellation limits. Reddit still controls result page sizes; no larger unsupported Shreddit limit or full-history background walk is introduced.
- Retry a timed-out Reddit discovery read once at the same scoped cursor without discarding populated cards. Cancellation, rate limits and malformed responses do not retry. Persistent failures remain explicit and incomplete. The reported Reddit timeout is the existing 10-second accepted-request deadline, distinct from queue deferral and archive timeout messages.

Version choice: PATCH to 0.18.9 for mixed-feed visibility, predictive loading and transient timeout recovery in existing profile discovery. No permissions, persistent storage/schema or chat sync changes.

Validation: all 687 tests pass, including 150 discovery checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. The new native-plus-empty-cursor regression fails on 0.18.8 and passes with the fix. Live Brave reproduced zero signed-in comment cards with a valid continuation, ten public comment cards and a populated native feed on chuggingdeemer. Tests also cover bounded distant initial look-ahead, predictive loading between batches, archive-only priming, preserved native objects, same-cursor retry, persistent errors, cancellation and rate-limit exclusions. Final installed-build verification requires reloading Reddit Tweaks and refreshing Reddit. Empty streams retain continuation but can wait behind nonempty source boundaries; source coverage and individual network/card latency remain incomplete.

# 0.18.8 preview

- Coordinate New publication across posts, authenticated comments, public comments and opted-in archive streams. Establish initial source boundaries, publish only their shared chronological prefix and paginate the shallowest stream first. Hydrate native cards in combined order rather than staged DOM arrival order, so delayed comments do not push already-published older posts downward.
- Retain source boundaries in the existing account-scoped page-session snapshot. Resume a ready batch when a temporary boundary clears, retain populated native objects and preserve the visible card's offset during reconciliation without overriding an intervening user scroll. Existing native virtualization and shared native halo ownership remain in place.
- Start Deleted archive discovery alongside an in-flight Reddit search. Return native status evidence in incremental pairs rather than withholding a whole page behind a slow fragment, skip known available/search-only unknown candidates and drop irrelevant queued hydration on activity changes. Continue to require current deletion/removal proof before labeling a snapshot Deleted.
- Stop Deleted continuation when the relevant archive source is exhausted; unrelated live-search cursors cannot leave its halo spinning forever. Wait for pending verification before advancing its archive cursor, avoid per-frame continuation retries during that wait, and keep failed/unknown checks explicitly incomplete and retryable.

Version choice: PATCH to 0.18.8 for mixed-profile ordering, Deleted latency and loader reliability in the existing discovery feature. No permissions, persistent storage/schema or chat sync changes.

Validation: all 680 tests pass, including 143 discovery checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Regressions cover unequal mixed-source depths, delayed initial comments, active-boundary resumption, incremental verification, activity-switch queue pruning, Deleted exhaustion, archive continuation, Top archive boundaries and viewport compensation. Live installed-build verification requires reloading Reddit Tweaks and refreshing Reddit. Search/archive coverage and current-status verification remain incomplete; network/native-fragment latency can still delay individual items. Top/Hot order currently loaded activity, since chronological archive pages cannot guarantee lifetime score/relevance ranking.

# 0.18.7 preview

- Supplement authenticated comment discovery with a cookie-free public Reddit search stream in Comments and Overview. A live uncached comparison for the reported chuggingdeemer profile returned zero signed-in cards and ten public cards from r/TheLaptopGuide; a matching authenticated native comment fragment also returned successfully.
- Give each comment stream independent, scope-bound cursors, exhaustion/failure state and metadata precedence. Deduplicate full comment IDs, prefer signed-in metadata regardless of arrival order, preserve restriction flags and display successful sources progressively. Failed sources remain explicit and retry on Refresh without blocking healthy continuation. Keep cookies and account settings unchanged, bypass HTTP cache for both discovery variants, and retain authenticated native rendering/actions.
- Preserve all returned native comment cards up to the existing response bound; validate empty/error responses and continuations, and retain available parent IDs for reply context. Allow bounded local provider backpressure to settle rather than failing a third Overview source after only two short waits.
- Consume pending native virtualization swaps before reconciliation/cleanup so a concurrent result completion cannot reinsert an original card that Reddit has just placed in its retained scroll stack. Preserve consumed filter/hydration updates before paint and ignore obsolete placeholder records.
- Wait for a native card's component definition and first render before publishing its populated prefix. Missing modules stay behind the shared loader until the existing timeout produces a retryable error; canceled or replaced views cannot receive the result.

Version choice: PATCH to 0.18.7 for missing public-comment coverage and blank-region reliability fixes in existing profile discovery. No new permissions, persistent storage/schema changes or chat sync changes.

Validation: all 670 tests pass, including 193 targeted discovery/native-bridge checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. The synchronous placeholder regression failed before the fix by reconnecting the detached original prematurely and passes afterward with the same populated object retained. Live Brave checked public versus signed-in comment search, author/community metadata and authenticated native rendering. Final installed-build UI verification requires reloading the extension and refreshing Reddit. Search/archive coverage remains incomplete; Reddit may refuse individual reads, and native response/rendering contracts can change.

# 0.18.6 preview

- Retain the combined native/search/archive profile feed while opening a post, even when Reddit removes the profile tabs ahead of the feed. Track actual native objects, including virtualized originals, until the post view takes over; canceled navigation preserves the same cards and filters, while replacement views and opt-out clean up immediately.
- Recognize Reddit’s programmatic profile continuation alongside lazy continuations. Defer unpublished older discoveries to the appropriate native page, and keep published cards populated and visible through pagination-marker changes.
- Prepare groups of up to 25 cards two viewports ahead, publish their ready prefix in order, and overlap a next source read with hydration near the tail. Bound the unpublished buffer, including deferred discoveries, so prefetch cannot become a history crawl. An idle native loading halo still owns the visible loading UI but no longer blocks extension continuation.
- On reverse-scroll animation frames, ask Reddit’s existing virtualization controller to restore its retained original cards. Do not reconstruct cards, fetch them again, edit the native stack or implement a second virtualized list. Scope the optional adapter to enhanced profile feeds and reject queued work after route/view replacement or opt-out.
- Document the observed native profile pagination and session-dependent owner presentation. Native and search page sizes differ, and deduplication/filtering means a source page cannot guarantee an identical number of new combined-feed cards.

Version choice: PATCH to 0.18.6 for profile transition, pagination and scrolling reliability. No permissions, persistent storage/schema or chat sync changes.

Validation: all 659 tests pass, including 182 targeted discovery/native-bridge checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspected mixed feeds, native 25-post continuations, retained virtualization objects/controllers, post navigation and authenticated/cookie-free owner-page presentation. Final installed-build verification requires reloading the extension and refreshing Reddit. The native controller is an undocumented, feature-detected contract; server latency, failed native fragments and incomplete search/archive coverage remain possible.

# 0.18.5 preview

- Use Reddit’s native Shreddit post search for ordinary/curated profile discovery after live result-ID/order comparisons across New, Hot and Top. Parse crossposts as outer results, exclude embedded originals, retain their own author/time/counters and restrictions, and follow only matching same-origin continuations. Full post cards and actions continue to use Reddit’s authenticated native renderer; search snippets are not fabricated as complete text or deletion proofs.
- Preserve authenticated JSON discovery for explicitly blocked profile states: signed-in Shreddit returned fewer posts in the live comparison. Bind each post cursor to its transport, author, sort and time range so pagination cannot mix sources. Genuine empty searches are distinguished from changed/error HTML, and native pages are not silently truncated at the previous JSON page size.
- Preserve archived-body restoration for metadata-only discovery: attach a matching author/ID Arctic Shift body only after native deletion/removal evidence, retain restriction flags and leave available native text unchanged.
- Keep the extension’s loading sentinel as a stable insertion anchor when Reddit has no native continuation. Unchanged reconciliation previously moved published cards past the sentinel and then moved the sentinel back. Remove that unnecessary DOM churn, preserving hydrated card identity and placeholder restoration during reverse scrolling.
- Document the proposed authenticated plus cookie-free comment discovery streams, with independent cursors/errors, ID deduplication, shared bounded scheduling, native authenticated rendering and incomplete-coverage handling. Comment credentials are unchanged in this bundle.

Version choice: PATCH to 0.18.5 for profile discovery compatibility and scroll reliability. No persistent storage/schema changes, new permissions or additional chat sync loop.

Validation: all 648 tests pass, including 179 targeted profile/model/bridge checks. All 31 extension/demo JavaScript files parse, and ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. The scroll regression reproduced eight unnecessary child-list changes across two unchanged scans before the fix and zero after it, including virtualized-card restoration. Live Brave compared public result IDs, native pagination, crosspost structure, Top’s empty state and signed-in/cookie-free differences; findings and coverage limits are in docs/profile-search-sources.md. Final installed-build scroll verification requires reloading the extension. Search/API coverage and undocumented native contracts remain incomplete/changeable; blocked detection depends on Reddit’s explicit current profile marker.

# 0.18.4 preview

- Replay the native chat-cache connection when the isolated storage listener attaches after the page-world client. This closes a startup race where loaded memory events were replayed, but disk-only history waited until a search opened. All/Messages and room search can remain closed while the extension imports Reddit’s existing local history and captures native events.
- After a saved-read deadline, check worker responsiveness independently of storage queues. Slow reads retain the local Refresh action; an unresponsive worker receives extension-reload and tab-refresh instructions instead. Concurrent checks share one bounded probe, context invalidation stays terminal, and neither case clears saved data.
- Refine selected filters in global and room search with a subtle accent background and stronger label weight, without check marks or a reserved indicator column. Sender, attachment, chat-type, status and sort choices retain their existing selection behavior. This cosmetic follow-up keeps version 0.18.4.
- Preserve account checks, one reconciliation per native attachment, truthful incomplete coverage and the existing committed-read path. No second Reddit sync loop, network history crawl, storage-schema change or new permissions.

Version choice: PATCH to 0.18.4 for background chat-capture startup reliability.

Validation: all 640 tests pass, including independent worker health, concurrent probe deadlines, invalidated contexts and a startup regression reproduced failing before the fix with a deliberately late storage listener, disk-only history, no search calls and no repeated import on native sync. The filter refinement also passes 102 targeted search/interface checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave reproduced the reported 15-second saved-read timeout while Reddit’s client was ready, but even unrelated extension-worker messages stalled; that separate live worker failure still requires a restart diagnostic and is not claimed fixed by this handshake change.

# 0.18.3 preview

- Preserve extension-discovered hidden/deleted/archive cards and active filters while Reddit keeps the outgoing native profile feed visible during a tab change. The URL and selected tab can change ahead of the data; bind cleanup/remount to the actual native feed handoff instead.
- Recognize replacement feeds and in-place native content replacement, retain virtualized native identities, preserve state on canceled tab changes, and prevent late outgoing responses from entering the incoming tab. Unavailable-account archive views keep their existing owned-tab behavior; other account transitions and opt-out still clean up immediately.

Version choice: PATCH to 0.18.3 for a visible native profile tab-transition reliability fix. No permissions, persistent storage or request-policy changes.

Validation: all 636 tests pass, including 115 discovery tests and six new tab-handoff regressions. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave tracing with temporary latency reproduced the old behavior: the URL/selection changed, extension cards disappeared while the same Posts feed remained connected, and Reddit replaced that feed later. Temporary diagnostics and network throttling were removed. Final installed-build verification requires an extension reload; undocumented native view ownership contracts can change.

# 0.18.2 preview

- Verify archive item status with Reddit's authenticated native card fragments rather than the legacy info endpoint, which can return HTTP 403 while card rendering works. Share in-flight reads and a bounded, transient page-world fragment cache between status checks and rendering. Preserve archive text provenance, author/identity checks, restrictions and explicit unknown status. Show optional verification limitations quietly without treating archive discovery as a failed load.
- Apply Activity filtering to the native feed before paint, including newly inserted and hydrated cards, without removing native cards from the client list. Preserve original visibility through virtualization placeholder swaps and restore it on All, cleanup or opt-out.
- Retain populated extension card objects when a native duplicate arrives, including objects held in Reddit's internal virtualization stack. Do not expose unfinished cards after a duplicate race. Reverse scrolling can restore the same hydrated objects without clearing and rebuilding their contents.
- Keep the tail sentinel measurable while a native continuation loader owns the visible halo. Loader ownership no longer changes merely because a loader is outside the viewport, preventing adjacent native and extension halos from appearing together during scrolling. Native component hidden states receive an explicit display rule.
- Isolate cancellation among consumers sharing a native read. A status deadline cannot cancel a card still using the response; completed verification evidence survives a partial timeout. Physical fragment requests remain bounded to two; server cooldowns and route cancellation remain enforced.

Version choice: PATCH to 0.18.2 for archive verification, pre-paint filtering, retained-card scrolling and duplicate-loader reliability corrections. No new permissions, persistent data schema or chat sync behavior.

Validation: all 630 tests pass, including 157 discovery/native-bridge checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspection confirmed the blocked JSON/native-fragment distinction, adjacent native/extension loaders, and Reddit's retained virtualization stack and same-object restoration contract. Final installed 0.18.2 verification requires reloading the unpacked extension. Reddit may still refuse or omit individual fragments, and missing verification remains unknown; archive coverage is incomplete. Undocumented client contracts can change.

# 0.18.1 preview

- Keep one native Reddit halo at the end of the feed while cards and further pages load, including comments in Overview. Stage unfinished cards outside the visible feed and publish ready cards in order. Reattach the same tail if native reconciliation removes or overtakes it; dormant, hidden and offscreen native loader components do not suppress it. Observe native loader shadow completion so continuation can resume without another scroll.
- Remove the eight-page lifetime cap and artificial rolling 8-read/30-card quotas. Continue on demand with validated source cursors, bounded concurrency, timeouts, route checks and Reddit Retry-After. Retain original native sort horizons for All activity and do not claim complete archive/history coverage.
- Combine Comments sorting and Activity in one native dropdown at the existing sort position, showing the current sort such as New. Reuse the native button/caret, menu rows, Top submenu and positioning; restore the original sort control on opt-out, replacement and cleanup.
- Make Deleted start opted-in Arctic Shift discovery, including after an in-flight Reddit read, and prefer archive continuation in that mode. Verify current deleted/removed status instead of treating every snapshot as deleted. Older filtered archive candidates are no longer held behind the unfiltered native feed horizon.

Version choice: PATCH to 0.18.1 for user-visible loading/continuation and Deleted-filter reliability fixes, plus the requested Comments control correction. No permissions, storage schemas or private chat synchronization changes.

Validation: all 606 tests pass, including 133 targeted discovery/native-bridge checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspection confirmed the native Comments sort button/caret and reproduced the missing archive lookup and separate controls on the reported profile. Final installed-build verification requires reloading the unpacked extension. The live Reddit metadata endpoint returned HTTP 403 during diagnosis; native card evidence can still qualify status, but failed or unavailable verification never proves deletion. Archive availability/coverage and undocumented native client contracts remain variable.

# 0.18.0 preview

- Preserve Reddit's Feed options trigger and sort/view rows. Add one Activity entry opening All activity, Hidden and Deleted within the same dropdown, with native icons, checkmark, Back and Escape behavior. Missing controls on deleted/banned profiles reuse Reddit-rendered controls with native Top/view actions; Comments uses the native icon-only variant beside View where available. Reduce Refresh to the adjacent 16px visual size.
- Use retained native empty-state markup, with a last-verified native rpl fallback and adapted loaded-activity copy. Count matching original and extension cards, suppress empty states during unfinished work/failure/continuations, and restore native nodes on All or opt-out.
- Remove the artificial 12-per-30-second card bottleneck: one 25-card page now fits inside a bounded 30-start window, retaining two concurrent renders and server Retry-After. Publish each contiguous ready prefix, show successful Overview sources before slower peers, and render archive records before optional metadata finishes. Keep source errors through secondary work and Back.
- Keep Reddit's bottom continuation visible through queued cards, pending reads/enrichment and further pages, including when existing results are present. Pauses offer Retry; the automatic page limit offers an explicit cursor-preserving Continue loading action. Known exhaustion removes the loader.
- Add Restore deleted content automatically, on by default within the separate Arctic Shift opt-in. Recover eligible visible deleted/removed profile posts/comments in bounded author-verified batches, and check opened deleted posts once their exact native identity loads. Display available original text by default, retain native/archive NSFW and spoiler restrictions, and discard opted-out or stale results. Missing archive text is never invented.

Version choice: MINOR to 0.18.0 for the new automatic-restoration preference and behavior, bundled with native interface and loading corrections. No new permissions, persistent profile content, chat sync loop or storage-schema change.

Validation: all 596 tests pass, including 161 targeted discovery/native-bridge/model/broker/popup checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspection verified native menu/empty-state markup and selection glyphs; a temporary first-party fragment probe retained the working native Top submenu and bottom-start positioning and was removed. Final installed 0.18.0 appearance, end-to-end restoration and continuation require reloading the unpacked extension. Provider latency/availability and archive coverage remain variable/incomplete; native undocumented contracts may change. No live speedup benchmark is claimed. Automatic restoration cannot reconstruct text absent from the archive.

# 0.17.0 preview

- Add All activity, Hidden and Deleted choices to Reddit's native Feed options menu. Reuse native menu components, preserve original cards and restore them on opt-out. Hidden covers public results absent from the loaded feed; Deleted includes verified deleted/removed items and excludes unknown archive snapshots.
- Use monochrome native hide/delete indicators without colored backgrounds or a help cursor. Match the chat search refresh glyph and size.
- Reuse Reddit's actual continuation-loading component; remove orphan loaders on remount and suppress an additional halo during native feed reload. Retain hydrated sidebar DOM across profile transitions and prepare validated eager native modules before revealing sidebar text.
- Start independent Overview reads together and prepare hidden card groups in two existing native renderer slots. Reveal groups in order before optional reply metadata settles. Keep request/page budgets, native pagination, completed cards and partial Back restoration; reject stale parallel completions.

Version choice: MINOR to 0.17.0 for the new profile activity filters, bundled with loading and navigation reliability improvements. No new permissions, persistent profile data, chat sync loop or storage-schema change.

Validation: all 570 tests pass, including 131 targeted model/discovery/bridge/broker checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspection confirmed Reddit's native Feed options structure, hide/delete paths, Boolean deletion property and continuation component rendering its own halo. Installed 0.17.0 visual/end-to-end checks require reloading the updated unpacked extension. Provider availability and archive coverage remain incomplete, filters cover discovered/loaded activity, and Reddit's undocumented native contracts can change. Optional metadata failures do not hold up ready cards.

# 0.16.4 preview

- Hydrate Reddit's native grid controller with the recovered left sidebar, restoring collapse, hover and saved navigation behavior. Discover validated native bootstrap metadata rather than copying new event handlers.
- Restore missing comment author and “replied to” headers. Reuse loaded parents, batch native lookups and use the enabled archive provider for unresolved parents, restricted to children already discovered on this profile/tab. Preserve complete native headers and verify thread identity.
- Match native profile continuation: one halo at the feed tail, six prepared cards revealed together, then the next bounded group/page as scrolling reaches it. Keep completed cards and partial Back state; pause failures and avoid false empty states, placeholder-filled scrollbars and loader anchoring jumps. Native feeds keep their own pagination.

Version choice: PATCH to 0.16.4 for existing profile metadata, navigation and loading corrections. No new permissions, persistence or schema change.

Validation: all 556 tests pass, including 117 targeted model/discovery/bridge/broker checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live inspection verified native reply markup, the continuation loader and the missing grid bootstrap; loading it restored collapse/expand, and the original preference was restored. Reddit metadata returned HTTP 403; direct archive diagnostics were blocked, so provider-dependent installed recipient recovery and final appearance still require reloading the bundle. Missing archive data remains incomplete; Reddit's undocumented contracts can change. Temporary relationship proofs expire in ten minutes or when worker memory is released.

# 0.16.3 preview

- Correct the loading hierarchy: use one native Snoo halo for initial feed loading and quiet native shimmer skeletons for pending cards.
- Preserve Reddit-rendered card identities instead of injecting banned/deleted account artwork into community cards. Archive-only fallbacks use community icons for community activity and the owning user identity for profile-hosted posts. Keep unavailable-profile header artwork at its native 64px size.
- Prefer validated compatible reload contracts from Reddit-owned cards, preserving native HTML/components and view settings. Defer renderer startup without requests or premature fallback cards, with a bounded failure instead of indefinite loading.

Version choice: PATCH to 0.16.3 for native presentation and rendering reliability corrections. No new permissions, persistence or schema changes.

Validation: all 542 tests pass, including 87 targeted model/discovery/bridge checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspection confirmed native community/profile-post identity layout, comment reload URLs and shimmer behavior. Installed visual verification requires reloading the extension. Native renderer/endpoint contracts remain undocumented; archive-only fallback markup cannot be guaranteed identical to future Reddit UI, and archive coverage remains incomplete.

# 0.16.2 preview

- Use Reddit's exact banned/suspended and deleted-account artwork in centered profile headers and card author identities. Remove conflicting generic avatars and the superseded retained-photo fallback; chat avatars are unchanged.
- Preserve `/user/.../comments/...` post overlays. Fix Back navigation when Reddit detaches and reconnects native profile views; restore loaded results, ready cards and pagination cursors without repeating archive/card-render requests. Keep the page-session cache bounded and owner-scoped, and clear it on account/settings changes.
- Reuse Reddit's native Snoo logo and expanding/fading halo loader for profile-card loading, with reduced-motion handling and a shimmer fallback before component registration. Native chat startup was verified to use shimmer rows.

Version choice: PATCH to 0.16.2 for existing profile artwork, return-navigation reliability and native loading corrections. No new permissions, persistence or schema change.

Validation: all 538 tests pass, including 66 targeted model/discovery checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave component inspection confirmed the feed's native Snoo halo and the separate chat shimmer templates; the temporary probe and network throttling were removed. Back restoration and artwork behavior are covered by synthetic fixtures; installed end-to-end verification requires an extension reload. Cached views are document-session only, archive coverage remains incomplete, and Reddit's native markup/components may change.

# 0.16.1 preview

- Keep hidden/banned profile notices detached while Notifications and other native overlays/transitions change the URL. Retain the profile until Reddit replaces its underlying DOM; opt-out restores the original notice.
- Use Reddit's default profile-fill silhouette instead of a ban-action hammer. Prevent generic card avatars from replacing it, and fix avatar sizing/hidden styles that could display both icon and photo at once.
- Replace repeated profile archive-text sections and header copy with compact source/status icons. Comment indicators sit at the right of native headers; fallback cards include Reddit's community icon or a matching already-loaded community image.
- Display available recovered deleted-comment text in its native body, including comments already present in Reddit's feed. Preserve current live text and original nodes for opt-out restoration; retain restrictions and avoid invented text when the archive has only deletion markers.

Version choice: PATCH to 0.16.1 for native presentation, navigation and recovery reliability corrections. No new permissions, persistence or storage-schema change.

Validation: all 534 tests pass, including 55 targeted discovery checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave reproduced notification-triggered notice restoration and the overlapping generic-avatar defect, and verified native profile/community glyphs and layout. Installed verification requires reloading the updated unpacked extension. Archive coverage remains incomplete; content captured only after deletion cannot be reconstructed, and Reddit's internal markup/endpoints may change.

# 0.16.0 preview

- Extend native archive recovery to Reddit's explicit banned/suspended-account pages. Overview, Posts and Comments share the existing Arctic Shift opt-in, bounded pagination, native cards and desktop sidebars. Account bans never imply that each post/comment was deleted.
- Replace unavailable-profile initials with Reddit's native ban-fill artwork. Available retained profile photos still take precedence, with the native icon retained on missing/failed photos.
- Detach banned-account notices through nested page parsing, replacements and post overlays. Opt-out restores Reddit's original notice; unrelated forbidden/error pages remain untouched.

Version choice: MINOR to 0.16.0 for archive discovery on an additional account state. No new permissions, persistence or storage-schema change.

Validation: all 529 tests pass, including 50 targeted discovery checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive equality pass for 32 assets. Live Brave inspection verified the example's explicit banned-account marker and Reddit's exact ban-fill artwork. Installed recovery and archive coverage for the example require reloading the updated unpacked extension. Archive availability remains incomplete, and Reddit's native markup/endpoints can change.

# 0.15.2 preview

- Detach Reddit's deleted-account and curated-profile Welcome/hidden-posts notices before paint, including replacements and native post overlays. Restore the original notices on opt-out or leaving the profile.
- Reuse available active-account chat identity avatars and matching native post icons for deleted profiles. Preserve avatar space while loading, reject unsafe URLs and group conversation images, and retain a neutral fallback when no photo is available. Arctic Shift does not provide profile images.
- Restore Reddit's responsive desktop columns and native left navigation on deleted profiles. The right panel shows explicitly labeled counts and date ranges for loaded archive records, with incomplete-coverage context. Keep navigation stable across profile tabs and provide usable links plus explicit Retry on failure.
- Use Reddit's shimmer placeholders for discovery and card loading. Avoid redundant full-document notice scans and repeated archive-statistic DOM writes.

Version choice: PATCH to 0.15.2 for existing profile-view reliability and native interface corrections. No new permissions, persistence or storage-schema change.

Validation: all 526 tests pass, including 71 targeted profile/model/native-bridge checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspection verified native layout/navigation markup and the same-origin navigation fragment. Installed verification requires reloading the updated unpacked extension. Retained-avatar recovery depends on existing matching identity hints and active native chat context; archive coverage and Reddit's internal markup/endpoints remain incomplete or changeable.

# 0.15.1 preview

- Fix deleted-profile Posts/Comments requests being rejected after SPA navigation. Brave can retain the original document sender URL while the current tab URL changes. Accept only supported tabs of the same requested profile across both URLs; retain origin, other-profile and unsupported-page checks.
- Replace custom archive tabs, typography and card styling with Reddit's native tab group, panel, feed and server-rendered cards. Use the native main landmark and utility classes, including selected-tab and overflow controls. Arctic Shift remains the discovery provider.
- When Reddit no longer returns a matching card, render archived text inside its native post/comment components and layout. Keep historical vote/action rows inert, retain archive attribution and restrictions, and avoid Retry-only archive rows.

Version choice: PATCH to 0.15.1 for tab navigation and interface consistency corrections. No schema change or new persistence.

Validation: all 518 tests pass, including 73 targeted discovery/provider/native-bridge checks. All 31 extension/demo JavaScript files parse; ZIP integrity, aliases and source/stable-folder/archive equality pass for 32 assets. Installed Brave reproduced the same-profile request rejection, returned 50 archive items on Overview, and confirmed a native post fragment succeeds while an older comment returns a native not-found state. Native tab classes, slots, comment action rows and post action boundaries were inspected against Reddit's actual UI; temporary DOM probes were removed. The updated installed bundle requires manual reload for final navigation/layout verification. Native internal components/endpoints and archive coverage may change.

# 0.15.0 preview

- Handle Reddit's explicit deleted-account pages, which omit both the main landmark and native feed. Add a compact archive-only Overview/Posts/Comments view and restore the native notice on opt-out or navigation. Generic missing-page/network errors stay untouched.
- Automatically search the viewed username only when both discovery and Arctic Shift are enabled. Reuse credential-free, bounded archive requests and explicit pagination. Disabled archives send no requests and show the relevant setting.
- Render attributed archive text, dates, historical scores and source links without Reddit search, status, native-card requests or fabricated live voting controls. Preserve unknown current item status, NSFW/spoiler restrictions, existing results after a failed refresh and incomplete-coverage wording.

Version choice: MINOR to 0.15.0 for the new deleted-account archive view. No storage-schema change or new persistence.

Validation: all 515 tests pass; all 31 extension/demo JavaScript files parse. ZIP integrity, aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave confirmed that the reported profile is deleted and has no native feed. A synthetic Brave preview rendered mixed archived posts/comments in date order. Direct Arctic Shift API probes returned HTTP 403 and Brave blocked direct API navigation; recovery coverage for the example username remains unverified. The updated installed extension requires manual reload. Archive availability/coverage and Reddit's deletion-page markup can change.

# 0.14.2 preview

- Fix profile discovery failing to mount after the early-notice change. Installed Brave tracing showed the shared model executing only in MAIN when both registrations used document start; the isolated discovery script exited before creating its controls/results. Restore its established idle registration for Posts, Comments and Overview.
- Run a uniquely named, model-independent notice guard at document start. It works before the document root exists, suppresses the curated-profile Welcome panel during settings/search and native replacement, respects newer opt-out updates and follows profile SPA routes.
- Return native card hydration to its established startup path; keep native media, controls, virtualization and source/status indicators unchanged.
- Scope profile discovery to New/Hot/Top, Top time range and native view mode. Forward validated sorting to Reddit, discard obsolete same-path query responses, use current post/comment scores for Top and preserve public-search order for Hot without changing native card order.
- Pause native-card/local request queues at existing concurrency and request budgets instead of filling the feed with Retry rows. Cancel paused work on scope changes. Honor server Retry-After with one retry, then expose one paused explanation and an explicit Refresh action; no indefinite rate-limit retry loop. Keep genuine-error Retry buttons from shrinking under long titles.
- Add Reddit-styled feed separators to placeholders and comment fragments that omit them, without duplicating server-supplied rules. Keep separators attached through native virtualization and cleanup. Hydrate nearby discoveries serially in feed order so later cards cannot finish ahead of earlier ones.
- Use Reddit’s own indeterminate progress animation with equal 20px host/graphic sizes and no extra outer rotation.

Version choice: PATCH to 0.14.2 for confirmed initialization, feed-scope and loading regressions. No chat schema change, cache reset or new server sync loop.

Validation: all 511 tests pass, including isolated-model registration timing, model-free/root-free guard startup, opt-out races, profile route changes, sort/range cancellation, ranked post/comment anchors, paused queues, bounded server cooldowns, reversed visibility notifications and separator lifecycle/deduplication. All 31 extension/demo JavaScript files parse. ZIP integrity, aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave tracing reproduced the missing isolated model in the previous build. The installed recovery build was verified rendering Posts and Overview on the reported curated profile with the Welcome notice hidden. Live GET probes confirmed Hot endpoints respond successfully; results/coverage vary. A temporary native-loader probe measured a 20×20px host and graphic, no outer animation and Reddit’s own track animation; it was removed. Installed Top/All Time, Hot and New transitions rebuilt the feed without Retry rows. The final separator/serial-hydration follow-up requires another extension reload for live verification. Reddit's internal rendering endpoints and markup may change; archive coverage remains incomplete.

# 0.14.1 preview

- Cooperate with Reddit's native feed virtualization instead of reinserting detached cards after their height placeholders. Preserve loaded cards, native date anchors and duplicate identities as the user scrolls; restore existing content without another hydration request. Recover a card whose request was interrupted while it was virtualized.
- Put the source/status marker just before the native Join and overflow controls. Use distinct, visible crossed-eye, trash, barred-circle and archive icons for profile-omitted activity, verified deletion, verified removal and unverified archive snapshots, with descriptive accessible labels.
- Suppress Reddit's curated-profile Welcome/hidden-posts panel from document start, including while settings/search are pending and after native replacement. Preserve other native empty/error states, restore the panel on opt-out, and wait within existing time/concurrency limits for native component registration. Leave native media markup and controls intact.
- End the attachment animation without a persistent transform/opacity stacking context so native menus can overlap subsequent cards. Play it only on initial hydration, rather than again after scrolling back.

Version choice: PATCH to 0.14.1 for the scrolling/stacking reliability fixes. No chat schema change, cache reset or additional sync loop. The startup notice correction retains 0.14.1 as a follow-up to this preview bundle's existing presentation behavior.

Validation: all 500 tests pass, including native placeholder replacement/restoration, preserved DOM/request counts, virtualized opt-out, interrupted hydration, icon placement/state, pre-result/replaced-panel suppression, opt-out/routes and early component readiness/cancellation. All 30 extension/demo JavaScript files parse. ZIP integrity, compatibility aliases and source/stable-folder/archive byte equality pass for 31 assets. Live Brave diagnosis reproduced repeated native placeholders and reinsertion while scrolling, and confirmed the native virtualization mechanism and persistent animation transform. A live DOM/CSS probe against Reddit's actual panel measured 260px before the guard and 0px after it, including replacement markup; probe changes were restored. First-paint verification of the new document-start registration requires another extension reload. Reddit's internal fragment endpoints and virtualization markup may change; archive coverage remains incomplete.

# 0.14.0 preview

- Fix discovery initialization under the existing trusted-only storage policy. Content scripts receive only normalized feature preferences through the worker; private chat storage remains protected. Preference changes propagate to mounted profile views, and failed initialization offers Retry instead of silently disappearing.
- Discover public comments using Reddit's native author-search partial endpoint, including modern long t1 IDs. Add Arctic Shift comment lookup and source-safe post/comment identity, parent links and independent cursors.
- Show a bounded initial selection automatically: posts on Posts, comments on Comments, and both on Overview. Preserve partial successes, cancel stale route work and hide the native empty placeholder only while additional activity is visible.
- Merge missing discoveries directly into Reddit’s feed instead of a separate results block. Recognize native profile-comment IDs, preserve pinned cards and native ownership, defer older results past the loaded date window, and remount cleanly when Reddit replaces its feed. Use compact status/icon controls.
- Replace simplified result cards with Reddit’s real profile-feed post and comment fragments, hydrated by its own component loader. Preserve native media, icons, action controls, vote state and observed view mode; keep authenticated markup in the page world. Hydrate nearby cards at bounded concurrency, remove duplicate native IDs, and show native placeholders with reduced-motion-aware attachment instead of a visible checking message.
- Fix the popup's intrinsic sizing with a stable 360px root/body width, shorten descriptions and clarify that discovery includes posts and comments. Retain chat controls, settings and caches.

Version choice: MINOR to 0.14.0 because this adds public and archived comment discovery alongside reliability/UI corrections. No chat schema change or cache reset.

Validation: all 492 tests pass. All 26 extension/preview JavaScript files parse. Live Brave diagnosis reproduced the blocked content-script storage read, verified successful Reddit post and comment requests on the reported curated profile, and received a successful Arctic Shift post page. The synthetic popup preview measured a single-line brand, 360px body width and 542px body height. ZIP integrity and source/stable-folder/archive byte equality pass for 31 assets. Archive coverage remains incomplete; Native post and comment fragment endpoints and component hydration were verified in live Brave without voting or posting. Final installed-build verification follows reloading the extension. Internal native endpoints may change; unavailable cards offer an explicit retry/link rather than imitation actions.

# 0.13.0 preview

- Rebrand the extension as **Reddit Tweaks**, with orange sliders artwork and separate Posts and Chat sections. Keep the existing unpacked installation path, account-scoped chat data, and cache-management actions.
- Discover additional public posts from modern Reddit profiles through bounded author-search requests. Insert native-styled results inline, deduplicate against loaded posts, and use small source/status icons without guessing whether an author hid a post.
- Add opt-in Arctic Shift profile and post-ID lookups. Keep archived text in separate, collapsed snapshots, prefer current Reddit metadata, and require a verified status before labelling a post deleted or removed. Preserve NSFW/spoiler restrictions from both sources.
- Validate routes, source records, settings and cursors; bound response sizes, concurrency, pagination and timeouts. Drop stale SPA results, recheck opt-out after queueing, and respect rate limits. No archive bodies, browsing history, new credentials or chat sync loops are persisted.
- Name new ZIP exports Reddit Tweaks while retaining the stable `artifacts/reddit-chat-search/` folder and compatibility ZIP alias. Validate registered CSS assets during packaging.

Version choice: MINOR to 0.13.0 for post discovery and the expanded extension interface. No chat storage schema change or cache reset.

Validation: all 471 tests pass (435 existing plus 36 new). All 25 extension/preview JavaScript files parse. ZIP integrity and source/stable-folder/archive byte equality verified for 31 assets. Brave inspection confirmed current public profile/feed and post component structure; synthetic wide/narrow and light/dark previews were inspected. The reference clone and live research remain ignored.

Limitations: full live extension recovery was not verified after a browser reload. Direct navigation to Reddit's search JSON endpoint was blocked by the client; no restriction was bypassed. Arctic Shift coverage and availability vary, and public API requests may fail or be rate limited. This release covers modern Reddit public profile Overview/Posts views and post details, not private Hidden lists, private communities, comment discovery or old Reddit. A selection or failed lookup never establishes complete history or current deletion.

# 0.12.8 design test

- Exclude Reddit’s temporary local message IDs from new saved captures, native-cache import and individual search. Observe native local-echo updates so confirmed messages are captured under their server-assigned IDs.
- Hide previously saved temporary records from global results, room results, summaries and message counts without clearing the stored event ledger. Reject a stale temporary-result jump locally rather than calling Reddit’s selected-message endpoint with an invalid ID.

Version choice: PATCH to 0.12.8 for a confirmed message-navigation bug. No storage schema change, cache reset or changes to Reddit’s send methods.

Validation: all 435 tests pass. New regressions cover pending capture, confirmation capture, native-cache reconciliation, legacy saved entries, room search and navigation with no server request. All extension JavaScript parses; archive integrity and source/stable-folder/archive byte equality verified. Live Brave inspection found the reported HTTP 400 M_INVALID_PARAM response for a tilde-prefixed event ID and confirmed Reddit’s local-ID generation in its running client. After reloading the existing Brave installation, the affected window ran 0.12.8, displayed saved results without the navigation error, excluded temporary IDs from the returned search page and rejected a synthetic temporary jump locally. No messages were sent during diagnosis; synthetic fixtures cover sending/confirmation transitions. Saved history remains incomplete.

# 0.12.7 design test

- Isolate native-cache importer abort/error events from Reddit’s database handlers. The running Reddit client closes its backend when an abort reaches the database; importer read failures, timeouts and cancellations must not shut down Reddit’s own connection. Unsupported-schema reads now finish without an unnecessary abort.
- Stop a partial import if Reddit replaces its database handle, and explain a closed connection without marking the failed pass complete. Existing saved messages remain available; native reconnection and explicit Refresh can retry the check without a second sync loop or database reset.
- Reopen the extension-owned database once if transaction creation encounters a closed handle. Discard connections on abnormal closure and yield them on version changes. Retry only before requests have started, preserving queued writes, account isolation and stored data.

Version choice: PATCH to 0.12.7 for database connection reliability. No storage schema change or cache reset.

Validation: all 429 tests pass, including reproduced abort propagation with Reddit-equivalent shutdown handling, native handle replacement, closed native handles, extension read/write recovery, abnormal closure and version-change handling. All extension JavaScript parses; archive integrity and source/stable-folder/archive byte equality verified. Live Brave inspection confirmed Reddit’s abort/close handlers, and an isolated readonly cancellation left its connection usable with those handlers unchanged. After reloading the existing Brave installation, version 0.12.7 completed native-cache reconciliation, retained saved messages, returned saved-search results without cache/saving errors and left Reddit’s database readable. The original intermittent error was not reproduced in the fresh live tab; synthetic regressions reproduce the failure mechanism. Saved-history coverage remains incomplete.

# 0.12.6 design test

- Reconcile Reddit’s open local cache without waiting for its startup-sync promise. Saved message searches and previews remain available while captured/cache updates are saved. Each page attachment still checks for messages, edits and redactions missed while the extension was inactive; it does not start a server-history build or another sync loop.
- Label reconciliation Checking cache, expose checked-record progress in the status tooltip, and show a paused explanation when a check fails. Refresh retries a failed cache check. Empty partial caches explain that messages can still arrive.
- Bound stalled native cursor transactions, extension read/write transport and idle reconciliation. Preserve committed data and pending captures, stop the busy state, and never mark a failed pass complete. Failed search reads replace placeholders with a recoverable state and do not restart on ordinary native renders.

Version choice: PATCH to 0.12.6 for startup/cache reconciliation reliability. No storage schema change or cache reset.

Validation: all 423 tests pass. New regressions cover an open native database with a startup-sync promise that never resolves, a stuck native cursor, stalled transport, a stalled reconciliation with explicit retry, sustained durable-write progress that keeps a large active import alive, and the real global interface showing committed results while native-cache writes are deliberately blocked. All extension JavaScript parses; archive integrity and source/stable-folder/archive byte equality verified for 26 assets. Validation is synthetic; live Reddit startup recovery was not measured. Saved history remains incomplete.

# 0.12.5 design test

- Keep individual chat result lists bounded to the visible region, with cached measurements and reusable avatars. Scrolling no longer grows and rebuilds an increasingly large list. Incoming result updates wait until scrolling settles; new messages above the viewport preserve the visible message.
- Load additional global saved-result pages quietly, without restarting the main refresh animation or replacing existing rows. Keep the match count visible during unrelated conversation checks and reduce per-frame list scanning and day-header rebuilding.
- Keep the loading placeholder visible while individual search checks saved messages and native history, including searches started through sender/date filters, so a temporary empty read does not flash “no results.”

- Share control sizing between global and individual search: native-header-based field height, input padding and type, filter/date glyphs, menu widths, option rows and sender tags.

Version choice: PATCH to 0.12.5 for scrolling performance and loading reliability fixes. No storage schema change. The cosmetic sizing amendment retains this version.

Validation: all 417 automated tests passed, including large synthetic lists, scroll anchoring, pagination, delayed reads, keyboard navigation, and native identity updates. JavaScript syntax and archive integrity/source-to-stable-folder equality verified. Synthetic headless Chrome verifies matching field, icon, input, menu and option-row geometry at 320/420/820 px panel widths and 40/52/64 px native header heights. Live Reddit/Brave performance was not measured; saved-history coverage remains incomplete.

# 0.12.4 design test

- Put a Custom date choice first in before/after suggestions and open the app calendar in that operator mode. Applying a day keeps its full before/after date expression in the search. Match secondary menu row spacing and text sizing to the primary menu.

Version choice: PATCH to 0.12.4 for a user-visible search interaction improvement. No storage schema change.

Validation: changed JavaScript syntax and package integrity checked; automated tests were not run for this quick edit.

# 0.12.3 design test

- Put filter autocomplete icons at the left without menu-arrow rotation. Date suggestions retain the full before/after date token alongside a calendar icon and concise labels such as Today, Yesterday, This month and This year.

Version choice: PATCH to 0.12.3 for a user-visible search interface correction. No storage schema change.

Validation: JavaScript syntax and package integrity checked; automated tests were not run for this quick edit.

# 0.12.2 design test

- While a global or individual filter menu or calendar is open, any click outside that surface dismisses it and is consumed, preventing accidental activation underneath.

Version choice: PATCH to 0.12.2 for a user-visible interaction fix. No storage schema change.

Validation: changed JavaScript syntax and package integrity checked; automated tests were not run for this quick edit.

# 0.12.1 design test

- Prevent outside clicks from activating Reddit UI underneath an open global or individual filter menu. The outside pointer now dismisses the menu and its matching click is suppressed.

Version choice: PATCH to 0.12.1 for a user-visible interaction fix. No storage schema change.

Validation: JavaScript syntax and package integrity checked; automated tests were not run for this quick edit.

# 0.12.0 design test

- Add matching icons to every applied filter tag in global and individual search, retaining sender avatars. Remove the orange applied-filter number badges from the filter icon and scope tabs. Give both filter menus full-width icon rows, explicit selected checks, contextual saved-data counts, Reset, active-filter accents and removable tags. Open Chat type, Status and Sort in separate option views, with the same flat, borderless rows as the main menu; Escape returns to the main menu before closing it. Apply choices immediately. Keep search text and dates when resetting menu filters.
- Separate chat type from status so Groups and Unread can be combined. Move Requests into Status, use Any consistently and explain that Unavailable means deleted or suspended rather than blocked. Show unavailable-account indicators as icons with full tooltips.
- Remember chat/status/sort choices per tab for the current account and page session. Add A–Z and Unread first in People, keep Relevant in message scopes, hide the calendar in People, shorten the placeholder and anchor popovers to their controls.
- Support compact completion for every implemented operator: from, has, before and after. Selecting an operator inserts it; sender values use People-style rows with avatars, attachment values use matching icons, and dates have suggestions. Complete filters become removable tags. Before excludes the chosen day; after includes it. Multiple senders remain alternatives and other conditions combine with AND.
- Limit menus and autocomplete to Reddit-relevant media; remove Video, Audio and File choices. Expose the same supported attachment filters in global and individual search: Images, GIFs and Links. Calculate counts during the existing local-search traversal while retaining text/sender/date/room conditions and excluding the currently selected attachment type. Keep selected zero-count options removable.
- Resolve You from the native account profile even before any own messages have been imported. Reuse already-loaded native profile data, prefer the current avatar, retain the saved fallback and clear retained identity on account changes or saved-data removal.

Version choice: MINOR to 0.12.0 for expanded shared filter menus and operator completion. No storage schema change, extra profile requests, sync loop or background history download. Reload the extension and refresh existing Reddit tabs.

Validation: all 414 tests pass. Coverage includes native/saved self-profile precedence and isolation, composed type/status filters and contextual counts, operator completion, selected-zero removal, Reset with retained text/dates, per-tab state and accurate counts without extra queries, dormant message-filter controls in People, submenu Escape/Back focus restoration, native jumps, redactions through the current global interface, and existing cache/history/media/scroll regressions. All 20 scripts parse. Synthetic Chrome checks 820/420/320 px layouts: global and individual menus stay within their chat width without horizontal clipping or an internal scrollbar; Chat type, Status, Sort and Contains use the same compact secondary view with full-width option rows and a Back control. Contains offers Any, Images, GIFs and Links. Archive CRC integrity and source/stable-folder/ZIP byte equality pass for all 26 assets; the convenience archive matches.

Limitations: option counts describe currently cached data, not complete server history. Unknown counts remain selectable; zero saved-match counts do not prove that older inaccessible messages do not exist. Per-tab choices last for the page session and are cleared on account changes. Visual checks use synthetic fixtures rather than the signed-in browser. Only operators supported by Reddit chat's captured data are offered; Discord-specific polls, embeds and forwarding are not implied.

# 0.11.0 design test

- Integrate individual-chat search into the native header area with a back button and a full-width field. Preserve the original header nodes, handlers and inline display values; restore them on Back, close, room changes and teardown. Match native header height and remeasure it when the chat width changes.
- Match both search toolbars to the native room-header height, measuring unscaled CSS pixels and following header replacement, hiding and resize. Keep icon-only Filters and Date inside both search fields. Individual Filters contains From and Sort, with avatar-backed multi-sender choices. Keep removable applied tags below the field and preserve typing, debouncing and native message jumps. Remove the separate scrollable filter row.
- Open the existing Reddit-accented calendar directly. Retain its built-in quick ranges, date modes, cached-day hints, future-date limits, explicit Apply and draft cancellation. Remove the duplicate preset-first date menu and its unused implementation.
- Correct refresh-wheel rotation: compact styles keep the SVG and rotating wrapper at the same 12 px size, with the circular arc centered in its viewBox. Use global-style gray keyboard previews in room results, retaining only the faded orange left rail with matching 8 px insets.
- Show recent successful room searches in the empty search view, with keyboard reuse. Bound this page-session history to five queries per room and forty account/room entries. Clear it on account changes. Clearing text returns to this view without closing search.

Version choice: MINOR to 0.11.0 for the header-based search flow. Keep this version for follow-up control/layout refinements, restored direct calendar access and cosmetic rotation/preview corrections. No storage schema change, new sync loop or background history download. Global search and image presentation are unchanged. Reload the extension and refresh existing Reddit tabs.

Validation: all 387 tests pass. Coverage includes native header size/transform/replacement handling, restoration, Back/Escape, recent-search account isolation and keyboard reuse, sender alternatives, filter/sort states, direct-calendar Apply/cancellation, quick ranges across month boundaries and existing search/storage/navigation regressions. All 20 scripts parse. Synthetic headless Chrome checks 820/420/320 px rooms: search starts at the native header position, both toolbars equal the 49 px native header with matching 37 px fields, icon-only filters/date stay within the fields, the direct calendar stays bounded with four quick ranges, and the full-width result view reaches the room bottom. Refresh centers remain fixed at 0/90/180/270 degrees, and keyboard previews resolve to the shared neutral gray at all three widths. Archive integrity and source/stable-folder/ZIP equality pass for all 26 assets; the convenience ZIP matches.

Limitations: recent room queries last only for the current page session and are recorded when opening a match. Live Reddit authentication and exact-event accessibility still govern message retrieval. Visual checks use synthetic fixtures, not the signed-in browser. Date menus remain compact and bounded to the chat panel.

# 0.10.0 design test

- Remove startup navigation waits on initial sync and the bulk saved-cache pass. Keep authentication/router readiness, exact-event failure handling and interactive request coordination. Skip redundant native event lookup when that event is already loaded; reveal visible room messages directly.
- Make individual search a full-width results view over the thread with one result status. Remove the extra close button and Ctrl+F-style counter/arrows. Preserve the native identity header, show an active search icon and support room-scoped Ctrl/Cmd+F. Esc peels the calendar/filter popup, results, then search.
- Place global-sized filter/calendar icons inside the search field, with sender/sort options in the filter menu and independently active filters. Use an icon-only Refresh with stable busy animation and remove extra section borders. Preserve multi-sender selection and typing shortcuts. Use actual sender avatars/names with the same native font/spacing measurements as global results, match-centered three-line snippets, stronger orange highlights, sticky day headings, lightweight scrollbars and a quiet incomplete-coverage footer. Native message navigation expands recognized Read more controls and briefly paints hits without rewriting message text.
- Share the exact global Refresh SVG, dimensions, animation and loading placeholders with room search, including immediate typing feedback and pending history with no matches. Position sender/sort menus below their filter control and keep them inside narrow rooms.
- Reset result scroll, keyboard selection and stale mobile return anchors for new queries, filters or sort orders. Preserve same-query refresh/mobile-return positions. Background reads anchor the viewport at completion so scrolling during a read is not undone. Coalesce passive scroll events per frame, avoid rebuilding filters on the scroll path and postpone capture-triggered refresh work during active scrolling.
- Keep selected senders in a separate removable tag rail, matching global search. The field remains one line and contains only editable text; filter state stays separate from that draft.
- Default the room calendar to On, expose Today/Yesterday/Last 7/Last 30 days, disable future days, mark cached message days, use a neutral disabled Apply state and anchor it to the date control. Earlier uncached dates remain selectable. Global calendar behavior is preserved.
- Compact recognized settings/popout native buttons into an accessible ⋯ menu in rooms at most 440 px wide. Retain native handlers and restore original presentation when wide or destroyed.

Version choice: MINOR to 0.10.0 for the substantial individual-search interface expansion. Follow-up control, loading and scroll corrections stay in this unreleased bundle. No storage schema change. Reload the extension and refresh existing Reddit tabs.

Validation: all 382 tests pass, including query-position resets, scrolling during in-flight reads, coalesced scrolling, shared room/global placeholders and Refresh, menu anchoring, blocked-startup navigation, native-event reuse, sender/date/sort chips, keyboard layers, exact local jumps, shadow-text highlights, calendar bounds and native action restoration. All 20 extension scripts parse. Synthetic headless Chrome checks 820/420/320 px room widths: results span the room and reach its bottom, controls and quick ranges fit, sender tags stay outside the single-line field, the clear button stays contained, menus align 4 px below the field and remain inside the room, seven placeholder rows show during pending history, Refresh remains 20 × 20 px, and future days are disabled. Archive integrity and source/stable-folder/ZIP equality pass for all 26 assets; the convenience archive matches.

Limitations: uncached/inaccessible events can still require or fail Reddit requests; server cooldowns remain respected. Native action grouping and Read more expansion only apply to recognized accessible controls. Per-word thread highlights require the browser Custom Highlight API and accessible text roots. Cached-day dots describe available saved data, not complete history. Rendered checks use synthetic fixtures, not a signed-in Brave session. These checks verify bounded scroll work and position preservation; live-device frame rates have not been measured.

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
