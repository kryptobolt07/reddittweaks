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

## Brave: extension-result loading and the document scrollbar

The follow-up report remained reproducible in Brave 0.43.0 when discovery supplied the cards. Read-only measurements on the requested public profiles at a 1280px viewport showed a different transition: the sidebar remained collapsed, but document client width changed 1265 → 1280 → 1265px as the outgoing results disappeared and the incoming native cards attached. Main/feed/card x changed 112.5 → 120 → 112.5px. On the second profile the empty interval began at 1074ms and enough comments arrived to restore the scrollbar at 4127ms. Thus classic scrollbar removal widened the centered layout; the native-sidebar seeding alone could not prevent this shift.

Reserve the document scrollbar gutter while the existing early profile-discovery marker is active. Use the browser's `scrollbar-gutter: stable`, preserving Reddit's own columns, padding and sidebar state. The same rule covers loading, populated, empty and error states. It is removed through the existing marker lifecycle on unsupported routes or discovery opt-out. No custom viewport width, margin, cookie change, network request or extra observer is needed. Overlay-scrollbar browsers retain their native behavior.

| Transition | Acceptance |
|---|---|
| Populated Posts → empty/loading Comments → attached extension cards | Rendered column width and main/feed x remain constant; loaded cards align to the feed. |
| Populated Comments → loading Overview/Posts | Same stable gutter and native column position. |
| Empty/error result | Gutter stays reserved while the discovery profile is active; no loading-only centering change. |
| Unsupported route / discovery disabled | The scoped rule stops applying with the early marker; native page behavior resumes. |

The regression test checks computed gutter behavior with the actual early profile marker through empty/loading and populated feeds, then opt-out and an unsupported native profile section. Live verification must use Brave with extension-sourced results and classic scrollbars; the earlier Chrome native-feed checks did not establish this behavior.

## Open a different profile with an extension-populated feed

The route can change before Reddit replaces the current profile feed, including when a profile link is opened from floating chat. The outgoing feed may have ready discovery cards and zero native cards. Its visible cards are still evidence that Reddit is displaying the outgoing view.

Chrome CDP reproduced the issue with a floating-chat profile link and an outgoing feed with 15 ready discovery cards and zero native cards. At 222 ms all 15 were removed and a loader appeared while Reddit was still using the old feed and main element. The destination main replaced it at 619 ms.

With the changed guard temporarily applied only in the Chrome test tab, the same link kept all 15 cards visible and showed no loader in the outgoing feed from the URL change at 88 ms to the destination swap at 737 ms. The new profile then handled its own loading state.

| Transition | Acceptance |
|---|---|
| T2 / T7: new profile URL, old feed mounted | Keep the same ready cards and their layout through any transient tab or loader change. Do not mount a new discovery view on that outgoing feed. |
| T7: destination feed or explicit native empty state arrives | Switch discovery to the destination. In-place replacement must never adopt the previous profile's cards as results for the new account. |
| T3 / T10 / T11: cancelled navigation, disabled discovery or account change | Cancelled navigation retains the existing card nodes and filter state. Opt-out and signed-in account changes can tear the old view down immediately. |

With the exact scoped CSS applied temporarily in the affected Brave tab, Comments → Posts kept main/feed/card x at 112.5px throughout the empty/loading interval and while 1–12 extension posts attached. The DOM clientWidth still reflects physical scrollbar presence (1280/1265px), but the reserved gutter keeps the rendered columns stable. The temporary verification style is removed after inspection; the packaged stylesheet supplies the permanent rule after extension reload and page refresh.
