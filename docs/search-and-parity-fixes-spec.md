# Spec: search fixes, one query language everywhere, and archive parity

Status: in progress (written 2026-11-12). Separate from the feature roadmap (raffles, removal detection, redaction). Like the other specs, this is the bar to reach, not a step list. It follows the [interaction and lifecycle contract](interaction-lifecycle-contract.md); §6 lists the transitions it must pass.

## 1. Issues to fix

| ID | Issue (user's report) | Required result |
|---|---|---|
| I1 | Floating chat: clicking another conversation in the sidebar makes our search bar collapse and re-expand for a moment. | The bars never change size or disappear when switching conversations. **Fixed in 6c8c72a**: Reddit rebuilds the room and removes our bar; it's now put back before the next paint instead of after a 120 ms debounce. |
| I2 | Opening a list search link (`…/search/?q=…&rt_list=saved`) shows the Saved pill appearing and disappearing 2–3 times. Same for the other lists and the filter pills. | Each pill appears once, in the same frame as Reddit's own `u/` pill, and stays. |
| I3 | Your own profile's search page has no way to switch to Saved, History, Hidden, Upvoted or Downvoted. | A **List** filter on your own profile's search page: All activity, Saved, History, Hidden, Upvoted, Downvoted. Picking one turns the search into that list search (pill and all); picking All activity removes it. Not shown on other people's profiles. |
| I4 | On archive pages for banned or deleted communities (seen on single post pages), the header search bar, its icon sizes and its fonts differ from a normal community's. | Every archive page type (feed, post, search, about) has the same header search bar as the equivalent live community page: scope pill, icon size, font size, weight and spacing. |
| I5 | Search Comments on an archived post doesn't behave like Reddit's comment search on a normal post. | The same interaction, results layout, highlighting, result count wording and way back to the full thread as Reddit's own comment search, over the loaded archived comments. **Rebuilt from measured native values** (2026-11-13): Reddit's markup and its own `faceplate-search-input`; the button swaps to the box with Cancel (Sort by hidden), Enter searches, Escape in an empty box closes; result cards, "All Comments" and the no-results box match Reddit's sizes; the toolbar arrives with the post; a result opens the comment's permalink with its thread first, Reddit's highlight, and the toolbar under the header. Colours follow the archive page's own Reddit theme, which differs slightly from live community pages. |
| I6 | Search across the extension is "not that advanced", and there are no docs. | One query language (§3) in every search box (§4), discoverable from the box itself, with in-app help and a docs page (§5). |

## 2. Live captures needed first (I4, I5)

These items depend on what Reddit does, so capture it before changing anything. They need the signed-in browser relay or Claude in Chrome; the in-app browser blocks reddit.com.

- **N1. Comment search on a live post.** On a public post with many comments: what typing does (live filter or Enter), the URL after searching, how results look (full comments or snippets, highlight style, count text), how you get back to all comments, what happens with no matches, and the mobile layout. Record DOM and timings with `probe-inventory` and `probe-timeline`.
- **N2. Header search on live community pages.** The scope pill (`r/name`), its icon size, font, weight and padding, on a feed page, a post page, a search page and an about page, in light and dark mode, desktop and mobile. Then the same on our archive pages, and diff the two.

## 3. The query language (one grammar, every box)

Already implemented in `search-core.js` (`parseQuery`, `prepareQuery`, `matchRecord`, `splitQuery`). This is the contract it must meet everywhere:

| Syntax | Meaning | Example |
|---|---|---|
| words | All words must match (AND) | `battery laptop` |
| `"exact phrase"` | Exact phrase | `"battery health"` |
| `OR` (uppercase) | Either side | `laptop OR notebook` |
| `NOT`, `-word` | Exclude | `laptop -gaming`, `NOT "for sale"` |
| `( … )` | Grouping | `(rog OR legion) -used` |
| `title:` `body:` | Search one field | `title:review` |
| `author:` / `u/` | By author | `u/spez` |
| `subreddit:` / `r/` | In a community | `r/termux` |
| `site:` `url:` | Link domain or URL | `site:github.com` |
| `flair:` `type:` `self:` `nsfw:` `spoiler:` | Post metadata | `flair:Help type:image` |
| `from:` `has:` `after:` `before:` | Chat only: sender, media, dates | `from:alex has:image after:2026-01-01` |

Rules:

- Only uppercase `AND`, `OR` and `NOT` are operators. Lowercase words are ordinary search words.
- Precedence: `NOT`/`-` binds tightest, then `OR`, then `AND` (spaces). `a b OR c` means `a AND (b OR c)`, as today.
- A field a box can't use (for example `from:` in profile search) is an error with a clear message, never silently ignored.
- When Reddit or Arctic Shift can only run part of a query, the rest is matched locally and the status says "Some matches filtered locally". This exists today; keep it.

## 4. Where it applies

| Box | Today | Required |
|---|---|---|
| Chat: conversation list search | Full grammar plus chat fields | Keep; add help (§5) |
| Chat: in-conversation search | Full grammar plus chat fields | Keep; add help |
| Profile search (anyone's) | Full grammar, split between Reddit and the archive | Keep; add help |
| Your list searches (Saved, History, …) | Full grammar, local | Keep; add help |
| Archive community search | Full grammar, split with the archive | Keep; add help |
| **Archived post: Search Comments** | Plain text match only | **Full grammar over loaded comments** (`author:`/`u/`, `body:`, phrases, OR, NOT), with Reddit's own layout (I5) |

## 5. Help and docs

- **H1. In-box help.** Every search box above gets a small "Search tips" control in Reddit's style (an info icon in the field, or a "Search tips" row at the bottom of its suggestions). It opens a compact card with the §3 table, cut down to the fields that box supports, with two or three tappable examples that fill the box.
- **H2. Errors teach.** Invalid queries keep showing the parser's message ("Put a word on both sides of OR"), with a link to the tips card.
- **H3. Docs page.** `docs/search-syntax.md` with the full grammar, the fields each box supports, precedence, examples, and the "filtered locally" and coverage notes. The README links to it.
- **H4. Popup.** One line in the popup ("Search tips: AND, OR, NOT, "phrases", author:, r/…") linking to the docs page.

## 6. Transitions (from the contract)

| T | Where | Expected |
|---|---|---|
| T1 | Direct load of a list search or filtered search | Pills appear once, with Reddit's header, and never blink (I2). The List filter shows the current list. |
| T3 | Back to a list search | Unchanged from 0.30.3: results, pills and scroll come back at once. |
| T5 | Change the List filter | One navigation; the pill changes in place; the results switch to that list; no flash of Reddit's own results. |
| T7 | Reddit re-renders the header | Pills stay; no remove-and-add cycle visible in any frame. |
| T7b | Reddit rebuilds a chat room | Search bars stay the same size in every frame (I1). |
| T8 | Open and close the tips card | Reddit-style popover; Escape and outside click close it; focus returns to the control. |
| T15 | Mobile and dark mode | Tips card and List filter work in both. |

## 7. Acceptance checks

| ID | Check |
|---|---|
| A1 | I1: unit test (Reddit rebuilds the room → our trigger is back within microtasks); passes (`room-search-flow.test.cjs`). |
| A2 | I2: timeline on a direct load of `rt_list=saved` (live): the pill count in the header never decreases between the first frame it appears and 5 s later. Unit test: a header re-render keeps the pill without a dismissal. |
| A3 | I3: fixture test: the List filter appears only on your own profile search; choosing Saved navigates to `rt_list=saved` with the same `q`; choosing All activity removes `rt_list`. |
| A4 | I4: inventory diff of the header search bar between a live community page and each archive page type: same sizes, fonts and colours (tolerance 1 px). |
| A5 | I5: side-by-side timeline and inventory against N1; the same query on both gives the same layout and count wording. |
| A6 | §3/§4: one shared test table of queries run against every box's matcher, with the same expected matches for the fields each supports. |
| A7 | §5: every search box has a reachable tips control (keyboard included); examples fill the box; `docs/search-syntax.md` exists and is linked from the README and popup. |
