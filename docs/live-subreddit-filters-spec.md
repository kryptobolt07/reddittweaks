# Filters on live subreddit feeds and searches

In live Brave, r/AskIndia exposes links with `f=flair_name:"…"`. Visiting one showed only posts tagged with that flair and retained the flair in Reddit's native sort links. The feed contains top-level articles, separators and a `faceplate-partial[slot="load-after"]`. The native scoped search with `q=subreddit:AskIndia&type=posts&sort=new` produced post results and its own lazy continuation. Adding a quoted flair operator also returned scoped results. Compact search cards expose fewer media details than feed cards.

| Transition | Expected behavior and check |
|---|---|
| T1, T7: direct load or feed/toolbar replacement | Mount one toolbar, match the current subreddit, and reapply the URL's filters to the replacement feed. |
| T5: change media type or flair | Post type selects loaded feed articles in place with the shared post-type definitions. Flair changes use Reddit's community feed URL or search operator, retaining independent filters. |
| T6: scroll or native pagination | Keep Reddit’s continuation and ads. Filter new articles inside batch wrappers. After two continuations with no matches and no scrollable results, pause the native loader and offer Load more. That action resumes the same pager. |
| T3, T4: Back or Forward | Read scope and filters from the URL. No filter or saved flair choices bleed into another subreddit. |
| T8, T15: desktop and phone | Open the shared filter controls from one button. Preserve native sorts and tabs. Escape closes and restores focus. |
| T10, T16: disabled or unsupported page | Remove extension controls and restore any hidden articles. Leave archive, post, aggregate, and Old Reddit views to their existing owners. |
| Empty scoped Enter | The actual community search field opens native Posts results using a scope-only query. A Browse posts action provides an explicit entry. Typed keywords, modifier keys and IME are left to Reddit. |
| Search filters | Sort, time, Posts/Comments/Media and flair link to native scoped search. Enforce the date on loaded Posts and Comments when Reddit ignores it under some sorts. Media omits timestamps and uses Reddit’s server-side time behavior. |

Flair choices come from native links and loaded cards, with a short bounded list kept per community for search and an exact-name input for unlisted flairs. The extension does not fetch another feed, infer that results are exhaustive, or add an API dependency. The existing discovery preference also governs these controls. Search coverage and ranking follow Reddit.

Live Brave verification used the feature source temporarily in one owned Reddit tab. At desktop width the dropdown was 360px wide, 8px below its trigger, with an 8px radius and the shared icons. At 390px emulated width the sheet filled the viewport width and met its bottom edge. A live feed appended posts in `faceplate-batch` wrappers. The Videos and Polls filters reached those cards. The no-match pager paused after two pages, and pressing Load more advanced from 102 to 152 loaded posts before pausing again. Empty Enter opened native search with seven cards and a blank keyword field. The Past hour check rejected four older cards in a live New search. Firefox and physical touch behavior were not measured live.
