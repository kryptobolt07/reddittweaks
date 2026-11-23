# Mobile post header

On mobile post and comment-permalink pages, small changes in scroll direction can interrupt the navigation row while it is sliding into view. The extension keeps the row in its last settled state until the reader scrolls far enough in the opposite direction.

| Transition | Expected behavior |
|---|---|
| Open a post or return to the top (T1–T4) | Show the native navigation row. A post with a restored scroll position starts measuring from that position. |
| Scroll away from the top | Hide after a downward movement of at least 24 CSS px. |
| Scroll back up within the post | Reveal after an upward movement of at least 12 CSS px from the furthest downward point. |
| Change direction while the row is revealed | Hide after a downward movement of at least 24 CSS px from the furthest upward point. Small reversals leave the current visibility target in place, so the row can finish its animation. |
| Reddit replaces the header on the same post (T7) | Put the current visibility on the replacement row in the next render. |
| Tab into the row (T8) | Reveal it for keyboard focus. Scroll can still hide it after the navbar receives focus back from a drawer. |
| Leave the post or switch to desktop layout (T15) | Return control of the existing row to Reddit. |

The existing navigation controls, row height, and page scroll position are retained. Home keeps its existing behavior. Subreddit feeds, search pages, and profile tabs use Reddit's existing headers.

The mobile header controller marks the existing post header after it appears. It removes the marker when Reddit replaces the header, navigation changes the route, the viewport widens, or the controller shuts down. The new row inherits the visibility state only on the same post.

A Chrome Dev check at 440 by 956 CSS px found Reddit's original 48 px header directly beneath the fixed `reddit-header-small`. After scrolling down by 24 px from the last upward turning point, the extension moved that same row to −48 px. The next sustained upward move returned it to 0 px. Small changes in direction while it was open left it at 0 px.

## Sticky community card (2026-11-23)

Reddit's post page puts a sticky community card (`subreddit-header-card[slot="pdp-sticky-community-header"]`: r/name, members, Join or Open App) inside the same fixed `reddit-header-small`, under the 48 px navigation row, once the reader scrolls past the post's own header. Sliding only the navigation row left the card 48 px down with an empty strip above it. The whole fixed header now slides by the navigation row's measured height (`--rt-post-nav-height`):

| Transition | Expected behavior |
|---|---|
| Scroll down past the post header | The navigation row leaves; the community card sits at the top of the viewport (measured y = 0, 49 px tall). |
| Scroll back up | The navigation row and the card slide down together (both move every frame over about 170 ms; card ends at y = 48). |
| Back near the top | Reddit hides the card itself; the row stays shown. |
