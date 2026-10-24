# Native profile filter correction plan

Status: implementation plan; runtime code is unchanged by this document.

## Goal

Extend Reddit's existing profile controls without restyling them. Overview, Posts and Comments must share the same native feed controls on available, deleted and banned/suspended profiles. Preserve current discovery, native card rendering, Back restoration, account boundaries and request budgets.

## Verified native contracts and current defects

Live Brave inspection confirmed that Feed options uses a 32px native button with a 16px filled `filter` SVG, a `bottom-start` `rpl-dropdown`, and a 224px content wrapper. Its main list uses medium native `rpl-menu-item` rows. Top changes the visible main/submenu inside that same dropdown; it does not create another positioned popup. Back returns to the main list. Native checkmark and radio SVGs are filled paths with a 20-unit view box, rendered at 16px.

The current extension fallback lives inside `.rt-posts`, whose broad button/SVG CSS overrides native presentation. Its trigger uses a different stroke icon and its selected marker is a text tick. Refresh is explicitly enlarged to 24px although adjacent icons are 16px. Activity occupies a caption plus three root rows. These are extension UI choices, not native client behavior.

Reddit's empty profile presentation uses an `rpl` empty-state wrapper, `data-testid="empty-state-creative"`, Snoo artwork and native title/body typography. The hidden-profile notice uses `#empty-feed-content` with the wave creative. The current document-start guard and CSS intentionally remove that notice, so an adapted empty state must not reuse that notice identity or be recaptured by the guard.

## Implementation sequence

1. **Preserve Reddit's existing controls.** Locate the current profile's native Feed options dropdown outside the feed cards and extend only its main menu. Do not replace its trigger, native sort/view rows, spacing, opacity, tracking/action bindings or popover styles. Scope extension control CSS to directly owned action buttons and glyphs, so it cannot cascade into the native menu.

2. **Use the same native shell where controls are missing.** Remove the handwritten fallback menu. Reuse a validated native client-rendered profile-control fragment/template, with its native component initialization, icons, rows and selection affordances. Retarget only validated same-origin profile sort/view URLs to the active scope. Keep authenticated fragments and initialization inside Reddit's page world, as with native cards. Reuse an already available matching native template first; avoid a request per scan/remount. If the native contract is not ready, defer or expose a bounded retry instead of substituting a differently styled menu. Deleted/banned profiles retain the native sort, Top range and view controls, plus our Activity entry.

3. **Add one Activity submenu.** Insert one `Activity` row with Reddit's native forward chevron. Open All activity, Hidden and Deleted inside the same dropdown, using the verified Top/Back structure and native checkmark/radio affordances. Reuse native keyboard navigation and dismissal. Escape/Back returns from Activity to the root; closing and reopening starts at the root. Selecting an option closes the dropdown and updates the filter without replaying discovery or clearing cached cards/cursors. Restore native controls exactly on opt-out.

4. **Place the Comments trigger beside View.** Find the actual native View control for the active Reddit layout and place the icon-only native filter trigger immediately after it, within the same controls row. Its accessible name remains Feed options. On layouts without that control, use the equivalent native feed-controls position. Do not put another fallback menu in the extension discovery toolbar. Use the same native placement/collision handling on unavailable profiles; avoid custom absolute offsets, transforms, opacity or nested positioned wrappers that can anchor the menu incorrectly.

5. **Render native filtered-empty states.** Reuse Reddit's empty-state structure/artwork and change only the copy. Examples: “No hidden posts found” / “No deleted comments found”, followed by “In loaded activity. Search and archive coverage may be incomplete.” Use a distinct extension-owned marker, not the privacy notice's ID. Count both matching native cards and published extension cards. Do not report a settled empty result during native reload, source reads, unpublished card groups or unresolved status verification. Errors, paused rate limits, incomplete pages and continuations retain their own truthful retry/continuation behavior. Remove the empty state as soon as a match arrives; All activity, opt-out and route/account changes restore the original native state.

6. **Correct action icon sizing.** Return Refresh to the same 16px visual size as adjacent action icons while retaining its accessible hit area. Keep the shared chat refresh path. Native filter icons, selected states, disabled opacity and popper appearance remain owned by Reddit.

## State and regression work

- Centralize filtered-empty updates after deduplication/filter changes, request start/finally, native loading changes and card-group settlement.
- Preserve source failures/incomplete status through the bounded Back snapshot; one successful Overview kind does not imply both succeeded.
- Do not hide an unknown archive candidate in a way that permanently prevents the existing bounded native renderer from qualifying its status. Unknown status is never inferred to mean deletion.
- Keep native nodes and virtualization placeholders intact. Preserve original visibility, cursors, ready cards and same-owner/settings invalidation; no extra chat sync or visible background scrolling.
- Test native control identity preservation, a single root Activity row, exact native icons/selection affordances, submenu Back/Escape/reopen, no duplicate menus on scans, Comments placement, unavailable-profile reuse, and cleanup on opt-out.
- Test filtered zero results including matching native cards, late matches, pending groups, unknown-status qualification, partial Overview failure, archive failure, cursor stalls, rate limits, eight-page bounds, Back and route/account changes. Verify adapted empty states survive the privacy-notice guard.
- Visually compare native and extended menus in Brave across Overview/Posts/Comments, available/deleted/banned profiles, narrow/wide windows and viewport edges. Check trigger dimensions, selected opacity, native tick/radio appearance, popup anchoring and keyboard focus. Keep research captures ignored.

## Delivery

Implement native control integration and state/empty behavior as coherent commits with relevant tests, then run the full suite, JavaScript syntax checks, archive integrity and source/stable-folder/archive byte equality. Rebuild the existing `artifacts/reddit-chat-search/` installation. Treat these as corrections to the current unreleased 0.17.0 bundle, keeping its version unless implementation reveals a separately justified behavior expansion. Record any native-contract/provider limitations and distinguish synthetic checks from installed live verification.
