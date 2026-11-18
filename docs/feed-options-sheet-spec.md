# Profile Feed options on phones: one flat sheet (2026-11-18)

User request (with a screenshot of Reddit's Android app): on phones the profile Feed options is a desktop menu restyled as a bottom sheet, with nested submenus (Sort ›, View ›, Activity ›, Date ›, Post type ›, Subreddit ›). Use the app's structure instead: a "Feed options" sheet with a title and a round close button, the sort options listed directly (check on the current one, a chevron and subtitle where there is a second choice), dividers between sections, and a Filter section of chips.

## Measured (live, read-only, phone view 390×844)

- The Feed options button opens `rpl-dropdown`; its `[slot=content]` holds `rpl-menu.main-menu-container` (title "Feed options" + group rows) and the extension's `rpl-menu.rt-activity-submenu[data-rt-sub-key]` submenus (sort, view, activity, date, type, sub) plus Reddit's own Top time submenu.
- `rpl-menu` lays out its items inside its shadow DOM (`rpl-scrollbox` with slots), so its rows cannot be turned into wrapping chips from outside.
- Reddit's sort items are `rpl-menu-item[href]` links (`…/submitted/?sort=new`); the current one carries a checkmark icon. The extension's options mark selection with `aria-checked` (Date, Post type, Old) or `aria-current` (Activity).

## Behaviour

- Below 768 px on a profile feed (not search, which has its own sheets), pressing Feed options opens the extension's sheet instead of Reddit's popup. Desktop keeps the current menu unchanged.
- The sheet is built each time it opens from the live menu: every choice acts by clicking the existing option (or following Reddit's own sort link), so selection logic, URLs and filters stay in one place.
- Sections: **Sort** rows (Hot, New, Top with the current time range as subtitle and a chevron into Reddit's time list, Old "From the archive" when the archive is on); **View** chips (Card, Compact); **Filter**: Activity chips (All activity, Hidden, Deleted), Date chips (Any time, presets, Custom…), Post type chips (multi-select, grouped Text / Media / Links), a **Community** row (current value, chevron) that opens the existing community picker inside the sheet, and **Refresh activity**.
- Single choices (sort, view, activity, date) close the sheet after acting; Post type and Community stay open and update in place.
- Close: the × button, the backdrop, Escape, or a route change. Focus moves to the close button on open and back to Feed options on close. `role=dialog`, `aria-modal`, labelled by the title; chips are `aria-pressed` toggle buttons.

## Transitions

| | Transition | Expected |
|---|---|---|
| T1 | Phone: press Feed options | Sheet slides up over a dimmed backdrop; Reddit's popup stays closed |
| T2 | Pick New / Hot | Reddit's own navigation to that sort; sheet closed |
| T3 | Top › then a range | Time list inside the sheet with Back; picking navigates |
| T4 | Toggle Post type chips | Feed filters update; chips update; sheet stays |
| T5 | Community › | Community picker inside the sheet with Back; picks apply in place |
| T6 | Resize to desktop / route change while open | Sheet closes; desktop uses Reddit's menu |
| T7 | Menu not built yet (slow load) | Reddit's own popup opens as before |

## Limits

The sheet mirrors the options the desktop menu offers; options that only exist on Reddit's side (for example a future Reddit sort) appear only if they are in Reddit's sort group. Motion is reduced when the user prefers reduced motion.
