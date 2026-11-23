# Applied filter pills (2026-11-23)

User report: on phones the applied-filter pills overflowed their row, and on computers they pushed other controls aside (a subreddit's view switch moved right, profile pills were cut off with Clear filters out of reach). Pills should still show what is applied and be easy to remove, while moving as little as possible.

## Measured before (live, signed-in Chrome Dev, 1440×900 and 412×915 Android)

| Surface | Before |
|---|---|
| Profile, computer | 6 pills in a 581 px scroll strip after Feed options; the last pill was clipped and Clear filters was off the end |
| Live subreddit, computer | Pills inserted between Feed options and the view switch: the view switch moved right by the pills' width |
| Live subreddit, phone | Same insertion inside Reddit's right-aligned group: the view switch went off screen |
| Banned subreddit | Pills on their own wrapping row under the dropdowns, pushing the feed down |
| Profile, phone | 261 px scroll strip, clipped without a cue |

## Behaviour

- **Placement:** the pills form one rail, a flex item with basis 0, in the free space of the row that already holds the controls, never between or before a control. Feed options, the view switch, tabs and dropdowns keep their positions, and the row never grows or wraps.
  - Profile: last item of Reddit's Feed options row.
  - Live subreddit, computer: after Reddit's control group, which starts the row.
  - Live subreddit, phone: between the Feed / About tabs and Reddit's right-aligned control group.
  - Banned or private subreddit, computer: between the dropdowns and the right-aligned view switch.
  - Banned or private subreddit, phone: between the tabs and Feed options.
- **Fit (priority+):** pills that fit are shown in order. When they do not all fit, the rest hide behind a **+N** chip, and Clear filters moves into its list. When not even one pill fits, the chip reads "N filters".
- **No room at all:** the rail stays empty and Feed options shows the count as a badge on the corner of its filter icon. The badge takes no layout width.
- **+N list:**
  - On computers, a popover anchored under the chip titled Applied filters. It has Clear all and one row per filter with its icon and a remove button. Escape, an outside click or scrolling closes it.
  - On phones, the same rows in the bottom sheet.
- **Phone Feed options sheets** (profile, live subreddit, banned subreddit) start with **Applied filters · N filters**. It opens a page with each filter removable and Clear all filters.
- **Refit triggers:** filter changes, resizes (ResizeObserver on the rail) and the phone/computer breakpoint.

## Transitions

| | Transition | Expected |
|---|---|---|
| P1 | Apply a filter | Its pill appears in the rail's free space; no control moves and the row height is unchanged |
| P2 | More filters than fit | The last ones hide behind +N; +N lists all of them, and each row removes that filter |
| P3 | Remove a pill (× or the list) | The rail refits; a hidden pill comes back if room frees up |
| P4 | Narrow the window or rotate the phone | The rail refits; with no room, the count moves to Feed options |
| P5 | Clear all | The rail empties and hides; the badge goes away |

## Measured after (live)

- Computer: profile shows 5 pills and +1. Live subreddit: Feed options and the view switch stay at x = 313 / 455 with the pills after them. Banned subreddit: dropdowns, pills and Clear filters, with Card still right-aligned.
- Phone: profile shows 2 pills and +4 beside Feed options. Live and banned subreddits keep a single 40 px row with the count badge on Feed options (35 px of free space).

## Limits

- The phone row usually has room only for the count badge, so filters are seen and removed through Feed options → Applied filters.

## Chat search (applied-filter rows in the chat panel)

Surfaces: the chat list's `.global-filter-rail` (`unified-search.js`) and the in-room message search's `.room-applied-filters` (`content.js` rows, `unified-search.js` `decorateMessageControl`). Shared code: `extension/chat-filter-rail.js` (`RCSFilterRail.fit`), loaded before `unified-search.js` in the chat content script. It is separate from `RTFeedFilters.fitRail` because the chat's pills are shadow-DOM `.sender-chip` / `.filter-chip` / `.date-chip` nodes, not Reddit's `rpl-input-chip`, and the popover must live in the chat's shadow root.

### Measured before (fixture browser, 1280×800, demo chat; list host 279 px wide, 263 px content)

| State | Chat list | Room search (room pane 378 px) |
|---|---|---|
| No filter | Search row 52 px, scope tabs 31 px; rail hidden (host 88.2 px tall) | Bar 49 px; rail hidden |
| 5 filters | New 32 px row; rail `scrollWidth` 695 for `clientWidth` 263, sideways scroll with the scrollbar hidden; the add-sender button at x = 748, 485 px off the right edge | New 38 px row; `scrollWidth` 770 for 378; chips ran off the edge |
| Free space | Scope tabs are a 3 × 85 px grid with 4 px gaps that fills all 263 px: 0 px free. The search field's input is the flexible item | The field is the flexible item beside the back button: 0 px free |

### Decision: keep a row of its own

The rail does not sit in an existing row. Neither the list's scope tabs nor the search field (list or room) has free width, and putting pills in the search row would shrink the input and move the back button, filter and date buttons, which this change must not do. The row already existed (hidden until a filter is applied) and is fixed at 32 px (38 px in the room, padding included), so it appears once on the first filter and then never changes height, whatever the pill count. Everything above it stays put.

### Behaviour

- **Fit:** the rail is clipped (`overflow:hidden`), never wraps and never scrolls. `RCSFilterRail.fit` runs after every render of the list or room filters and when the rail's own width changes (ResizeObserver). Pills that fit show in order; the rest get `data-rcs-fit-hidden` (display none) and a **+N** chip is added. When not even one pill fits, the chip reads "N filters". The chip shrinks with an ellipsis, so the rail always fits.
- **Controls:** the add-sender button is not a pill and is never hidden by fitting. In the list the +N chip sits just before it; in the room it follows the last pill, because the add button sits among the pills there.
- **+N list, computers and any window wider than a phone:** a popover under the chip, inside the chat's shadow root (so it follows the floating chat's position and the chat's theme). It has Applied filters, Clear all, and one row per filter (icon, label, remove). Escape, a press outside, a second click on the chip, or a removal closes it.
- **+N list, full-screen chat on a phone** (`max-width: 767.98px`): the same rows in `RTFeedSheet` (Applied filters, each row with a remove button, Clear all filters). If the sheet module is missing, the popover is used.
- **Removal** runs the pill's own remove handler (list rows click the hidden pill's remove button), so state, query text and results update exactly as for a visible pill.
- **Minimized chat** has no filter rows. The rails are only built in the list and room panels.

