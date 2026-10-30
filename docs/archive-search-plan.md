# Plan: archive search, filters and subreddit archive (0.24.0)

Scope comes from `docs/ghostddit-feature-gaps.md`. The user picked these from it on 2026-10-31.

- **In scope:**
  - A: history search, query operators in every search bar, recent searches.
  - B: profile filters and sorts.
  - D: subreddit archive and subreddit search.
  - C14: bulk loading, only as the engine behind search and filters.
  - PullPush as a second source, if it proves usable.
- **Out of scope for now:**
  - Section E (settings and display).
  - Insights (C13), trophies (C11) and quick actions (C12).

**Ground rule:** everything should look and behave like part of Reddit's own client. Use Reddit's own menus, tabs, cards, icons and wording, and add items to existing Reddit controls before creating new ones. Nothing should look bolted on.

## 1. What we start from

| Area | Today | Gap |
|---|---|---|
| Query parser (`search-core.js` `parseQuery`) | Words (AND), `"phrases"`, `from:`, `has:`, `before:`, `after:`; used by chat global and room search | No `OR`, no `-word` / `-"phrase"`. Highlighting has no idea of negation. |
| Chat matching (`prepareQuery`, `message-store.searchSnapshot`) | Every needle must match (AND) | Needs a boolean evaluator. |
| Recent searches | Chat only: `rcs-unified-recent:<owner>` in `chrome.storage.local`, cleared with saved messages | No profile or subreddit scope. |
| Archive client (`post-broker.js`) | Arctic Shift `posts|comments/search` by `author` + `before` cursor, `/ids`; shared slot, cooldown, maintenance handling, 3 MB cap | No text query, no `subreddit` scope, no `after`, no aggregate, no subreddit metadata. |
| Profile UI (`post-discovery.js`) | Feed options menu with Sort and Activity groups; archive merge; badges; archive profile for unavailable accounts | No date, post type or subreddit filters. No Old sort. No search. |
| Subreddits | Nothing | Banned or private subreddits show only Reddit's notice. |

### Source facts (checked 2026-10-31)

**Arctic Shift API**
- **Text search:** `query` (title and body) on posts, and `body` on comments.
  - Operators are handled on their side: `a b`, `"a b"`, `a OR b`, `a -b`.
  - `title`, `selftext` and `body` require `author` or `subreddit`, and time out on very active users or subreddits.
- **Filters and sorting:** `after`, `before` and `sort=asc|desc` (by date), plus `over_18` and `spoiler` on posts.
- **Counts:** `/api/{posts,comments}/search/aggregate?aggregate=subreddit|created_utc` returns counts per subreddit or per time span. It can also time out on very active users.
- **Subreddit details:** `/api/subreddits/search?subreddit=` gives description, subscriber count and created date.
- **Rate limits:** dynamic. A 429 response comes with `X-RateLimit-Reset`; we already honour it.

**PullPush** (`api.pullpush.io`, Pushshift-compatible)
- From this machine's terminal, every request got HTTP 429: "This website does not provide free scraping resources for agents… paid scraping service".
- CORS is `*`, so a browser request may be treated differently, but that is unproven. Their wording also suggests they may not want automated clients, which an extension arguably is.
- **Decision:** use it only behind a gate (see §6, open decision 1).

## 2. Design

### 2.1 Query language, shared by every search bar

Keep one grammar everywhere: chat global search, chat room search, profile search and subreddit search.

```
word word        both (AND)            "exact phrase"   phrase
a OR b           either (OR binds tighter than AND; "a b OR c" = a AND (b OR c))
-word  -"phrase" exclude
from:x  before:YYYY-MM-DD  after:YYYY-MM-DD  has:link|image|...   (chat, unchanged)
u/name  author:name     (subreddit search only)
r/name  subreddit:name  (profile search only; same as the Subreddit filter)
```

