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
