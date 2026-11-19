# Custom feed filters

The linked custom feed uses a native `shreddit-feed` with `curator` and `feedName` in its reload URL. Its Sort and View controls link back to the same custom feed. Reddit exposes a `custom_feed` search scope, and the custom feed's own `/search/?q=` route returned a native results page in Chrome.

| Transition | Expected behavior |
|---|---|
| Open a selected custom feed | Add the same desktop or phone Feed options used on a subreddit. Use Reddit's sorting and view links. |
| Apply Post type, Flair or NSFW in a custom feed | Filter the currently loaded native cards. Keep the original pager and preserve other filters through sorting and view changes. |
| Apply filters on a phone | Keep Feed and About at their native height. Place Feed options and its wrapping filter chips in their own row above the posts. |
| Press Enter on the empty scoped search field | Open the custom feed's native search with an empty query. Preserve the active flair and NSFW choices. |
| Open custom-feed search | Reuse the same search filters as on a subreddit, including native sort and time, Media type and Flair. Use Reddit's custom-feed search scope for every query. |
| Browse a different feed or use Back | Scope choices and restore state to the owner and feed name. Never apply a new feed's filters to the previous native feed while Reddit is changing routes. |

The custom feed directory stays native. Communities and results stay within Reddit's selected feed and search route.

Chrome CDP at a 390 px mobile viewport measured native Feed and About at 40 px. With the previous filter layout both stretched to 120 px. With the toolbar moved above the posts both measured 40 px again, with the applied chip and four filtered elements still present.
