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

- The chat search filter rail is a separate component inside the chat panel (`unified-search`) and is not part of this change.
- The phone row usually has room only for the count badge, so filters are seen and removed through Feed options → Applied filters.
