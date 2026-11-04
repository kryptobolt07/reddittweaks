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
