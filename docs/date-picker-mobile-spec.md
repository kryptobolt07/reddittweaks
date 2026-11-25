# Date picker on phones (2026-11-24)

User request: the computer calendar is fine, but on phones it should become a pull-up sheet like the others, designed the way iOS and Android do it and easy to use with a thumb, without losing any feature.

## Design

The design follows the patterns phone users already know:
- **Android:** Material 3's modal date-range picker, with months scrolling vertically under a fixed weekday row and the selected range as a band.
- **iOS:** the range sheets common in iOS apps (bottom sheet, drag handle, a sticky Apply).

| Part | Phone sheet | Why |
|---|---|---|
| Container | Bottom sheet over a dimmed backdrop, up to 640 px or 88% of the screen, 16 px top corners, drag handle, title "Date", round Close | The same pull-up as our other sheets. The thumb reaches it, and the page stays visible above it |
| Condition | On · Before · After · Between, as a full-width underline tab bar matching the desktop picker | Familiar and uncluttered, without losing any mode |
| Quick ranges | Today, Yesterday, 7 days, 30 days, This month, Last month, This year (feeds and profiles; chat keeps its four), as borderless soft chips that scroll horizontally with edge fade | Clean one-tap presets matching desktop |
| Month & year buttons | Each sticky month header centers two separate buttons (`[ Month ▾ ]` and `[ Year ▾ ]`, soft fill, subtle border, downward caret) right above its days, with a `Today` jump button on the right for older months | Unmistakably clickable and directly mirrors desktop without repeating month/year twice |
| Calendar | One fixed weekday row, then months stacked in a vertical scroll ending at the current month. Older months load as you scroll up (back to the earliest available month, or June 2005). Each month's header sticks while its days are on screen | Scrolling replaces the small arrows, as Android's range picker does. A history filter mostly looks back, so the list ends at today |
| Jump choosers | Tapping `[ Month ▾ ]` opens the month grid directly; tapping `[ Year ▾ ]` opens the year grid, then the month grid. Both views share `Year` / `Month` underline tabs, rounded-square tiles, disabled future months, and Back | Years or months back in one or two taps, with clear button affordances |
| Days | 44 px touch targets with rounded-square selectors (`8 px` radius) matching desktop: solid accent endpoints, individual faded rounded-square range boxes, a crisp accent ring on today, dimmed unavailable days, and saved-message dots | Touch size, while staying visually consistent with the desktop calendar |
| Footer | Clean single status line ("Choose a start date", "Oct 5 → select end", "Oct 5 → Oct 18"), then Clear and a full-width 44 px Apply | Uncluttered and always in the same place; Apply stays disabled until the choice is valid |
| Dismiss | Close, the backdrop or Escape, without applying | Choices apply only with Apply, as on computers |

Computers keep the existing popover unchanged.

## Transitions

| | Transition | Expected |
|---|---|---|
| D1 | Open on a phone | The sheet rises (0.2 s, none with reduced motion) and shows the month of the current choice, or the current month |
| D2 | Tap a start day, then an end day in another month | The band spans both months, and the footer shows the range |
| D3 | Scroll near the top | Six older months are added above without moving what's on screen |
| D4 | Tap a month title, then a year, then a month | That month is listed and scrolled to |
| D5 | Tap a quick range | It's selected and its month scrolls into view |
| D6 | Backdrop, Close or Escape | Closes, nothing applied, and focus returns to the button |

## Verification

- **Unit tests** (`tests/date-picker.test.cjs`): sheet structure, every mode, the quick ranges, one weekday row, months ending today, a range across months applied from the footer, a jump via the year and month grids, and backdrop close without applying.
- **Live:** profile Sort & filter → Date → Custom at 412 px (phone emulation). The sheet was 412 × 640 px with 54 × 44 px days, the months ran to the current month, and today was highlighted.
