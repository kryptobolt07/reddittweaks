# Filters on live subreddit feeds and searches

In live Brave, r/AskIndia exposes links with `f=flair_name:"…"`. Visiting one showed only posts tagged with that flair and retained the flair in Reddit's native sort links. The feed contains top-level articles, separators and a `faceplate-partial[slot="load-after"]`. The native scoped search with `q=subreddit:AskIndia&type=posts&sort=new` produced post results and its own lazy continuation. Adding a quoted flair operator also returned scoped results. Compact search cards expose fewer media details than feed cards.

| Transition | Expected behavior and check |
|---|---|
| T1, T7: direct load or feed/toolbar replacement | Mount one toolbar, match the current subreddit, and reapply the URL's filters to the replacement feed. |
| T5: change media type or flair | Post type selects loaded feed articles in place with the shared post-type definitions. Flair changes use Reddit's community feed URL or search operator, retaining independent filters. |
| T6: scroll or native pagination | Keep Reddit’s continuation and ads. Filter new articles inside batch wrappers. After two continuations with no matches and no scrollable results, pause the native loader and offer Load more. That action resumes the same pager. |
| T6: native pagination ends | When a filtered feed loses its previously mounted continuation and still has loaded cards, show an end message after the feed. Offer the other New or Top destinations that Reddit exposes, with all filters preserved. An initial load with no observed pager does not imply exhaustion. |
| T3, T4: Back or Forward | Read scope and filters from the URL. No filter or saved flair choices bleed into another subreddit. |
| T8, T15: desktop and phone | Desktop feed options uses existing Feed options rows, current values and drill-ins. Phone feeds keep their flat chip sheet. Search adds separate inline controls to the native rail, using the profile search dropdown and phone sheet styles. Preserve native sorts and result tabs. Escape and Back restore focus. |
| T10, T16: disabled or unsupported page | Remove extension controls and restore any hidden articles. Leave archive, post, aggregate, and Old Reddit views to their existing owners. |
| Empty scoped Enter | The existing community search field opens native Posts results using a scope-only query. Typed keywords, modifier keys and IME are left to Reddit. |
| Search filters | Sort, time, Posts/Comments/Media and flair link to native scoped search. Enforce the date on loaded Posts and Comments when Reddit ignores it under some sorts. Media omits timestamps and uses Reddit’s server-side time behavior. |

Flair choices come from native links and loaded cards, with a short bounded list kept per community for search and an exact-name input for unlisted flairs. The extension does not fetch another feed, infer that results are exhaustive, or add an API dependency. The existing discovery preference also governs these controls. Search coverage and ranking follow Reddit.

On r/AskIndia, Reddit uses a `shreddit-post-flair` link with a `.flair-content` label inside a colored pill. Reuse that pill's foreground, background and Reddit-hosted flair emoji in the picker. A community's own flair navigation takes priority over a pill on an individual post. Both desktop menus and the phone sheet keep their existing controls and use a tag icon for Flair. Cache the observed styles per community for search. Labels with no observed style remain available as plain choices.

The Flair panel also shows Reddit's NSFW content tag as an independent toggle. A subreddit feed uses the native post labels on loaded cards. Scoped search uses Reddit's `nsfw:yes` operator and keeps the current Safe Search setting. The NSFW chip can be removed without changing the community flair or other filters.

The applied chip and the current-value summaries reuse the same styled flair as the picker. Live r/GTA6 has a transparent bordered flair whose displayed content is three images. Its encoded label stays in the URL and accessible name while the chip shows the images.

Chrome CDP on the existing mobile Videos feed for r/GeminiAI found 500 cards, 477 hidden by the filter, and no native continuation or virtualizer placeholders at the bottom. A separate capture recorded five HTTP 200 continuation responses with another pager in each response. The terminal response and an extension-disabled scroll to the same depth were not captured.

Live Brave verification used the feature source temporarily in one owned Reddit tab. At desktop width the dropdown was 360px wide, 8px below its trigger, with an 8px radius and the shared icons. At 390px emulated width the sheet filled the viewport width and met its bottom edge. A live feed appended posts in `faceplate-batch` wrappers. The Videos and Polls filters reached those cards. The no-match pager paused after two pages, and pressing Load more advanced from 102 to 152 loaded posts before pausing again. Empty Enter opened native search with seven cards and a blank keyword field. The Past hour check rejected four older cards in a live New search. Firefox and physical touch behavior were not measured live.

On Media search, the Media type submenu lets users combine Photos, Videos, GIFs and Galleries. Use native type markers and the thumbnail evidence already rendered. Reddit sometimes serves a flat image thumbnail without metadata that distinguishes a gallery or an animated source. In that case the thumbnail is grouped with Photos. The submenu does not request individual posts.

## Sort in subreddit feed options

