# Custom feed filters

The linked custom feed uses a native `shreddit-feed` with `curator` and `feedName` in its reload URL. Its Sort and View controls link back to the same custom feed. Reddit exposes a `custom_feed` search scope, and the custom feed's own `/search/?q=` route returned a native results page in Chrome.

| Transition | Expected behavior |
|---|---|
| Open a selected custom feed | Add the same desktop or phone Feed options used on a subreddit. Use Reddit's sorting and view links. |
| Apply Post type, Flair or NSFW in a custom feed | Filter the currently loaded native cards. Keep the original pager and preserve other filters through sorting and view changes. |
| Press Enter on the empty scoped search field | Open the custom feed's native search with an empty query. Preserve the active flair and NSFW choices. |
| Open custom-feed search | Reuse the same search filters as on a subreddit, including native sort and time, Media type and Flair. Use Reddit's custom-feed search scope for every query. |
| Browse a different feed or use Back | Scope choices and restore state to the owner and feed name. Never apply a new feed's filters to the previous native feed while Reddit is changing routes. |

The custom feed directory stays native. Communities and results stay within Reddit's selected feed and search route.
