# Mobile Home header

At 390 px in Chrome with Reddit's Android layout, Home has a 56 px navigation row and a separate 55 px prominent search row. Both leave the viewport when scrolling down and remain offscreen when scrolling back up. The subreddit header is one fixed 56 px row with a Search icon beside the other navigation controls.

| Transition | Expected behavior |
|---|---|
| Load Home or return to the top | Reddit's original header and prominent search stay in document flow. |
| Scroll beyond the top navigation row | Keep the compact bar hidden while scrolling down. Reveal it on an upward movement of at least 8 px and hide it again after a downward movement of at least 8 px. |
| Compact header appears | Use the same navigation nodes, height and styling as the live header. Add a Search icon wired to Home's existing search trigger. Reserve the original navigation row's height and keep the feed at its current scroll position. |
| Route change, wider layout or header replacement | Remove the old styling and button. Bind to the new Home header when it is available. |

The feature applies to the mobile Home route. It uses the viewport scroll position and preserves the native menu, account drawer and search dialog.