Live Reddit renders native sorts and Top time ranges as separate `shreddit-sort-dropdown` controls with `feed-sort-change` and `feed-time-sort-change`. The main sort's links arrive in Reddit's initial markup. Use those links inside desktop Sort and the phone sheet. The active sort and time range use Reddit's selected labels. Preserve flair, the local type filter and feed layout on sort navigation. Hide those identified controls from the first paint on managed feed routes. Return a control to Reddit if its menu cannot be populated. Search keeps its own native Sort control. The independent feed View control stays available.

Top opens the time-range page before committing a sort on desktop and phone. Reuse the native range links when rendered. From a different sort, use the six choices measured on Reddit's subreddit Top menu (Now, Today, This Week, This Month, This Year, All Time) with the current community's native Top link. Choosing a range navigates exactly once. Back returns to Sort and preserves the current feed URL.

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

## Opening and returning to a filtered feed

On live Brave, opening **Circus champion tricks** from the Videos feed changed the URL while the original subreddit feed was still mounted. The old card filter was cleared at that point, before Reddit attached the detail page. Back reused the outgoing feed and its paginated cards. Save the opened card's ID and viewport offset before navigation so the filtered layout can correct Reddit's restored scroll position.

| Transition | Acceptance |
|---|---|
| T2, T7: open a post from a type-filtered feed | Keep the old feed filtered. Hide it while Reddit replaces it, including opens where no video was playing. A detail card mounted in the same container remains visible. Exception (user decision 2026-11-19): while a playing video or YouTube player waits at its card and moves into the post (`html[data-rt-media-moving]`), the filtered feed stays visible behind it, so the video never floats on a blank page. |
| T3, T4: return to that feed history entry | Apply the saved URL's filters before restoring the card and its viewport offset. Let geometry settle before revealing the feed. If the card is missing, try the saved scroll coordinate for a bounded time. |
| T10, T16: redirect, user interaction or opt-out | Release the hold. A different feed entry, a new-tab click or a reader taking over scrolling does not inherit the saved position. |

The same-document return state is scoped to the browser history entry. On the same live Videos feed in Brave, a later paginated video opened with the outgoing feed hidden and its filter marks intact. After Back, a probe shifted the scroll by 180 px during restoration. The card returned to its original 109 px viewport offset before the feed was shown. Fresh documents still use Reddit's native scroll restoration.

On the filtered subreddit in Brave, Reddit's Card and Compact destinations already included the Videos filter. The shared chip wrapper used its default full-width sizing inside Reddit's compact toolbar, so the chip container received pointer input at the center of the native View button. Use the existing inline chip rail sizing when the community toolbar sits in Reddit's feed rail. The native trigger must receive pointer input with filters active, and the Card and Compact links must retain the filter.

With the inline rail sizing applied in Brave, the same pointer coordinates opened Reddit's View menu. Both links retained Videos and loaded cards with their requested `cardView` and `compactView` layouts.

## Post menu latency on large feeds

The mobile layout in regular Chrome had 497 mounted posts and about 67,500 light DOM elements in an NSFW-filtered feed. The native three-dot menu mounts a separate portal under `shreddit-app` and then fills it with the native actions and the copied extension rows. A slow tap took 848 ms in Chrome Event Timing. A CPU profile showed Reddit reading portal colors and the visual viewport, alongside extension observers sweeping the feed, post menus, and unrelated profile and account controls.

| Transition | Expected behavior |
| --- | --- |
| T1, T6, T7 | Reddit can hydrate or replace a post menu and append a batch while the sheet is open. Download and Raffle rows are prepared for the affected menu. Filtering still processes actual feed changes. |
| T8, T15 | The inline menu and phone sheet open and close through Reddit. Mutations confined to the menu skip feed, profile, account and chat discovery. Download and Raffle reconcile the affected menu and deduplicate projected mobile rows. |

An NSFW-only filter checks a post's NSFW marker without inspecting the post's media to infer a type. If a type filter is also active, run that check for posts that match the other filters. Reddit still owns the sheet, including its theme, viewport sizing and focus behavior.

Download media uses a source presence check when mounting its action. Both its desktop dropdown and mobile submenu open with a loading skeleton, then parse the chosen post's media and build the quality or image rows after a frame. Closing the panel cancels that work. The phone's Back row stays focused while options load, and an unreadable source shows an inline message.

With Videos and NSFW enabled on the same 440 px Chrome tab, 496 posts were mounted and only four matched. The filtered-out article subtrees contained more than 61,000 light DOM elements, even though their wrappers had zero height. Three taps measured 584–608 ms from click to next paint. The filter controller did not refresh during the taps. Chrome attributed 344–367 ms of forced style and layout to Reddit's native menu listener, including its portal color and viewport reads.

Once at least 40 ordinary native cards are filtered out, detach their post subtrees and keep the hidden article, separator, and pagination in the original feed. Restore the same nodes in their original positions when filters change or are disabled, including in batches cached by Reddit. Parking and restoration mutations do not queue a redundant filter refresh.

Running that implementation in the same tab reduced click-to-next-paint to 152–160 ms and native forced style and layout to about 86 ms. Reddit's action sheet kept the same seven actions and closed normally. The regression fixture covers later native batches, original node identity, separators, pagination, and clearing filters while a batch is detached.
