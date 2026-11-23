# Unavailable-community loading and continuity

## Scope and acceptance criteria

1. Add independent preferences to offer unavailable-community archives and open them automatically. Both default off; require profile discovery and Arctic Shift. Manual mode preserves Reddit's notice and offers Browse archived posts. Automatic mode holds only the matching banned/private notice before paint, mounts the archive directly, and releases the notice on disabled settings, failure, timeout or unrelated routes. Live/quarantined/nonexistent communities stay native.
2. Keep the post sidebar pinned below the header with intrinsic grid alignment and its own bounded scrolling. Initialize archive navigation width from Reddit's current/persisted native expansion state before inserting the layout. Reuse native navigation and its modules; do not hide a partly mounted navigation tree. Native loading components own the Snoo halo; fallback artwork must remain visible while their module initializes.
3. Retain revealed feed cards and their media during scrolling. Remove extension placeholder virtualization. Reconcile comment trees incrementally, retaining connected siblings and their collapsed state when more data arrives.
4. Show thread source/partial-coverage/read-only information in the community sidebar. Page-level comment continuation uses the halo and an intersection sentinel, without Load more comments or View more comments. Replies retain native circle-plus controls, tree slots and a small inline loading icon. Never inject comment skeletons into an archive reader.
5. Bound automatic scans, reject non-advancing cursors, stop on errors, and preserve explicit retry and incomplete-coverage states. Do not infer archive completeness from exhaustion.
6. Add an independent clean-share preference. Keep native sharing controls and feedback, remove tracking from copied/shared Reddit URLs, retain comment targets, and resolve opaque share paths only from the clicked source permalink. Do not read clipboard data or make resolver requests.

## Validation

Run targeted settings, early startup, feed pagination, comment-tree, sharing and native bridge regression tests using synthetic records. Browser validation must use live Reddit in Brave, per the user’s instruction: direct startup, collapsed navigation, scroll down/up, continuation, reply expansion, sticky sidebars and clean sharing. Run the full suite and package validation, compare source/ZIP/stable unpacked bytes, then record the release and any live-validation limits. No private captures are committed.

## Compact community state (2026-11-17)

Replace the large Banned · Archived posts masthead pill with the existing removed/banner glyph immediately beside r/name. Private archives use their existing hidden glyph in the same position. Reuse the exact glyph helper; no new artwork. Keep an accessible state/source label and native tooltip, while visible title text remains r/name. No Join-area pill, border, padding or extra header row; desktop/mobile native masthead geometry stays intact. Tests first for location, no visible pill text, accessible attribution, shared SVG and unchanged heading/spacing. Existing mount/filter/navigation/opt-out transitions retain a single icon and current state. No live writes or new requests.

## Mobile archive post header

Fit the credit line in a 44 px row with 16 px gutters, using the native post detail as the reference. At phone widths, hide the Back control so the avatar starts the row. Keep the author and community lines between the avatar and the overflow, truncating within that space. On desktop, Back returns to the preceding Reddit entry, including its filter parameters (T3). A direct visit with no same-origin history returns to the archived community.

## Mobile archive post media and comments

At phone widths, cap the full-width media frame and its image or player together. A portrait image must stay contained with no empty panel below it. Match the native post's single 8 px space above the frame, square outer corners, and compact action bar. Use Reddit's 24 px mobile comment avatars, 28 px identity row, mobile Share controls, and 16 px spacing between top-level comments. Keep voting and posting unavailable in the archive. When viewport width changes, update the existing controls in place (T11). Comment search continues to hide the thread until the reader returns to all comments (T7).

## Phone community header and row (2026-11-23)

Measured on a live subreddit at 412 px (Android user agent) and matched on the archive page: a 64 px banner; a 48 px icon box holding a 40 px icon at y = 140; the name (18/24 px bold) at y = 146 in a 60 px column whose second line is a 12/18 px weak line (live: visitor counts; archive: "Banned community · archived posts" or "Private community · archived posts"). Then one 40 px row with 8 px above and below: Feed / About pill tabs (40 px, 16 px inline padding, the selected one on the secondary selected background) on the left, Feed options and the view switch on the right. Sort by, Date and Post type open from Feed options in the same phone sheet as live subreddits (each row shows its current value and opens its own page); the desktop dropdown row is hidden on phones, and active filter chips keep their own row. About hides Feed options. Desktop is unchanged.