### Transitions

| | Transition | Expected |
|---|---|---|
| C1 | Apply the first filter | The rail row appears once (+32 px list, +38 px room); the search row, tabs and back button keep their positions |
| C2 | More filters than fit | The last ones hide behind +N; the rail stays one clipped line; add-sender stays visible |
| C3 | Remove a pill, or a row in the list | The rail refits; hidden pills come back as room frees up; with none left the rail hides and its row goes away |
| C4 | Resize the chat (floating ↔ full, window width) | The rail refits through its ResizeObserver, with no render needed |
| C5 | Clear all | Every filter is removed through its own handler; the list closes |

### Measured after (fixture browser)

- List, 5 filters in 263 px: 1 pill (x 85.8–166.6), +4 (x 172.6, 37.7 wide), add-sender (x 216.3); `scrollWidth` = `clientWidth` = 263. The search field (85.8, 155, 263×40), the input and the scope tabs (85.8, 206) are identical with 0, 1 and 5 filters. The first filter adds the 32 px row once (host 88.2 → 120.2); 1 and 5 filters have the same height.
- Room, 378 px pane, 5 filters: 2 pills, +3 (x 629.6), `scrollWidth` = `clientWidth` = 378; back button (365.8, 109.5, 28×32), field (399.8, 107, 328×37) and input unchanged with 0, 1 and 5 filters. The first filter adds the 38 px row once (host 49 → 87). At 844 px (full chat) all five pills fit and there is no chip.
- List popover: 260 px wide at x 85.8, 4 px under the rail; 5 rows. Room popover: 260 px wide, under the +N chip. Escape, an outside press and Clear all close it; removing the last row left 4 filters and `+2`; Clear all emptied the rail and hid the row (host back to 49 px).
- Phone sheet (412 px emulation, `RTFeedSheet`): title Applied filters, 5 remove rows and Clear all filters; removing a row refits to `+3`.
- Light and dark: both read from the chat's own `--rcs-*` tokens; checked in the room popover in dark.

### Limits

- The demo's list column is a fixed 279 px, so the full-screen phone width (about 380 px) was exercised through the phone-width sheet path and the unit tests, not a 380 px list rail. The floating chat itself does not mount in the demo, so floating is covered by its measured geometry (list 280 px, room pane about 378 px) rather than a floating render.
- The search row's clear button (appears once text is typed) is existing behaviour and is not part of the rail.
