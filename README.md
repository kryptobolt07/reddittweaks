# Chat Search for Reddit — 0.3.8

## Load in Brave

Extract `artifacts/reddit-chat-search-v0.3.8.zip` and load its folder through **Load unpacked** in `brave://extensions`.

For an existing installation, replace the files in its current unpacked folder, choose **Reload** on the same extension card, and refresh Reddit tabs. Keeping the same installation preserves its saved directory and enables migration from 0.2.4. Loading another folder as a separate extension creates separate storage; disable the older installation to avoid duplicate controls.

The generated `artifacts/reddit-chat-search/` folder and `artifacts/reddit-chat-search.zip` also contain the current build.

## Search and browse

- Focus **Search usernames** with an empty field to browse saved conversations. Scrolling reveals more local rows; there is no permanent 150-result limit.
- Type a username to filter locally. Stable image elements and visibility-based avatar loading avoid repeatedly requesting the same profile image during ordinary filtering.
- The conversation-header magnifying glass searches available messages, including older pages and reply threads. Opening an empty message search waits for text or applied dates before starting history reads. Matches from native cached messages appear immediately; later history pages update results progressively. Native profile controllers are discovered by capability across chat components. Optional sender details never hold message completion: missing controllers are skipped, busy/cooling queues are skipped, and a lookup is bounded to two seconds. The signed-in sender is displayed as You without a profile request. Compact rows include sender icons, dates and highlighted snippets. Native SVG avatar URLs, cached room membership, and author names are reused locally across grouped messages. Authoritative result replacement preserves known identities by event/sender ID; names are never assigned from neighboring messages or conversation titles. Later saved/profile/member identity updates refresh loaded matches locally without another history read. Native event IDs, sender IDs, and the signed-in sender flag are bound on component connection/update, independently of deleted-account labels. Unbound native DOM rows are omitted until their real event identity is available, preventing temporary grouped-message duplicates. The signed-in sender consistently displays as You, including after DOM refreshes. Opaque Matrix IDs cannot replace an already known author. A person placeholder appears only when sender details are unavailable. The calendar button opens one compact calendar with On, Before, After, and Between modes. Month/year choices use themed buttons within the calendar instead of operating-system dropdowns; Escape returns from a chooser without discarding the draft. The applied date pill shares the matches/Refresh row; its × button removes only the date filter. Between highlights both endpoints and the intervening dates; date-only searches are supported. On and Between include the selected days. Before and After exclude the selected day. Matching applies locally and reuses history in memory. A bounded date search stops backward reads once the verified timeline passes its start date; a range after the latest message stops after the newest page. Narrower ranges reuse verified coverage, while widening or clearing resumes the saved cursor. Range coverage stays separate from full-history completion. Changing dates updates an existing load, and concurrent controls share the broadest required coverage. Known native thread roots/replies are seeded locally, and known reply timelines receive their own date cutoff. Inconsistent timestamp ordering disables early stopping. Reddit's inspected history API pages by sequence, so newer pages may still be traversed to reach an older range; Before-only has no lower boundary and can require all older history. The message search ribbon spans the conversation width, while matched result menus are centered within it. Interrupted loads retain their cursors; controls in the same document share a history load.
- Selecting a person opens the exact conversation through Reddit's native navigation. Selecting a message jumps to its event or reply thread. Up/Down keys move the selection within the result menu, scrolling only that menu; Enter opens the selection. Clicking the search field again reopens saved results even when the input stayed focused after navigation. Header previous/next buttons still jump directly.
- Conversation results show the last activity date when Reddit has already supplied a timestamp; missing dates do not trigger extra history requests.
- Retained membership metadata can recover an unavailable account's former name. Search its name or `deleted` / `[deleted]`. Identifiable native conversation rows, headers, introduction cards, and authors (including image-only messages) show the retained name with **Unavailable**. Shared native name/title functions and the username renderer are hooked so later renders also use recovered names; a scoped fallback adds status labels and covers bypassing components. Internal Reddit functions can still change in future releases.
- Full-page chat, floating chat, and the minimized **Search chats** shortcut are supported. Floating and narrow message panels use smaller search controls, result rows, and a 228px calendar. The calendar aligns with the right edge of the search ribbon and stays within the conversation width. Date selections and Apply use Reddit's red-orange brand color independently of its black primary button color. Username and message search fields share a 32px height.

