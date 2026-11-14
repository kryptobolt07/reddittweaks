# Spec: raffles from a post's commenters

Status: implemented 2026-11-14 (`extension/raffle-model.js`, `extension/raffle-ui.js`, bridge actions `raffle-thread`, `raffle-more`, `raffle-user`). Native measurements: `artifacts/research/verify/raffle/FINDINGS.md` (ignored). Follows the [interaction and lifecycle contract](interaction-lifecycle-contract.md).

## 1. The problem

Giveaway hosts pick random winners from a post's commenters with Reddit Raffler (redditraffler.com): paste a link, set rules, draw. The user wants that inside Reddit, from the post's own ⋯ menu.

## 2. Parity target

| # | Capability | Reddit Raffler | Ours |
|---|---|---|---|
| P1 | Pick N random winners from a post's commenters | Yes | **Yes**, 1–100 winners |
| P2 | One entry per user | Yes | **Yes**, always (the user's earliest qualifying comment counts) |
| P3 | Top-level comments only | Option | **Yes**, on by default |
| P4 | Minimum account age, comment karma, post (link) karma, total karma | Yes | **Yes** |
| P5 | Exclude the post's author, AutoModerator, deleted/removed comments | Partly | **Yes** |
| P6 | Exclude listed users | No | **Yes** |
| P7 | Comment must include a word or code | No | **Yes** |
| P8 | Shareable result page on their server | Yes | No: "Copy results" gives Markdown to paste as a comment; nothing leaves the browser |
| P9 | Randomness | Server-side | `crypto.getRandomValues`, unbiased (rejection sampling), Fisher–Yates order |
| P10 | Works on very large threads | Reddit API through their server | Reads the thread JSON, then Reddit's own "more comments" chain on the post page until every top-level comment Reddit lists is found (§4) |

## 3. Behaviour

- **B1. Entry point.** Every post's ⋯ menu (`shreddit-post-overflow-menu`) gets "Run a raffle" as the last item, in the menu's own action slot (`devvit-context-actions`). Measured: the item is 175×40 with 4 px 16 px padding, a 14 px/400 label and a 20 px icon in a 32 px box, identical to Reddit's Save item.
- **B2. Dialog.** Choosing it closes the menu and opens a modal built from Reddit's `rpl-modal-card` (`appearance="modal"`) on the measured scrim (`--color-scrim-background`). Title "Run a raffle", the post's title under it, the rules form, a status line and the buttons "Cancel" and "Draw winners".
- **B3. Reading entries.** Opening the dialog starts reading comments at once (§4); the status says "Reading comments… N so far". Rules can be edited meanwhile. "Draw winners" is enabled once reading finishes.
- **B4. Honest coverage.** When reading ends with comments Reddit listed but didn't return, the status says "Read N of M top-level comments" and drawing needs an explicit "Draw from the comments read" tick. A complete read says "Read all N top-level comments". With "Top-level only" off, replies hidden behind "more replies" are counted and stated the same way.
- **B5. Draw.** Candidates = qualifying comments, one per user. They're put in a uniformly random order, and winners are the first N that pass the account rules; only accounts reached are looked up (`/user/<name>/about.json`). An account that can't be looked up, or is suspended or deleted, never wins, and the result says how many were skipped and why.
- **B6. Result.** A numbered list: u/name (links to the profile), "comment" link, and the comment's first line. Then "N winners from M eligible entrants · drawn at <time>", "Copy results" (Markdown, including the rules), and "Draw again" (a fresh, independent draw). Fewer eligible users than requested winners is stated ("Only 3 eligible entrants").
- **B7. Read-only.** Nothing is posted, sent or stored. Results live only in the dialog.

## 4. Data sources (measured 2026-11-14)

| Source | Use | Notes |
|---|---|---|
| `/comments/<id>.json?limit=500&sort=old&raw_json=1` (+`depth=1` for top-level only) | First up to 500 top-level comments, with author, time, parent, body, permalink | The root `more` object lists the IDs of the remaining top-level comments |
| `/svc/shreddit/more-comments/r/<sub>/t3_<id>?top-level=1…` (POST, form `cursor`) | The rest, by following Reddit's own chain from the live page's loader | Only on the post page itself; ~2.7 MB per ~90 comments; stops when every listed ID is found, after 40 pages, or when the chain ends |
| `/user/<name>/about.json` | Account age and karma | Only for users reached during a draw with account rules |
| `/api/morechildren`, `/api/info` | Not used | Both return HTTP 403 with the session (measured) |

All reads run in the page world with Reddit's own session, same origin, fixed paths, validated IDs and names.

## 5. Requirements and acceptance checks

| ID | Requirement | Acceptance check |
|---|---|---|
| R1 | Unbiased draw | A1: unit: `randomInt` rejects out-of-range words; 60 000 draws of 3 from 6 give each user 50 % ± 2 % |
| R2 | Rules exclude exactly as stated, one entry per user | A2: unit: each rule and the exclusion counts |
| R3 | Account rules only for reached users; failures never win | A3: unit: lookups stop once N winners pass; a throwing lookup is skipped and counted |
| R4 | Coverage is honest | A4: unit: missing IDs give "Read N of M" and Draw needs the tick |
| R5 | Menu item matches Reddit's | A5: measured live (FINDINGS.md): identical box, font, colours |
| R6 | Bridge reads only fixed same-origin paths | A6: unit: invalid IDs and names rejected before any fetch |
| R7 | Dialog closes cleanly | A7: unit: Escape, Cancel and the close button close it and abort reading |

## 6. Transitions

| T | Transition | Expected |
|---|---|---|
| T1 | Direct load of a post or feed | The item appears in each post's menu once Reddit defines the menu; one item per menu |
| T7 | Reddit re-renders a post card or its menu | The item comes back on the next observer pass; never duplicated |
| T8 | Menu open and close; item chosen | Menu closes, dialog opens with focus on the winners field; Escape or Cancel closes the dialog and returns focus to the post's ⋯ button |
| T2 | Navigation while the dialog is open | The dialog is modal, so navigation needs it closed first; closing aborts any reading |
| T10 | Setting "Raffles" toggled | The item is removed from or added to open menus without reload |
| T15 | Mobile layout | Same menu slot; dialog fits 380 px (width `min(560px, 100vw - 32px)`) |
| T16 | old.reddit.com | Off |

**Lifecycle audit.** Menu item: created by `RTRaffle.sync()` (MutationObserver, settings), removed only by `sync()` when the setting is off or by Reddit replacing the menu. Dialog: created by `open()`, removed by `close()` (Escape, Cancel, close button, backdrop click, destroy).

## 7. Where we lag

| # | Limit | What the user sees |
|---|---|---|
| L1 | No shareable server-side results page | "Copy results" Markdown instead |
| L2 | From a feed card, comments past Reddit's first 500 can't be read (the "more comments" chain needs the post page) | "Read N of M … Open the post to read the rest" |
| L3 | Very large threads (over ~3,500 top-level comments) may stop at the 40-page cap | Stated as incomplete with the counts |
| L4 | Reply chains hidden behind "more replies" aren't read when "Top-level only" is off | Counted and stated |
| L5 | Karma and age come from Reddit at draw time and can change | Shown with the draw time |