- **Parser:** `parseQuery` keeps its current fields for compatibility and adds `expr`, a small tree of `and`, `or`, `not`, `term` and `phrase` nodes.
- **Evaluator:** `prepareQuery` evaluates `expr` instead of "all needles". A query with no `OR` or `-` behaves exactly as today, and existing tests guard that.
- **Highlighting:** only positive terms and phrases are highlighted; negated ones never are.
- **Invalid input:** a lone `OR`, a dangling `-`, or a query made only of exclusions gets an inline hint ("Add a word to search for"). It must never fail silently.
- **Archive serializer:** `toArchiveQuery(expr)` builds the string Arctic Shift accepts, so the server does the filtering when it can.
- **Suggestions and pills:** they must not turn `-word` or `OR` into a filter pill. These stay plain text in the field, like on Reddit.

### 2.2 Archive source layer (`post-broker.js`)

New background actions. All of them reuse the existing slot, cooldown, maintenance backoff, timeouts and bounded reads.

| Action | Input | Arctic Shift call | Returns |
|---|---|---|---|
| `archive-search` | `{kind, author?, subreddit?, query?, after?, before?, sort:'desc'|'asc', postType?, over18?}` | `posts|comments/search` + `query`/`body` | Normalized items, cursor, `hasMore`, `serverFiltered:true|false` |
| `archive-aggregate` | `{kind, author?, subreddit?, by:'subreddit'|'month', after?, before?}` | `.../search/aggregate` | `[{key,count}]`, or `{timedOut:true}` |
| `archive-subreddit` | `{name}` | `/api/subreddits/search?subreddit=` | Name, title, description, subscribers, created, over18, icon (if any) |

- **Server first, local fallback:** if a text query times out on a very active author or subreddit, retry without the text. Then page by date window and match locally with the §2.1 evaluator.
  - **Budget:** at most 10 pages × 100 items per kind for each "Search older" step.
  - The UI always shows "Searched back to <date>" and a **Search older** action. It never claims to be complete.
- **Post type:** derived in `post-model.js` from `is_self`, `is_video`, `is_gallery`/`gallery_data`, `post_hint` and `crosspost_parent`. It is filtered locally, because Arctic Shift has no type filter.
- **Caching:** per tab, in memory, keyed by request, for 10 minutes. Nothing is persisted except recent searches (§2.6).
- **PullPush adapter:** a second source with the same output shape, used only when allowed (§6). It is a fallback when Arctic Shift is down, under maintenance or returns nothing. It is never queried in parallel.
  - It needs a `host_permissions` entry for `https://api.pullpush.io/*`, which is a new permission. Chrome asks the user to re-approve a store install when permissions grow; an unpacked install just reloads.

### 2.3 Profile filters and sorts (Reddit's own Feed options menu)

Add groups to the menu we already own, in Reddit's row style, with checkmarks and Reddit icons:

- **Sort:** New / Hot / Top, as today (Reddit's), plus **Old** (oldest first). Old is backed by the archive, `sort=asc`. Its subtitle reads "From the archive" because Reddit can't reverse its own feed.
- **Date:** presets for 24 hours, week, month and year, plus **Custom…**. Custom opens our existing chat calendar (`date-picker.js`, already restyled to Reddit). Native cards outside the range are hidden with `data-rt-filter-hidden`, and archive queries get `after`/`before`.
- **Post type** (Posts and Overview tabs): multi-select in three sections. Text: Text, Text with media, Polls. Media: Images, GIFs, Videos, Galleries. Links: Links, Embedded media, Crossposts. "All types" clears the selection. Native cards and archive items share `RTFeedFilters.inferType`; unknown native values only match when no type is selected.
- **Subreddit:** a searchable, scrolling list (Back and the search field share one header row) with community icons, counts from `archive-aggregate` (live Reddit items are added to those counts), selected rows pinned first, up to 8 picks.
  - One pick also narrows the archive query on the server.
  - The footer names the real source: "Counts from the archive", "Counts from loaded items" (aggregate failed or unavailable) or "Loading counts…".
  - Icons come from `RTCommunityIcons` (page first, then Reddit's community hover card, rate limited and cached).
- **Active filters** show as Reddit-style chips under the menu button. Each has a working ×, and there's one "Clear filters".
- **State:** filters are kept per profile and tab in the URL search params (`rt_date`, `rt_type`, `rt_sub`). Back/forward and reload then restore them, and Reddit's own params are left alone.
- **Most Commented:** a loaded-items-only sort, labelled as such, low priority. It is the last item in this workstream and can be dropped.

### 2.4 Profile history search

Reddit's header search already has a "Search in u/name" scope.

- **Default plan:** augment Reddit's own scoped results page. Merge archive matches (deleted, removed, or hidden from the profile) into Reddit's results list, using our existing native-card rendering and badges. Add the §2.3 filters to that page's own filter row.
- **Fallback:** if phase-0 recon shows that page can't be augmented reliably, add a search field at the top of the profile feed instead. It filters the feed in place, in the same visual style as Reddit's search field.
- **Either way:**
  - Operators work (§2.1).
  - Results show "Searched back to <date> · Search older".
  - The Activity filter (All / Hidden / Deleted) combines with the search.

### 2.5 Subreddit archive

Only for subreddits Reddit won't show: banned, private, quarantined behind a gate the user hasn't passed, or not found. Live subreddits are left alone.

- **Notice handling:** `profile-notice.js` holds Reddit's notice early, the same way it does for unavailable profiles. A "Browse archived posts" action on that notice, worded in Reddit's style, opens the archive view. The notice text stays visible above it, so the reason is never hidden.
- **Header:** built like Reddit's subreddit header from `archive-subreddit`: icon or community glyph, r/name, title, members, created date, and a line such as "This community was banned. Showing archived posts."
- **Feed:** archived posts in our existing native-looking cards (`archive-view.js`), with Posts and Comments tabs. Sort is New / Old / Top (loaded items). Date and Post type filters share the module from §2.3.
- **Search:** "Search r/name" with operators and `u/name` to restrict by author. Arctic Shift needs `subreddit` for text search; large subreddits use the timeout fallback from §2.2.
- **Not included:** NSFW and quarantined content keeps Reddit's gating rules. If Reddit would gate it, our view gates it too.

### 2.6 Recent searches (kept small)

- **One store module:** `recent-searches.js`, using the existing key prefix pattern, per signed-in account.
- **Scopes:** `chat` (existing) plus `profile:<name>` and `subreddit:<name>`.
- **Limits:** at most 8 entries per scope and 40 per account in total; the oldest scopes are evicted.
- **Saved only on submit** (Enter or a result opened), never per keystroke. Shown only in the empty, focused search field, as Reddit does.
- **Controls:** each entry has a ×, and there's "Clear recent". The existing "Clear saved messages" also clears all scopes. No sync, no export.

## 3. Workstreams and parallel waves

The main agent (me) writes the interface contracts first, owns `manifest.json`, `CHANGELOG.md` and the merges, reviews every diff, and runs the full suite. Each implementation agent works in its own git worktree, so edits never collide.

| WS | What | Agent | Owns files (writes) | Needs |
|---|---|---|---|---|
| 0 | **Live recon**, read-only: Reddit's "Search in u/name" flow (URL, DOM, filter row); banned, private and quarantined subreddit pages (DOM, images, wording); whether PullPush answers from an extension page (status, headers, data freshness); Arctic Shift `body`/`query` and aggregate timings on a small, a medium and a very active user | Haiku 5.5 | `artifacts/research/recon-0.24/*` only (ignored) | Nothing |
| 1 | **Query language:** parser, evaluator, highlighting, `toArchiveQuery`; chat global and room integration (suggestions and pills ignore operators); hint for invalid input | Sonnet 5.5 | `search-core.js`, `message-store.js`, `global-search-model.js`, small edits in `unified-search.js` and `content.js`, tests | Nothing |
| 2 | **Archive source layer:** `archive-search`, `archive-aggregate`, `archive-subreddit`, timeout fallback, post type in the model, per-tab cache; PullPush adapter behind a flag (stubbed until §6 is decided) | Sonnet 5.5 | `post-broker.js`, `post-model.js`, tests | The contract from §2.2 |
| 3 | **Profile filters and sorts:** shared `feed-filters.js` (state, predicate, URL sync, menu-row builders, chips) and its use in `post-discovery.js` | Sonnet 5.5 | `feed-filters.js` (new), `post-discovery.js`, `post-discovery.css`, tests | WS2 contract (mocked until merged) |
| 4 | **Recent-search store:** the module, migration of chat recents into it, clearing | Haiku 5.5 | `recent-searches.js` (new), `cache-broker.js`, tests | Nothing |
| 5 | **Profile history search** (Reddit page augmentation or in-feed field, per WS0) | Sonnet 5.5 | `profile-search.js` (new), `post-page-bridge.js` (only if a native hook is needed), CSS, tests | WS0, WS1, WS2, WS3 module, WS4 |
| 6 | **Subreddit archive:** notice hold, header, feed, tabs, search | Sonnet 5.5 | `subreddit-archive.js` (new), `profile-notice.js`, `archive-view.js` (additions only), CSS, tests | WS0, WS1, WS2, WS3 module |
| 7 | **Live verification** of each merged workstream with `scripts/live/cdp.mjs`, in Chrome, at full, floating and phone widths, light and dark | Haiku 5.5 | `artifacts/research/verify-0.24/*` only | Merged builds |

**Waves:**
1. **Wave 1 (parallel):** WS0, WS1, WS2, WS4, and WS3 against mocked WS2 actions.
2. **Wave 2 (parallel, after WS0 reports and WS2/WS3 merge):** WS5 and WS6.
3. **Wave 3:**
   - Integration: I own the manifest entries for the new files and wire up settings.
   - Review: I read every diff. I'll use `/code-review` only if you ask for it.
   - Full suite, then WS7 live checks, then the release as MINOR 0.24.0. It's a new user-facing feature with no storage schema change beyond the recent-search store, which reads the old key.

Each implementation agent's prompt includes the AGENTS.md rules that apply to it: synthetic fixtures only, account-scoped data, no "complete" labels on partial loads, small conventional commits with tests in its worktree, and no edits to files outside its ownership row.

## 4. Acceptance checks per workstream

- **WS1**
  - All existing search tests pass unchanged.
  - New tests cover precedence (`a b OR c`), `-word`, `-"phrase"`, exclusion-only queries (hint), CJK and emoji with `OR`, and highlighting that never marks excluded words.
  - Pills and suggestions are unaffected.
- **WS2**
  - Each action is tested with synthetic responses for success, 429 with reset, 503 maintenance, timeout, and the timeout-then-local-fallback path.
  - The budget is enforced, and responses never report complete when `hasMore` is true.
- **WS3**
  - Every filter combination hides and shows the right native and archive cards.
  - URL round-trips work, chips' × buttons work, and the menu keeps Reddit's look in light and dark.
  - The subreddit counts fallback label shows when needed.
- **WS4**
  - Limits hold (8 per scope, 40 total), entries stay per account, clearing works, and old chat recents migrate.
- **WS5**
  - Archive matches appear alongside Reddit's own results with badges and without duplicates.
  - "Searched back to…" and "Search older" work.
  - Operators work, and filters combine with the search.
- **WS6**
  - A banned, a private and a not-found subreddit each show Reddit's notice plus the archive view. A live subreddit is untouched.
  - Search with `u/name` works.
  - Gated content stays gated.
- **WS7**
  - Screenshots and timings for each check, with no visible flicker (the same standard as the Comments-tab sort fix).
  - Console is clean, and no Reddit control behaves differently.

## 5. Risks and how the plan handles them

- **Arctic Shift full-text times out on very active users or subreddits.** Fall back to date windows and local matching, with a visible "Searched back to" line and a bounded "Search older".
- **Reddit changes its search or subreddit-notice DOM.** WS0 records the current markup as synthetic fixtures. Every hook fails closed: Reddit's own UI stays as it is.
- **Load on the archive.** Text search runs on submit, never per keystroke. Aggregates are cached per tab, and the existing single slot and cooldown are shared by all features.
- **Privacy.** Search terms and names go to Arctic Shift (and PullPush, if enabled). The existing "Search Arctic Shift archive" setting already covers Arctic Shift. PullPush would need its own off-by-default setting, with that stated in its label.
- **Permission growth from PullPush.** Avoided unless decision 1 says yes.

## 6. Decisions (agreed 2026-10-31)

1. **PullPush:** not in 0.24.0. WS2 keeps a disabled adapter stub. Revisit after WS0 reports whether browser requests work.
2. **Profile search:** augment Reddit's own "Search in u/name" results page. Fall back to an in-feed field only if WS0 shows the page can't be augmented reliably.
3. **Most Commented:** loaded items only, built last in WS3, and dropped if it doesn't fit.
