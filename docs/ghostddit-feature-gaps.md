# Ghostddit feature gaps

Ghostddit (https://ghostddit.aeddit.com/, "v2") is a free, no-login web viewer for the Arctic Shift archive. It has user and subreddit pages, including banned, deleted and suspended ones. Live Reddit is used only for profile details, subreddit details and "Top of all time".

Evidence comes from browsing the live site on 2026-10-30: the home page, the FAQ, a public user page (Posts, Comments and Sherlock tabs, and every filter menu), a subreddit page and a suspended account's page. Nothing was submitted, and the Sherlock chat was not used, because questions it can't answer are sent to the developer. Items marked **unverified** were seen only as labels or FAQ text.

Ghostddit is a standalone archive browser. We restore content inside Reddit's own pages, which it can't do. We also tell deleted accounts from banned ones; Ghostddit shows one combined notice: "deleted, banned or suspended". Its advantages are search, filters, profile insights and whole-history loading.

Priority is user value. Effort is S (under a day), M (a few days) or L (a week or more).

## A. Search inside a user or subreddit

| # | Feature | What Ghostddit does | How we could build it | Priority | Effort |
|---|---|---|---|---|---|
| 1 | Keyword search in a user's history | A "Search posts in u/…" or "Search comments in u/…" box above each tab. The FAQ says that for very active users it "scans through their history in pages and matches your words in the browser". | Add a search field to our Feed options menu on profiles. Arctic Shift supports `author` plus `title`/`selftext`/`body` text search on smaller histories. For large ones, page through `author=` results with `before` cursors and match locally, then show matches as our normal archive or Reddit cards. Cap the pages per query, show progress, and allow cancelling. | High | M |
| 2 | Query operators | `"exact phrase"`, `OR`, and `-word` to exclude. | Add a small parser with a client-side matcher, run on every loaded record including Reddit-search items. Send only the plain terms to Arctic Shift. | Medium | S |
| 3 | Subreddit search filtered by author | On a subreddit page, typing `u/name` in the search box shows only that person's posts. | This needs a subreddit-page integration (see #16). Arctic Shift accepts `subreddit` and `author` together. | Low | M |
| 4 | Recent searches | Kept only in the browser. Each can be removed with its ×, "Clear all" empties the list, and a setting stops saving. | Store them in `chrome.storage.local`, scoped to the signed-in account. Add a popup toggle and a clear button. Never sync them. | Low | S |

## B. Feed filters and sorts (user pages)

| # | Feature | What Ghostddit does | How we could build it | Priority | Effort |
|---|---|---|---|---|---|
| 5 | Date filter | Presets for the last 24 hours, week, month and year, plus a From/To calendar. | Reuse our chat calendar (`date-picker.js`) as a "Date" row in Feed options. Pass `after` and `before` to Arctic Shift and Reddit search, and hide merged items outside the range. Native Reddit cards outside the range get `data-rt-filter-hidden`. | High | M |
| 6 | Post type filter | All types, Text, Image, Video, Gallery, Link or Crosspost (Posts tab only). | Classify archive records from `is_self`, `is_video`, `is_gallery`/`gallery_data`, `post_hint` and `crosspost_parent`. Classify native cards from `post-type` and their media slots. Add it as a Feed options submenu. | Medium | M |
| 7 | Subreddit filter with counts | Lists every subreddit in the loaded history with a count each (for example "r/announcements 30"). Has a search box and allows up to 8 picks. | Build the list from loaded records, native and archive. Filter locally, and send `subreddit=` to Arctic Shift when exactly one is picked so it can narrow on its side. Show counts as "in loaded items". | Medium | M |
| 8 | "Old" (oldest first) sort | The sorts are New, Hot, **Old**, Top and Most Commented. Reddit profiles have no oldest-first sort. | Old: page Arctic Shift with `sort=asc` and show archive items in ascending order. Reddit's native feed can't be reversed, so this sort would be archive-only and should say so. | Medium | M |
| 9 | Most Commented sort | The FAQ says it ranks only what has loaded so far and improves as you scroll. | Reorder our merged items by `num_comments`, labelled "loaded items only". Archive counts may be stale (see #22). | Low | S |

## C. Profile header and insights

| # | Feature | What Ghostddit does | How we could build it | Priority | Effort |
|---|---|---|---|---|---|
| 10 | Unavailable-account card | Shows a notice ("This account is no longer available on Reddit… Showing what the archive has"), a blank avatar, karma estimated from archived items, and a "first seen" date marked "Approximate, from the latest archived items". | We already have an archive stats panel. Add to it: (a) the deleted-or-banned state we already get from the hover card, with a clear label and Reddit's own artwork (the deleted-user and suspended-snoo images that Reddit uses, e.g. `suspended-snoo.png`); (b) estimated post, comment and total karma summed from loaded records; (c) first and last seen dates. Keep "approximate" visible. **This matches the open request for a clear deleted/banned indicator on profiles.** | High | M |
| 11 | Trophies list | "View more" expands to the full trophy list with dates. | Only for live accounts; Reddit shows trophies itself on desktop. Skip unless the archive keeps them (it doesn't), so there's no gain for deleted accounts. | Low | — |
| 12 | Quick actions | Share, open on Reddit, and "chat" (a `chat.reddit.com/user/t2_…` link) under the header. | For unavailable accounts, add "Copy archive link" and "Open in Arctic Shift". Skip chat, because a deleted account can't receive messages. | Low | S |
| 13 | Insights ("Sherlock" presets) | Rule-based answers over the loaded data, run locally: Summary, Top subreddits, Most upvoted post, "When are they most active?", Karma, Trophies, "How old are they?", "Mentions of…". | Add an "Insights" panel in the profile sidebar, computed only from loaded records with no extra requests: top subreddits (from #7), most upvoted items, an hour-of-day by weekday activity heatmap (local time or UTC, see #19), account age, and a "mentions of [word]" count (from #1). Label everything "from N loaded items". Skip the chatbot UI and send nothing anywhere. | Medium | M |
| 14 | Load whole history | Actions: "Load more data", "Load full history" and "Load last year". | Add a "Load all archive items" action (and "last year") to Feed options. It walks Arctic Shift pages in the background with our existing rate limits and maintenance handling, then feeds search (#1), filters (#5–7) and insights (#13). It needs a cap, progress, cancel, and a cache scoped to the signed-in account. | Medium | M |

## D. Subreddits

| # | Feature | What Ghostddit does | How we could build it | Priority | Effort |
|---|---|---|---|---|---|
| 15 | Subreddit archive page | `/r/<name>` shows a header (description, members, created date), New/Date/Post type filters and an archive feed. It works for banned or private subreddits. | When Reddit shows a banned, private or quarantine-blocked subreddit, show "Browse archived posts" and render Arctic Shift `subreddit=` posts with our existing archive card view (`archive-view.js`). Leave live subreddits alone; Reddit already lists them. | Medium | L |
| 16 | Search a subreddit's archive | "Search r/india, or add u/author…". | Same parser as #1–#3, scoped with `subreddit=`. Best done together with #15. | Low | M |

## E. Settings and display

| # | Feature | What Ghostddit does | How we could build it | Priority | Effort |
|---|---|---|---|---|---|
| 17 | Blur adult and spoiler content, with a switch | Adult and spoiler posts stay blurred until tapped. A setting turns the blur off. | Reddit's own cards already blur. Our archive-only cards and restored media follow `over_18`/`spoiler` (today we hide restored NSFW media). Add a tap-to-reveal blur and a popup toggle. | Medium | S |
| 18 | Open in Reddit vs. stay | A setting: "open posts on Reddit instead". | Mostly not applicable, since we are on Reddit. For archive-only cards, offer "open the Reddit permalink" vs. "show the archived copy inline". | Low | S |
| 19 | UTC timestamps | A "Use UTC" toggle. | A popup setting. Format our timestamps (archive cards, tooltips, insights) in UTC with exact times in the tooltip. Reddit's own timestamps are left unchanged. | Low | S |
| 20 | Source health indicator | A footer chip: "Reddit API: working (234 ms). Arctic API: working", with a status dot per source. | We already track Arctic Shift maintenance and cooldowns. Show them in the popup: a status per source, the last error, and the time until the next retry. Measure only requests we already make; add no new pings. | Medium | S |
| 21 | Removal-request link | A /removal page explaining that the archive provider handles removals. | Link to Arctic Shift's removal and contact page from the popup's help section. | Low | S |
| 22 | Stale score note | The FAQ says archive scores and comment counts can lag for about 1.5 days. | On archive-only cards, add "Score from the archive, may be outdated" to the source tooltip. This fits our rule that cached data is not verified data. | Medium | S |

## Not worth copying

- PWA install, the `u/` and `r/` search routing, the live "N people using" counter, the "fun fact" tips and the Discord link. These belong to a standalone site.
- "Top of all time" loaded from Reddit, because Reddit's native Top already does this on its own pages.
- A chatbot UI. The useful part is the local insights (#13); sending unanswered questions to a developer would break our privacy rules.

## Unverified

- What Ghostddit calls exactly (endpoints and parameters). Only "Arctic Shift" and "live from Reddit" are stated.
- Whether Hot ranking uses a formula or Reddit's order. The FAQ only says it improves as more loads.
- Whether video audio is ever fetched. The FAQ says archive videos usually play silent.

## Suggested order

1. #10 Unavailable-account card with a deleted/banned label and Reddit artwork (already requested), plus #22.
2. #5 Date filter and #1/#2 history search, both driven by #14 bulk loading.
3. #7 Subreddit filter, #6 post type and #13 insights, all computed from what has loaded.
4. #20 health chip, #17 blur and #19 UTC in the popup.
5. #15/#16 subreddit archive pages.
