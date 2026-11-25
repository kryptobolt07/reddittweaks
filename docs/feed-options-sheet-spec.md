# Feed options on phones

Profiles and subreddit feeds use a short first page with the current value of each option. Each row opens a page inside the same sheet. The title, close button and Back stay in the same header.

## Measured (live, read-only, phone view 390×844)

- The Feed options button opens `rpl-dropdown`; its `[slot=content]` holds `rpl-menu.main-menu-container` (title "Feed options" + group rows) and the extension's `rpl-menu.rt-activity-submenu[data-rt-sub-key]` submenus (sort, view, activity, date, type, sub) plus Reddit's own Top time submenu.
- `rpl-menu` lays out its items inside its shadow DOM (`rpl-scrollbox` with slots), so its rows cannot be turned into wrapping chips from outside.
- Reddit's sort items are `rpl-menu-item[href]` links (`…/submitted/?sort=new`); the current one carries a checkmark icon. The extension's options mark selection with `aria-checked` (Date, Post type, Old) or `aria-current` (Activity).

## Behaviour

- Below 768 px on a profile feed (not search, which has its own sheets), pressing Feed options opens the extension's sheet instead of Reddit's popup. Desktop keeps the current menu unchanged.
- The sheet is built each time it opens from the live menu: every choice acts by clicking the existing option (or following Reddit's own sort link), so selection logic, URLs and filters stay in one place.
- Profiles show **Sort**, **View** when Reddit offers the layout control, **Activity**, **Date**, **Post type** when applicable, **Community**, and **Refresh activity**. Single choices are checked rows. When Top is selected, its row opens the native time choices. The Custom date choice still opens the existing calendar.
- Both feeds share Post type rows, with **All types** at the top followed by the Text, Media and Links groups. A check and `aria-pressed` reflect each selection. Returning to the first page shows the updated value.
- Single choices (sort, view, activity, date) close the sheet after acting; Post type and Community stay open and update in place.
- Close: the × button, the backdrop, Escape, or a route change. Focus moves to the close button on open and back to Feed options on close. The focus ring is visible for keyboard use.

## Transitions

| | Transition | Expected |
|---|---|---|
| T1 | Phone: press Feed options | Sheet slides up over a dimmed backdrop; Reddit's popup stays closed |
| T2 | Pick New / Hot | Reddit's own navigation to that sort; sheet closed |
| T3 | Top › then a range | Time list inside the sheet with Back; picking navigates |
| T4 | Toggle Post type rows | Feed filters and pressed states update, with the sheet and current scroll position kept |
| T5 | Community › | Community picker inside the sheet with Back; picks apply in place |
| T6 | Resize to desktop / route change while open | Sheet closes; desktop uses Reddit's menu |
| T7 | Menu not built yet (slow load) | Reddit's own popup opens as before |

## Limits

The sheet mirrors the options the desktop menu offers; options that only exist on Reddit's side (for example a future Reddit sort) appear only if they are in Reddit's sort group. Motion is reduced when the user prefers reduced motion.

## Subreddit feeds on phones: short sheet with submenus (2026-11-19)

User report: the subreddit sheet was one long page, with a heavy New icon. The first page now has one row per option with its current value and a chevron. **Sort by** shows the current sort and, for Top, its range (`Top · This Week`). **Post type** shows the chosen types, using that type's icon when only one is chosen. **Flair** shows the current flair. Each row opens its own page with Back. In Sort by, Top opens one level further to its time ranges before applying the sort.

Icons are Reddit's own, captured from the server HTML of `/user/reddit/submitted/?sort=hot|top` (`svg[icon-name]`). Reddit's subreddit sort menu has none of its own. As in Reddit's profile menu, the selected sort uses the filled variant (`hot-fill`, `new-fill`, `top-fill`; Best has no captured fill). A CSS rule stroked Reddit's New outline a second time, which drew a blob; it is gone. "All types" no longer carries an eye icon.

Chrome CDP at 390 px captured profile sort and layout items with Reddit's Hot, New, Card and Compact icons and their checkmarks. The page's native bottom-sheet hosts were closed in that capture. The subreddit View button remains Reddit's existing control.

A Chrome CDP touch fixture measured the sheet at 390 px wide, flush with the viewport bottom, with a 69 px header and a 54 px row with subtitle. The text was 16 px and 14 px. Touch opening showed no ring around Close, the 220 ms slide settled flush with the viewport, and reduced motion removed the transition. Closing restored focus to the trigger.

## Filter changes keep the feed's start in place (2026-11-25)

User report: after scrolling a filtered profile and removing the filter, the page sat deep inside the unfiltered feed; with a sparse filter the page kept moving up and down until results arrived (both worse on phones).

- Measured (phone, 412 px, u/GallowBoob): clearing *Videos* with the Sort & filter button at 441 px moved the page 466 px down (the first filtered card was kept in place while the cards above it came back). With *Polls*, the page height swung 915 ↔ 1022 px about once a second: Reddit removes and re-adds its 192 px page loader for every page it fetches, and the extension's hidden loader kept its space beside it.
- Now every in-place filter change (profiles and community feeds) keeps the list's start where the reader sees it: the Sort & filter button stays at the same height, and a reader who had scrolled past it goes back to it (`RTFeedFilters.keepFeedStart`). This replaces T4's "current scroll position kept".
- While Reddit's loader shows, the extension's own loader gives up its space, so the two swap in the same frame.
- After: clearing kept the button at 441 px; the loader swap changed no container height.
