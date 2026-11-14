# Spec: raffles from a post's commenters

Status: implemented 2026-11-14; official raffles via Reddit Raffler added 2026-11-15 (§4b) (`extension/raffle-model.js`, `extension/raffle-ui.js`, bridge actions `raffle-thread`, `raffle-tree`, `raffle-user`); reading and the dialog reworked the same day after live checks. Native measurements: `artifacts/research/verify/raffle/FINDINGS.md` (ignored). Follows the [interaction and lifecycle contract](interaction-lifecycle-contract.md).

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
- **B2. Dialog.** Reddit's `rpl-modal-card` (520 px, anchored near the top so it doesn't jump between screens; Reddit's `bottom-sheet` at 640 px and below, switched live on rotation/resizing) on the measured scrim. The rules screen opens with focus on the heading and starts with a **choice**: **Public draw** ("On Reddit Raffler: a results page anyone can check · one per post · can't be redone", plus Raffler's state: signed in as u/… and whether it will be verified, guest, unavailable with Try again, or already drawn) or **Private draw** ("Only you see the winners · no proof · you can draw again"). Public is selected by default (user's decision: Raffler first) but needs a second click with the warning beside the button. Then a one-line status ("Up to N people can enter" / "N people can win"; coverage detail only when the read was incomplete), and Reddit settings rows (measured: label 14/20 and caption 12/16 left, control right, 8 px rows; Reddit's 48×32 switch): Winners (stepper with bounds and an "Only N people can win" warning), Top-level comments only, Exclude the post's author, Comment must include, Exclude users, folded Account requirements. Rows Reddit Raffler can't follow are disabled in public mode with the reason as their caption, and keep their values for a private draw. One main action per screen; warnings and progress sit in a footer note beside it (in view on phones). Revised 2026-11-15 after two passes of an independent review.
- **B3. Reading entries.** Opening the dialog starts reading at once (§4) with an indeterminate progress bar and "Reading comments… N top-level so far". Rules can be edited meanwhile; "Draw winners" is enabled once reading finishes.
- **B4. Honest coverage.** The read is complete when Reddit's "more comments" chain ends, which is where a person scrolling reaches the bottom: "Read all 1,174 top-level comments (8,269 in the thread, counting replies)". The JSON's "more" placeholder is not the expected count: its ID list includes replies (measured: 48 + 386 listed ≠ 416 top-level). The read is incomplete only when the chain is cut short (an error, a rate limit that didn't clear after three waits, or the 120-page cap) or reply threads were left (all-comments mode). Then it says why, keeps what was read, and drawing needs an explicit "Draw from the comments read" tick.
- **B5. Draw.** Candidates = qualifying comments, one per user. They're put in a uniformly random order, and winners are the first N that pass the account rules; only accounts reached are looked up (`/user/<name>/about.json`). An account that can't be looked up, or is suspended or deleted, never wins, and the result says how many were skipped and why.
- **B6. Result.** A separate Winners screen: a title row ("3 winners", View proof for public draws, Copy) and below it a badge ("Verified public raffle" / "Public raffle" / "Private draw · not recorded") and one line of details in the reader's local date format (Raffler's UTC date is converted). One row per winner like Reddit's comment row (rank, 32 px profile picture, u/name • time • account age for public draws, the comment text clamped to two lines with a measured Show more). The row opens the comment in a new tab; the name opens the profile. Message winners is the main action; Draw again (private only) asks first and the results say which draw it is. A stray backdrop click never discards results, and closing with unsaved private results asks once. A post that already has a public raffle opens straight on its results, with "Draw privately anyway" as a deliberate second step and the public results one click away.
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

## 4b. Official raffles on Reddit Raffler (decided 2026-11-15)

The main action is an **official raffle** drawn by Reddit Raffler (redditraffler.com, ~35,000 verified raffles), which publishes a permanent public results page that people use as proof. Our own draw stays as **Quick draw (not recorded)**. We use the endpoints Raffler's own pages call (public source github.com/redditraffler/redditraffler, checked live 2026-11-15); the requests run in the extension worker (`raffler-broker.js`, host permission `https://www.redditraffler.com/*`):

| Step | Request | Notes |
|---|---|---|
| Check | `GET /raffles/<post id>` | 404 = none yet; 200 = the results page (parsed: verified tag, creator, date, criteria, ignored users, winner cards with comment link, account age and karma) |
| Session and CSRF | `GET /raffles/new` | `csrf_token` hidden field; the header shows your Raffler name and "Log Out" when you're signed in there |
| Create | `POST /api/raffles/new` (form: `csrf_token`, `submissionUrl=https://redd.it/<id>`, `winnerCount`, `minAge`, `minComment`+`minLink` **or** `minCombined`, `ignoredUsers` as a JSON list) | Raffler's CSRF check needs a same-site `Referer`; `raffler-referer-rules.json` sets it for this one request only. 202 queued, 303 already exists, 422 refused, 429 rate-limited |
| Progress | `GET /api/job_status?job_id=<post id>` | "Fetching submission… / Fetching comments… / Selecting winners… / Saving raffle results… / Done!" or "Error: …" |

**Sign-in (user's decision).** Requests carry your redditraffler.com cookies: signed in there, the raffle is created as you (marked verified only when you're the post's author); otherwise it's a guest raffle (unverified). The dialog says which before you confirm.

**Raffler's rules differ from Quick draw**, and the dialog says so instead of hiding it: top-level comments only; a person with more than one top-level comment is disqualified; no "comment must include"; either total karma or comment and post karma; at most 100 ignored users (we always add AutoModerator, and the post's author when "Exclude the post's author" is on); one raffle per post, so no "Draw again"; on very large threads Raffler reads comments in random order and expands only 20 "load more" batches (`replace_more(limit=20)`), so it may not read everyone. Rules Raffler can't follow disable the official button with the reason; Quick draw still works.

**Confirmation.** "Run official raffle" needs a second click ("Confirm: create official raffle") with the note that it's public, permanent and one per post, and whether it's verified or a guest raffle. Progress shows Raffler's own status lines (polled every 1.5 s, up to 3 minutes).

**Results.** Shown in our Winners screen: a "Verified official raffle" or "Official raffle" badge, who created it and when, a **Proof** button (the permanent page) and Copy (Markdown with the proof link). Rows are our comment rows; the comment text comes from the comments we read, or "Open the comment to read it". A post that already has an official raffle shows "View official results" instead of creating one. Message winners works for official winners too.

**Privacy.** Raffler receives the post's ID, the rules and the ignored usernames, plus its own cookies. Nothing about other Reddit accounts or the reader's Reddit session is sent. **Never created live by the agent:** each post can have only one, and it's public.

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