Background indexing does not scroll the visible chat. Message bodies remain in tab memory and are not included in the persistent username directory. Redactions exclude messages, edits replace their searchable text, and supported native message events update loaded indexes without another full download.

## Directory and request policy

A complete room-directory traversal happens **initially per Reddit account in this extension installation**. It uses Reddit's native authenticated `getRoomList` helper with `page_size=200`, `include=state,timeline`, and the returned `next_batch` cursor. In the inspected account, 1,777 room IDs required nine requests; counts vary by account.

At document start, the extension preloads saved directory metadata in its isolated context. Once Reddit exposes the authenticated account ID, the matching names are installed before waiting for initial sync. Native component connection hooks apply the name functions before their first render; unavailable names use a short loading label while local restoration or first-time recovery is pending. Search does not publish unresolved placeholder rows.

Completed discovery is checkpointed before profile resolution. Incomplete directory and date passes save their continuation cursor and metadata on each page; reopening a tab resumes the saved page instead of starting over. Completing names after an interrupted profile phase reuses discovered room IDs. Unloading releases only that document’s temporary leases and request slots. Cancellation stops slot renewal, and a stalled native operation times out after 60 seconds; existing partial results are preserved.

A completed saved index survives browser restarts. Reopening Reddit or another chat control reuses it. The extension listens to Reddit's existing native sync and room/member events to merge newly discovered conversations and affected identities; it does not start a separate sync loop or fresh `m.direct` request.

Initial builds extract available message timestamps from the timeline included in their existing bulk requests, then discard those message bodies. Older complete indexes with missing dates receive one separate bulk timeline pass; successful completion is saved so browser restarts do not repeat it. This pass does not rebuild usernames or fetch each room separately. Empty or inaccessible timelines remain **Date unavailable**. Native timeline events update saved activity timestamps without additional profile reads.

A full traversal runs again only for explicit **Refresh**, a cleared cache, or an incomplete/older directory format that has never been fully enumerated. The 24-hour identity age makes individual profiles eligible for selective refresh, not a full periodic directory crawl. Updates from other devices become searchable as the native client delivers them; explicit Refresh repairs any directory gap that native sync does not expose.

Profiles reuse saved identities and native caches, and missing identities are resolved in native-sized batches of up to 200 IDs. Browsing and typing do not issue profile/data lookups once the directory is loaded. Actual avatar image requests are limited to rows near the visible menu.

An account-scoped worker lease shares builds across tabs. Extension-originated reads allow one background operation and at most two simultaneous operations, leaving room for an interactive search. Server rate limits use shared cooldowns, including available Retry-After / Matrix retry hints, without shortening required waits to 30 seconds. Cooldown timestamps survive browser restarts. Failed pages are retried with bounded backoff; repeated cursors are rejected, and incomplete directory data is not marked complete.

These measures minimize additional traffic. Reddit's own networking continues independently, and no guarantee about Reddit's bot classification is made.

## Storage

Directory schema v2 stores conversation IDs, participant references, room type/membership, available activity metadata, and one identity record per Matrix account ID. Identities include canonical names, retained search names, avatar URLs, confirmed availability, provenance, and verification/retry timestamps. Legacy v1 caches migrate while preserving saved names and aliases.

Persistent directory storage contains no message bodies, DOM elements, authentication credentials, cookies, or avatar image bytes. The popup's **Clear saved usernames** control clears directory data and leaves unrelated storage and server cooldowns intact. Reload Reddit afterward to rebuild.

History events, pagination cursors, and search results live only in page memory, with up to 20 conversation caches retained. Cache eviction invalidates completion flags. Native labels are presentation changes bound to room/account/event IDs; account status and native interaction behavior are preserved.

This extension uses Reddit's private implementation and is independent and unaffiliated with Reddit.

## Development

```sh
npm ci
npm test
npm run preview
npm run package
```

The local preview is `http://127.0.0.1:8765/demo/` and uses invented data. Search **amey_bhoir** or **river** for an unloaded conversation, and **archive** for an older message.

Tests cover multi-page discovery, interrupted/repeated cursors, cache migration and account isolation, restart reuse, cross-tab sharing, native updates, rate-limit coordination, empty-query browsing, lazy/stable avatars, retained native labels and recycled rows, history over 5,000 messages, replies, edits, redactions, cancellation/resume, exact navigation, and unchanged scroll positions during background loading.

The packaged release's validation record distinguishes synthetic browser checks from live testing on the signed-in Reddit account. Reloading the updated extension is required for live validation of the new installed build.
