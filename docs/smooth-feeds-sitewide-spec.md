# Smooth scrolling across Reddit (2026-11-18)

User request: extend "Smooth long feeds" (profiles only, `docs`/0.42.0) to the rest of the site — home and subreddit feeds and the like — with sub-options in the popup.

## Measured (live, read-only)

- Reddit applies no `content-visibility` anywhere (home, Popular, subreddit, search, post pages), so every loaded post or comment stays laid out and painted however far away it is.
- Home `/`, Popular `/r/popular/` and subreddits `/r/<name>/`: `shreddit-feed` holds `article` posts (each wrapping `shreddit-post`), `shreddit-ad-post` units and `hr` separators; later pages arrive as `faceplate-batch` groups of 24 `article`s inside the same feed (`/svc/shreddit/community-more-posts/…`).
- Search `/search/?type=posts`: post results are `div[data-testid="sdui-post-unit"]` inside `search-telemetry-tracker` wrappers (84 units on one page, about 1,460 px for the first block).
- Post pages: `shreddit-comment-tree` holds one section with every comment (100 `shreddit-comment` elements, 22,358 px tall on a busy AskReddit thread); top-level comments carry `depth="0"`.

## Behaviour

- One master switch, **Smooth scrolling** (setting `smoothFeeds`, default on; no longer requires profile discovery), with sub-options: **Home, Popular & All** (`smoothHome`, on), **Subreddits** (`smoothSubreddits`, on), **Profiles** (`smoothProfiles`, on), **Search results** (`smoothSearch`, on), **Long comment threads** (`smoothComments`, off by default: comment permalinks and Reddit's "more replies" loading are the riskiest).
- A unit (post, ad, search result, top-level comment) more than two screens away (IntersectionObserver, 200 % margin) gets `content-visibility:hidden` at its measured height (`contain-intrinsic-size:auto <h>px`), so the page keeps its height and scroll position; it is drawn again as it comes within two screens. Units holding focus are never skipped.
- Profile feeds the extension manages keep the existing page-world bridge (which also virtualizes very distant cards); the new module handles every other feed, including native profile feeds when profile discovery is off.
- Turning a switch off removes every skip at once; SPA route changes use the area of the new page.

## Transitions

| | Transition | Expected |
|---|---|---|
| T1 | Fast scroll down a long home feed, then back up | No blank posts: posts within two screens are always drawn |
| T2 | Reddit appends a batch | New units observed; nothing jumps |
| T3 | Open a post from a skipped feed and come Back | Reddit's own restoration; units re-observed |
| T4 | Switch an area off in the popup | Its skips removed immediately |
| T5 | Focus inside a far unit (keyboard) | That unit is not skipped |

## Limits

`content-visibility:hidden` units are not matched by the browser's find-in-page until scrolled near; search results and comments vary in height, so the reserved height is the last measured one. Very long pages still hold all their DOM; this skips layout and paint, not memory.
