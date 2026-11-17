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
