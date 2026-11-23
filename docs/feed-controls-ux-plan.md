# Feed controls and media first-load: plan (2026-11-23)

User report: the feed menu's name is vague; Reddit's separate View switch should live inside our menu on Home and communities; the control vanishes while a post or community opens; applied-filter pills clutter the row and can't be reached once you scroll down; Home lacks the community filter other feeds have; the profile's phone menu shows only one applied filter; there's no switch to turn our replacement controls off; "Not yet approved" works only for communities you moderate; previews sometimes ignore the policy on first load until one video is played by hand; with Direct embed controls granted, the overlay should give way to the player's own controls.

Measured before (signed-in Playwright launcher, Chrome Dev 160; profile signed out, so Home served Reddit's signed-out feed):

| Where | Before |
|---|---|
| Home, signed out (desktop) | Our control never mounted: Home's feed comes from `/svc/shreddit/feeds/popular-feed`, which the scope check read as a mismatch. Its boot rule kept Reddit's own **Best** sort hidden (0 × 0), so Home had no sort control at all. |
| r/pics → open a post (desktop) | At 67 ms the URL changed and our control was removed while the old feed stayed on screen; Reddit's native Best sort reappeared in its place for the rest of the transition. |
| r/pics, desktop and phone | Our "Feed options" button, then Reddit's own View (Card/Compact) dropdown as a second control. |
| Previews, first load | Not reproduced on four cold loads (native hover, native phone in-view, YouTube hover). The code has stuck states that match the report (below). |

## To-do

| # | Item | Status |
|---|---|---|
| 1 | Rename "Feed options" to **Sort & filter** in everything we render (button, menu/sheet titles, ARIA, docs) | |
| 2 | Home, Popular, All, communities and custom feeds: Reddit's View switch moves into Sort & filter as a **View** row; the native dropdown is hidden while ours is shown | |
| 3 | Keep Sort & filter (and the hidden native sort) in place while the outgoing feed is still on screen after a click to a post or community | |
| 4 | Fix Home when Reddit serves the signed-out popular feed there; never leave Reddit's sort hidden when we don't take over | |
| 5 | Applied filters, new design: a count badge on the button, one **summary chip** on computers (no pill rail), the full list with remove buttons in a popover or sheet | |
| 6 | Sort & filter **docked under the header** once the row has scrolled away and you scroll up, on computers and phones | |
| 7 | Home, Popular and All: **Community** row (show only, or hide, chosen communities) | |
| 8 | Profile: the same count badge, summary chip and phone Applied row list every filter | |
| 9 | Popup switch **Sort & filter on feeds** (on by default): off keeps Reddit's own sort and view controls on Home, Popular, All, communities and custom feeds | |
| 10 | **Awaiting approval** as a Post type in any community: the mod queue for moderators; for everyone else, recent posts from Arctic Shift checked against Reddit's current state | |
| 11 | Media first load: no stuck hover or in-view state; previews start for a pointer already resting on a video, when settings arrive late, and when a background tab becomes visible | |
| 12 | Direct embed controls granted: no overlay on direct frames; the player's own buttons, sliders and seek bar work during a preview without opening the post | |

## 1. Name

**Sort & filter.** It says what the menu does (sort, then narrow down). It's the same length as "Feed options", so the phone row doesn't change, and View sits under it as a third row. On profiles Reddit's own button is relabelled in place. The extension marks it `data-rt-feed-trigger` so our code no longer depends on Reddit's `aria-label="Feed options"`.

## 2. View inside the menu

- Rows: Sort · View · Post type · Community (Home, Popular, All) or Flair (communities) · NSFW where offered.
- The View row lists Reddit's own choices, read from its `shreddit-sort-dropdown[sort-event="layout-view-change"]`. Choosing one activates Reddit's own item, so Reddit stores the layout as before. The native dropdown is hidden only while our control is mounted, with the same attribute pair used for the replaced sort (`data-rt-community-sort-replaced`).
- Phones: the same rows in the bottom sheet.
- The profile already has Reddit's View group inside its menu; the banned-community archive keeps its own view button, which belongs to our page.

## 3–4. Transitions

| | Transition | Expected |
|---|---|---|
| F1 | Click a post title or card | Sort & filter stays in place, with Reddit's sort still hidden, until Reddit removes or hides the outgoing feed; it goes in the same frame as the feed |
| F2 | Click a community link in the feed | As F1; the new community mounts its own control with its feed |
| F3 | Back to the feed | Control returns with the feed, as today (no flash of Reddit's sort) |
| F4 | Home signed out (`popular-feed` behind `/`) | Mounts like Home; if we give up for any reason, the boot rule is lifted in the same pass so Reddit's sort shows |
| F5 | Sort & filter switch off | Reddit's own sort and View show at once in open tabs; ours are removed |

## 5–6. Applied filters

- **Button:** a count badge on the filter icon's corner (no layout width) whenever one or more filters apply. Sort and View don't count.
- **Computers:** one summary chip in the row's free space, after every control: "Videos · r/pics · +1". It's truncated with an ellipsis to the room available and shows "N filters" if even that doesn't fit. Its × clears all. Clicking it opens the Applied filters list (each filter with its icon and a remove button, then Clear all). With no room at all, only the badge shows.
- **Phones:** badge only in the row. The sheet's first row is **Applied filters · N filters**, opening the removable list.
- **Docked control:** when the row is above the viewport and you scroll up at least 24 px, a compact Sort & filter pill (with the badge) slides in under Reddit's header, aligned with the feed column. On phones it moves with the header reveal. Scrolling down hides it; it never covers the row itself. Activating it opens the same menu (popover under the pill on computers, the sheet on phones).
- Covered surfaces: Home, Popular, All, communities, custom feeds, profiles, banned/private community archive. The chat panel keeps its own rows (`docs/filter-pills-spec.md`, Chat search).

| | Transition | Expected |
|---|---|---|
| A1 | Apply a filter | Badge appears; computers add the summary chip in free space; nothing moves |
| A2 | Remove from the list | List and summary refit; the last removal hides chip and badge |
| A3 | Scroll down past the row, then up | Docked pill slides in under the header; down again hides it |
| A4 | Open from the docked pill | Same menu, same state; changes apply to the feed in place |
| A5 | Row back in view | Docked pill hides |

## 7. Community filter on Home, Popular and All

- **Community** row → a page listing the communities seen in this feed (most frequent first, with icons) plus a search box for any name. Each row has three states: off, **Show only**, **Hide**.
- Address: `rt_sub=a,b` (show only) and `rt_hide=c,d` (hide), carried like `rt_type`. Filtering hides cards client-side as Post type does. The existing pager keeps loading when few cards match.
- Limit: a show-only filter on Home can need many pages; the existing "Looking further" note covers it.

## 9. Switch

Browsing & Feed: **Sort & filter on feeds**, "Replaces Reddit's sort and view menus on Home, Popular, All, communities and custom feeds with one menu that also filters by post type, flair and community. Off keeps Reddit's own." Stored as `feedControls`, default true. Until now the controller followed `postDiscovery`, a profile setting.

## 10. Awaiting approval for any community

- **Moderators:** unchanged (`/r/<sub>/about/unmoderated.json`, exact).
- **Everyone else:** the newest posts in the community from Arctic Shift (`/api/posts/search?subreddit=<sub>&limit=100&sort=desc`, up to three pages, last 7 days). Then Reddit's current state for those IDs, from the page world with the user's session (`/api/info.json?id=t3_…`, 100 per request). A post counts as awaiting approval when Reddit's `removed_by_category` is `automod_filtered` or `reddit` (held by AutoModerator or Reddit's filters and not yet approved). Approved posts have no category; moderator removals read `moderator` and are excluded.
- Shown as **Post type → Awaiting approval** in any community, with a one-line source note: "Held for review and not yet approved (from Arctic Shift, last 7 days)" or "From your mod queue". It needs **Use the archive** for non-moderators; without it the row is dimmed with "Needs Use the archive", and activating it jumps to that switch.
- Limits: Arctic Shift can miss posts it hasn't ingested yet (minutes) and posts removed before ingestion. Reddit's spam filter (`reddit`) also catches posts no moderator will ever review. The list says "Held for review", never "complete".

## 11. Media first load

Stuck states found in `video-control.js`:
- `hover` sets `hovered` before the 160 ms timer. If `startPreview` then bails (no `<video>` yet, tab hidden, another video playing), `hovered` stays set, and later `pointerover` events inside the same player return early (`current===player`). Nothing starts until the pointer leaves, or a manual play resets it.
- `pickInView` returns early when the best candidate equals `hovered`, so a failed in-view start on phones blocks every later pick for that player.
- A pointer resting on a player when settings arrive (or when the player hydrates) gets no new `pointerover`.
- A preview whose `<video>` never reaches metadata stays "active" forever.

Fixes: `startPreview` reports failure and clears `hovered`/`viewing`. A transient failure retries on `loadedmetadata`, on attach, on tab visible and on settings. The last pointer position is kept (`pointermove`), and after configure, attach, scroll end and tab visible the player under it (`elementsFromPoint`) gets the hover timer. Previews that don't play within 2.5 s are dropped and may be retried. The same applies to embed previews (`ePreview`).

| | Transition | Expected |
|---|---|---|
| V1 | Cold load, pointer already on a feed video, Preview mode | Preview starts within 160 ms of settings and the player being ready, no movement needed |
| V2 | Preview attempt fails (video not ready) | Retries when it is ready; later hovers work |
| V3 | Phone, tab opened in background then shown | In-view preview starts 600 ms after it becomes visible |
| V4 | Play one video by hand, then hover others | Unchanged |

## 12. Direct embed controls granted

Already in place for direct frames (`docs/video-control-spec.md`, M1–M8). The page answers each supported frame's hello with `pause` instead of parking it behind a still or cover. Previews add no click layer; the frame script turns clicks on the video surface into `tap` and clicks on the player's own controls into `take`. Reddit's own player never had an overlay; its controls stay native (strict click-target isolation).

Remaining gaps:
- Done in 0.62.0: every embed provider (YouTube included) is a direct host under the same Grant access, checked host by host so existing grants keep working (`docs/video-control-spec.md`, Direct embed controls for every provider).
- Done: the grant is re-read on `settings-changed` and when the tab shows again.

## Verification

- Unit (jsdom):
  - Rename strings.
  - View row reads and activates native items.
  - Hold during route change (F1–F3) and the popular-feed Home fix (F4).
  - Summary chip and badge.
  - Docked pill show and hide.
  - Community filter matching and address.
  - Switch on and off.
  - Awaiting-approval source selection and state classification.
  - Media stuck-state cases (V1–V3) with fake players.
- Live (signed-in Playwright launcher, read-only):
  - F1/F2 frame logs.
  - Home signed out and signed in.
  - The row on desktop and phone.
  - Docked pill on scroll.
  - V1 with the pointer resting before settings load.
- Not verifiable here:
  - Anything needing Direct embed controls (a browser permission the user grants).
  - Moderator queue (needs a moderator account).
  - Signed-in Home until the profile is signed in again.
