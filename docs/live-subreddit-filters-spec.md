# Filters on live subreddit feeds and searches

In live Brave, r/AskIndia exposes links with `f=flair_name:"…"`. Visiting one showed only posts tagged with that flair and retained the flair in Reddit's native sort links. The feed contains top-level articles, separators and a `faceplate-partial[slot="load-after"]`. The native scoped search with `q=subreddit:AskIndia&type=posts&sort=new` produced post results and its own lazy continuation. Adding a quoted flair operator also returned scoped results. Compact search cards expose fewer media details than feed cards.

| Transition | Expected behavior and check |
|---|---|
| T1, T7: direct load or feed/toolbar replacement | Mount one toolbar, match the current subreddit, and reapply the URL's filters to the replacement feed. |
| T5: change media type or flair | Post type selects loaded feed articles in place with the shared post-type definitions. Flair changes use Reddit's community feed URL or search operator, retaining independent filters. |
| T6: scroll or native pagination | Keep Reddit’s continuation and ads. Filter new articles inside batch wrappers. After two continuations with no matches and no scrollable results, pause the native loader and offer Load more. That action resumes the same pager. |
| T3, T4: Back or Forward | Read scope and filters from the URL. No filter or saved flair choices bleed into another subreddit. |
| T8, T15: desktop and phone | Desktop feed options uses existing Feed options rows, current values and drill-ins. Phone feeds keep their flat chip sheet. Search adds separate inline controls to the native rail, using the profile search dropdown and phone sheet styles. Preserve native sorts and result tabs. Escape and Back restore focus. |
| T10, T16: disabled or unsupported page | Remove extension controls and restore any hidden articles. Leave archive, post, aggregate, and Old Reddit views to their existing owners. |
| Empty scoped Enter | The existing community search field opens native Posts results using a scope-only query. Typed keywords, modifier keys and IME are left to Reddit. |
| Search filters | Sort, time, Posts/Comments/Media and flair link to native scoped search. Enforce the date on loaded Posts and Comments when Reddit ignores it under some sorts. Media omits timestamps and uses Reddit’s server-side time behavior. |

Flair choices come from native links and loaded cards, with a short bounded list kept per community for search and an exact-name input for unlisted flairs. The extension does not fetch another feed, infer that results are exhaustive, or add an API dependency. The existing discovery preference also governs these controls. Search coverage and ranking follow Reddit.

Live Brave verification used the feature source temporarily in one owned Reddit tab. At desktop width the dropdown was 360px wide, 8px below its trigger, with an 8px radius and the shared icons. At 390px emulated width the sheet filled the viewport width and met its bottom edge. A live feed appended posts in `faceplate-batch` wrappers. The Videos and Polls filters reached those cards. The no-match pager paused after two pages, and pressing Load more advanced from 102 to 152 loaded posts before pausing again. Empty Enter opened native search with seven cards and a blank keyword field. The Past hour check rejected four older cards in a live New search. Firefox and physical touch behavior were not measured live.

On Media search, the Media type submenu lets users combine Photos, Videos, GIFs and Galleries. Use native type markers and the thumbnail evidence already rendered. Reddit sometimes serves a flat image thumbnail without metadata that distinguishes a gallery or an animated source. In that case the thumbnail is grouped with Photos. The submenu does not request individual posts.

## Sort in subreddit feed options

Live Reddit renders native sorts and Top time ranges as separate `shreddit-sort-dropdown` controls with `feed-sort-change` and `feed-time-sort-change`. The main sort's links arrive in Reddit's initial markup. Use those links inside desktop Sort and the phone sheet. The active sort and time range use Reddit's selected labels. Preserve flair, the local type filter and feed layout on sort navigation. Hide those identified controls from the first paint on managed feed routes. Return a control to Reddit if its menu cannot be populated. Search keeps its own native Sort control. The independent feed View control stays available.

| Transition | Acceptance |
|---|---|
| Feed load or native sort hydration | Suppress the recognized sort controls before the managed toolbar appears, then show one Sort entry in Feed options. Restore unsupported controls and release the hold on opt-out. |
| Select a sort or a Top time range | Follow Reddit's same-community destination and preserve unrelated filters. Current values reflect the destination. |
| Feed or native controls are replaced | Pick up the new controls, with no duplicate extension menu. Restore the native controls on disable or teardown. |

With this extension alone in a clean Chromium profile, the first frame containing the sort rail on a live subreddit had Feed options and Reddit's View control visible. The native Sort control had zero visible frames.

## Naming and phone parity (2026-11-19)

The subreddit toolbar button and its phone sheet are named **Feed options**, the name of the profile menu they mirror (previously "Filters"). Live at 390 px the button is 143 px wide and stays on one row with the type chip and Reddit's View control.

| | Desktop | Phone |
|---|---|---|
| Sort | Feed options → Sort lists Reddit's own sort links with the shared outline icons | The sheet lists the same sorts at the top |
| Top time range | Reddit renders a time control only on Top; Sort then shows Time range | Same: a Time range row drills into Reddit's ranges (measured on `/top/?t=week`) |
| Post type, Flair | Drill-ins in the menu | Chips and a Flair drill-in in the sheet |

Reddit's native sort menu carries no icons; the New glyph is the outline clock with a heavier ring, not a filled variant.
