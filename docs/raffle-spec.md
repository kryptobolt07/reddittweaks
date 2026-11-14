# Spec: raffles from a post's commenters

Status: implemented 2026-11-14 (`extension/raffle-model.js`, `extension/raffle-ui.js`, bridge actions `raffle-thread`, `raffle-tree`, `raffle-user`); reading and the dialog reworked the same day after live checks. Native measurements: `artifacts/research/verify/raffle/FINDINGS.md` (ignored). Follows the [interaction and lifecycle contract](interaction-lifecycle-contract.md).

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
| P10 | Works on very large threads | Reddit API through their server | **Yes**: the thread JSON, then the same requests Reddit's own client makes (comments partial + "more comments" chain) until the chain ends, from any page |

## 3. Behaviour

- **B1. Entry point.** Every post's ⋯ menu (`shreddit-post-overflow-menu`) gets "Run a raffle" as the last item, in the menu's own action slot (`devvit-context-actions`), including your own posts' longer menu. Measured: identical to Reddit's items (175×40, or 32 px rows in the owner menu). It is added when the menu appears and again as the ⋯ button is pressed (capture phase), and a failed settings read keeps the default (on) and retries with backoff, so no route to a post leaves it missing (checked live 2026-11-15: direct load, feed → post, Back, Forward, search → post, home → post, profile → post, comment permalink, cold worker).
- **B2. Dialog.** Choosing it closes the menu and opens Reddit's `rpl-modal-card` (520 px; Reddit's `bottom-sheet` at 640 px and below) on the measured scrim. A one-line post reference (r/sub • title) and a one-line status (bold entrant count, coverage, a 2 px progress line while reading). Rules are Reddit settings rows (measured: label 14/20 and caption 12/16 on the left, control on the right, 8 px rows; Reddit's 48×32 switch): Winners (− / + stepper), Top-level comments only, Exclude the post's author, Comment must include, Exclude users, and a folded Account requirements row whose caption sums up the active minimums. Three screens with their own buttons: rules (Cancel / Draw winners), Winners (Back to rules / Message winners / Draw again), Message winners (Back / Send).
- **B3. Reading entries.** Opening the dialog starts reading at once (§4) with an indeterminate progress bar and "Reading comments… N top-level so far". Rules can be edited meanwhile; "Draw winners" is enabled once reading finishes.
- **B4. Honest coverage.** The read is complete when Reddit's "more comments" chain ends, which is where a person scrolling reaches the bottom: "Read all 1,174 top-level comments (8,269 in the thread, counting replies)". The JSON's "more" placeholder is not the expected count: its ID list includes replies (measured: 48 + 386 listed ≠ 416 top-level). The read is incomplete only when the chain is cut short (an error, a rate limit that didn't clear after three waits, or the 120-page cap) or reply threads were left (all-comments mode). Then it says why, keeps what was read, and drawing needs an explicit "Draw from the comments read" tick.
- **B5. Draw.** Candidates = qualifying comments, one per user. They're put in a uniformly random order, and winners are the first N that pass the account rules; only accounts reached are looked up (`/user/<name>/about.json`). An account that can't be looked up, or is suspended or deleted, never wins, and the result says how many were skipped and why.
- **B6. Result.** A separate Winners screen: "N winners from M eligible entrants" with the draw time and a Copy (Markdown) button, then one row per winner built like Reddit's comment row (rank, 32 px round profile picture, u/name 12 px/700 • time 12 px weak, the comment text 14/20 px clamped to two lines with Show more / Show less). The row opens the comment in a new tab; the name opens the profile. "How this was drawn" folds the coverage, skips and rules.
- **B7. Message winners.** From the Winners screen: the recipients (picture and name), a choice of **Separate chats** (each winner privately; an existing chat with that person is reused) or **One group chat** (named, default "Raffle: <title>"), the message (default congratulation with the post link; `{user}`, `{title}` and `{link}` are filled in), and a live preview. Send needs a second click ("Confirm: send N messages", with "Messages are sent from your account and can't be unsent"). Separate chats go one at a time, 1.5 s apart; each recipient shows Sent / Sent in your existing chat / the reason it failed; Reddit's new-chat limit stops the rest, marked Not sent. A later send goes only to the people not reached. Sending uses Reddit's own chat client, preloaded on every page (measured: `getRoomList` for an existing DM, `createRoom({preset:'reddit_dm'})`, group `createRoom({preset:'private_chat'})` + invites past 10, `sendTextMessage`); the page bridge messages only accounts it resolved for this raffle, at most 100, and Reddit's chat token never leaves Reddit's client. **Never sent live by the agent;** the user tests it.
- **B8. Nothing else is written.** Apart from the messages you confirm in B7, nothing is posted or stored; results live only in the dialog.

## 4. Data sources (measured 2026-11-14)

| Source | Use | Notes |
|---|---|---|
| `/comments/<id>.json?limit=500&sort=old&raw_json=1` (+`depth=1` for top-level only) | First up to 500 top-level comments, with author, time, parent, body, permalink | The root `more` object lists the IDs of the remaining top-level comments |
| `/svc/shreddit/comments/r/<sub>/<id>?sort=old&seeker-session=true&render-mode=partial` (GET), then `/svc/shreddit/more-comments/r/<sub>/t3_<id>?…` (POST, form `cursor` + `csrf_token`, Accept `text/vnd.reddit.partial+html`) | Everything past the JSON, exactly as Reddit's client loads it; top-level loaders in order, "more replies" loaders two at a time when replies count | Works from any page. Many comments sit inside `<template>` content, so parsing descends into templates. Cursors grow ~700 characters per page (bounded at 200,000). Measured: 449/449 top-level on one thread (10 requests, 13 s); 1,174 top-level on an 8,269-comment thread from a feed card (41 s) |
| `/user/<name>/about.json` | Account age and karma | Only for users reached during a draw with account rules |
| `/api/morechildren`, `/api/info` | Not used | Both return HTTP 403 with the session (measured) |

All reads run in the page world with Reddit's own session, same origin, fixed paths, validated IDs and names.

## 5. Requirements and acceptance checks

| ID | Requirement | Acceptance check |
|---|---|---|
| R1 | Unbiased draw | A1: unit: `randomInt` rejects out-of-range words; 60 000 draws of 3 from 6 give each user 50 % ± 2 % |
| R2 | Rules exclude exactly as stated, one entry per user | A2: unit: each rule and the exclusion counts |
| R3 | Account rules only for reached users; failures never win | A3: unit: lookups stop once N winners pass; a throwing lookup is skipped and counted |
| R4 | Coverage is honest | A4: unit: a finished chain is complete whatever the placeholder lists; a chain cut short keeps entries, says why, and Draw needs the tick. Live 2026-11-14: "Read all 1,174 top-level comments" from a feed card |
| R5 | Menu item matches Reddit's | A5: measured live (FINDINGS.md): identical box, font, colours |
| R6 | Bridge reads only fixed same-origin paths | A6: unit: invalid IDs and names rejected before any fetch |
| R8 | Messages go only to the winners, after confirmation, and report each outcome | A8: unit: first click only confirms; one send per winner (existing chats reused); retries skip delivered ones; rate limit stops the rest; the bridge refuses unresolved accounts, empty or oversized text |
| R7 | Dialog closes cleanly | A7: unit: Escape, Cancel and the close button close it and abort reading |

## 6. Transitions

| T | Transition | Expected |
|---|---|---|
| T1 | Direct load of a post or feed | The item appears in each post's menu once Reddit defines the menu; one item per menu |
| T7 | Reddit re-renders a post card or its menu | The item comes back on the next observer pass; never duplicated |
| T8 | Menu open and close; item chosen | Menu closes, dialog opens with focus on the winners field; Escape or Cancel closes the dialog and returns focus to the post's ⋯ button |
| T2 | Navigation while the dialog is open | The dialog is modal, so navigation needs it closed first; closing aborts any reading |
| T10 | Setting "Raffles" toggled | The item is removed from or added to open menus without reload |
| T15 | Mobile layout | Same menu slot; at 640 px and below the dialog is Reddit's bottom sheet (live at 380 px: full width, no sideways scroll) |
| T16 | old.reddit.com | Off |

**Lifecycle audit.** Menu item: created by `RTRaffle.sync()` (MutationObserver, settings), removed only by `sync()` when the setting is off or by Reddit replacing the menu. Dialog: created by `open()`, removed by `close()` (Escape, Cancel, close button, backdrop click, destroy).

## 7. Where we lag

| # | Limit | What the user sees |
|---|---|---|
| L1 | No shareable server-side results page | "Copy results" Markdown instead |
| L2 | Huge threads take time: ~90 top-level comments per request (~2.7 MB each) | The progress line counts up; Cancel stops at once |
| L3 | All-comments mode on very large threads may stop at 800 reply requests | Stated with the number of reply threads not read |
| L4 | Reply chains hidden behind "more replies" aren't read when "Top-level only" is off | Counted and stated |
| L5 | Karma and age come from Reddit at draw time and can change | Shown with the draw time |
