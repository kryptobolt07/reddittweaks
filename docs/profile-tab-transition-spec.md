# Own-profile tab transitions

## Expected behavior

Switching among Overview, Posts and Comments keeps the profile tab strip stable while Reddit updates the selected tab and feed. The own-account Removed tab stays alongside Reddit's native tabs; it is absent on another account's profile and after sign-out. Reddit continues to own tab selection, focus, navigation, and the surrounding layout.

## Observed transition

In a visible, signed-in Chrome window at 1405 px document width, switching among the three tabs left the main column's left edge at 302.77 px. The own-profile tab group briefly narrowed from 724.04 px to 681.72 px and returned to 724.04 px. A focused Overview → Comments capture showed Reddit's update removed the extension's Removed tab; it returned 250 ms later. The remaining native tab positions stayed fixed while the strip and right arrow contracted and expanded. This measurement identifies one concrete shift; it does not establish that every reported horizontal movement has the same cause.

## Lifecycle and acceptance

| Transition | Expected sequence |
|---|---|
| Reddit updates children of the own-profile tab group | Restore Removed during the mutation checkpoint, before the next paint, without duplicating it or requesting data. |
| Native tab group is replaced | Existing discovery finds the new group and restores Removed; old observers are disconnected. |
| Sign-out, account change, feature disabled, or another profile | Remove Removed and restore Reddit's native page count and selection state. |
| Removed selected → native tab | Restore native selected state and preserve native navigation. |
| Page teardown | Disconnect the observer and remove extension-owned UI. |

`tests/post-discovery.test.cjs` covers native child removal, account changes, selection and tab-group replacement. The child-removal test failed before the observer change and passes afterward. Following a package reload, a foreground Overview → Comments capture kept the group at 724.04 px throughout 3.5 seconds; the earlier matching capture narrowed to 681.72 px for 250 ms. Other post-change directions, phone widths, real pointer input, and a native-without-extension comparison were not measured in this pass. The test does not prove that an entirely replaced tab group is restored before its first paint.

## Collapsed left navigation

A separate report on a public profile showed the entire main column move right and back while the left navigation was collapsed. In a foreground Overview → Posts capture, the native grid changed `flex-nav-collapsed` → `flex-nav-expanded` → `flex-nav-collapsed`; main x moved 182.77 → 302.77 → 182.77 px while document width stayed 1405 px. A later instrumented capture did not reproduce the change, so the native controller's `expanded` attribute at the instant of the shift was not captured. A discovery-off comparison also had no shift in one run; that alone does not establish causation.

Reddit's cached native navigation implementation first applies the server-rendered `expanded` attribute to its grid, then asynchronously reads the saved UI preference. For each incoming native profile navigation, the page-world bridge seeds the valid saved preference once onto the navigation and its grid. It leaves missing or invalid preferences alone, ignores extension-owned navigation, and does not override later native toggles. The profile discovery marker gates this behavior; cookie access stays in the page world. Native node insertion, a later element upgrade, whole-grid replacement, discovery opt-out and a later user toggle are the relevant transitions. The pre-fix test reproduced the server-rendered expanded/collapsed-preference mismatch; the post-fix bridge tests cover seeding and invalid preference. Live post-fix reproduction and physical clicks are not verified by those synthetic tests.

After the seed was packaged and reloaded, a foreground check of the three views kept the grid in `flex-nav-collapsed`; visible cards remained aligned to the main column and Feed options was 12 px inside it. The viewport changed from 1422 to 1280 px during that capture, so its absolute x coordinates cannot be directly compared with the baseline. The user subsequently reported that the shift appears fixed. This does not establish results for other widths or all navigation paths.
