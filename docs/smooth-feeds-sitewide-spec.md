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

## Phones (measured 2026-11-19, phone-emulated r/gamingindian Videos feed, user scrolling)

A 45 s recording of the user flicking through the feed: the page's main thread was busy 45.7 s of 45.9 s; 101 of 273 frames were at least half blank, almost all of it posts this feature had skipped drawing; 132 frame gaps were over 120 ms (longest 904 ms). Our share: the own-removal scan ran on every frame (~5.8 s), the profile-feed sync check ran on every scroll event on every page (~1.3 s). Reddit's own code forced layout for ~7.8 s.

- Phones (`(hover: none), (pointer: coarse)`) do not skip anything, on feeds or extension-owned profile feeds. A/B with the user flicking 45 s each way on the same feed: skipping on, 12 of 136 frames (8.8 %) at least half blank, 3.0 fps; off, 1 of 98 (1.0 %), 2.1 fps; the main thread was saturated by Reddit and native rendering either way (49.8 of 51.5 s and 47.0 of 49.0 s busy), so skipping bought no speed. A wider 8-screen margin was tried first and still left blank screens.
- Settings changes now reach every open Reddit tab (the worker had kept the tabs to notify in memory, lost whenever it slept), so switching this off in the popup applies at once; confirmed live: 224 marked posts → 0 without a reload.
- The own-removal scan runs at most every 300 ms and keeps the signed-in name for 2 s per route; it clears badges only when it painted some.
- The profile-feed sync returns at once outside profile pages.
