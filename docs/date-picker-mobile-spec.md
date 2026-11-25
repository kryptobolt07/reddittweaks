# Date picker on phones (2026-11-24)

User request: the computer calendar is fine, but on phones it should become a pull-up sheet like the others, designed the way iOS and Android do it and easy to use with a thumb, without losing any feature.

## Design

The design follows the patterns phone users already know:
- **Android:** Material 3's modal date-range picker, with months scrolling vertically under a fixed weekday row and the selected range as a band.
- **iOS:** the range sheets common in iOS apps (bottom sheet, drag handle, a sticky Apply).

| Part | Phone sheet | Why |
|---|---|---|
| Container | Bottom sheet over a dimmed backdrop, up to 640 px or 88% of the screen, 16 px top corners, drag handle, title "Date", round Close | The same pull-up as our other sheets. The thumb reaches it, and the page stays visible above it |
| Condition | On · Before · After · Between, as a full-width segmented pill control (elevated active thumb in a soft track) | Nothing from the computer picker is lost, and the active mode reads clearly on phones |
| Quick ranges | Today, Yesterday, 7 days, 30 days, This month, Last month, This year (feeds and profiles; chat keeps its four), as 34 px outlined chips that scroll sideways | One tap for the common cases |
| Month & year jump bar | Dedicated `[ Month ▾ ]` and `[ Year ▾ ]` dropdown pills right above the weekday row (synced live as you scroll), plus a `Today` jump pill whenever you are viewing another month. Sticky month headings also carry a `▾` caret | Makes changing the month or year unmistakable in one tap, without hunting for hidden text links |
| Calendar | One fixed weekday row, then months stacked in a vertical scroll ending at the current month. Older months load as you scroll up (back to the earliest available month, or June 2005). Each month's title sticks while its days are on screen | Scrolling replaces the small arrows, as Android's range picker does. A history filter mostly looks back, so the list ends at today |
| Jump choosers | Tapping `[ Month ▾ ]` opens the 3×4 month tile grid directly (with out-of-range future months disabled); tapping `[ Year ▾ ]` or a month heading opens the 4-column year tile grid, then the month grid. The jump bar stays visible with the active pill highlighted and its caret flipped up, plus Back | Years or months back in one or two taps, with clear button affordances |
| Days | 44 px cells (Apple's minimum touch target). The selected day is a 40 px circle, a range is a continuous band between its endpoints, today has a crisp accent ring, unavailable days are dimmed, and days with saved messages keep their dot | Touch size, plus unmistakable visual feedback for today, selection, and unavailable days |
| Footer | Interactive selection slots (`Start` → `End` in Between mode, or a single mode slot) highlight whichever tap comes next (`Tap a day`) and jump back to a picked date's month on tap; below sit Clear and a full-width 44 px Apply | Always shows what tapping a day will set, and Apply stays disabled until the choice is valid |
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
