# Spec: detect removals of your own posts and comments

Status: target spec, not started (written 2026-11-12). This is the bar the feature must reach, not a step list. Each requirement (R…) has an acceptance check (A…). A release may ship a subset; a requirement counts as met only when its check passes.

## 1. The problem

When a moderator, AutoModerator, Reddit's spam filter or Reddit itself removes **your own** comment, Reddit usually still shows it to you as normal. Everyone else sees `[removed]` or nothing at all. For posts Reddit sometimes shows you a banner, but often it doesn't explain much. You find out only by checking from a logged-out window, or never.

The feature tells the signed-in user, inside Reddit's own pages:

- which of their posts and comments others can't see;
- who most likely removed each one, and how sure we are;
- when it happened (as far as we can tell);
- whether it was later approved, locked or collapsed.

Everything stays in the user's browser.

This is different from what we already do for **other** people's content (deleted vs removed labels and archive restore). Here the subject is the signed-in account, and the key fact is "others can't see this", which Reddit hides from the author.

## 2. Parity target

Reference products, checked on 2026-11-12:

- **Reveddit**: the user page `reveddit.com/y/<you>` and its classification code, read from the public source at github.com/reveddit/reveddit (`src/data_processing/user.ts`, `comments.ts`, `components/common/RemovedBy.tsx`).
- **Reveddit Real-Time**: a browser extension that watches your account and notifies you of removals.

| # | Capability | Reveddit | Reveddit Real-Time | Ours (target) |
|---|---|---|---|---|
| P1 | List your posts and comments that others can't see | Yes, user page | Notification only | **Yes**, a "Removed" view on your own profile and badges in place |
| P2 | Removed by a Reddit admin | `[removed] by Reddit` (from `removal_reason`) | Yes (changelog: "removal_reason") | **Yes** |
| P3 | Removed automatically (AutoModerator or spam filter) | `[removed] automatically`: archive captured it already removed within **25 s** of posting, or the public mod log names a bot | Not distinguished | **Yes**, same 25 s rule using Arctic Shift's `retrieved_on` |
| P4 | Removed by a moderator | `[removed] by mod`: the archive captured it visible, then it was removed ("likely") | Yes | **Yes**, with "likely" wording |
| P5 | Can't tell mod from automatic | `[removed] mod/auto` | No | **Yes**, the same honest fallback |
| P6 | Auto-removed, then approved by a mod | `[approved] auto-removed, then approved` | "reapproved" notice | **Yes** |
| P7 | Locked (no replies allowed) | `locked` | Lock and unlock notices | **Yes** |
| P8 | Collapsed by Crowd Control | Collapsed state shown | No | **Yes** (comments) |
| P9 | Post removal category (`removed_by_category`) | Used for posts | Unknown | **Yes**: the moderator, automod_filtered, reddit, anti_evil_ops, content_takedown, copyright_takedown and community_ops values |
| P10 | Account-level checks (shadowban or suspension) | User page shows "deleted/shadowbanned" or "suspended" | No | **Yes**, a one-line account check in the Removed view |
| P11 | Notify when something is newly removed, locked or approved | No | Yes | **Yes** (opt-in) |
| P12 | Filter the list by removal source, type and date | Yes (filters, sort) | No | **Yes**, reusing our Feed options filters |
| P13 | Show what others actually see | Links to the thread | No | **Yes**, a "View as others" link to a logged-out view |
| P14 | Restore the text if Reddit lost it | Archive copy | No | Yes, we already restore from Arctic Shift |
| P15 | Public mod-log evidence | Uses public mod logs where subreddits publish them | No | Out of scope for v1 (see §10) |

Beyond parity, we do things these tools can't, because we run inside Reddit's pages: badges on your own items wherever they appear (threads, profile, search), no separate site, and no third-party server besides the optional Arctic Shift archive.

## 3. States and labels

Each of your items gets exactly one **visibility state**, plus optional **flags**. Labels follow Reddit's tone. Words in *italics* show the confidence wording.

| State | Shown to you as | Meaning | Confidence |
|---|---|---|---|
| `visible` | (nothing) | Others can see it normally | Verified |
| `removed-admin` | **Removed by Reddit** | An admin removed it (`removal_reason`, `anti_evil_ops`, `content_takedown`, `copyright_takedown`, `community_ops`) | Verified |
| `removed-filter` | **Removed by Reddit's filters** | The spam filter or a site-wide filter removed it (post `removed_by_category: reddit` with a filter banner) | Verified for posts, *likely* for comments |
| `removed-auto` | **Removed automatically** | AutoModerator or the spam filter. The archive saw it already removed within 25 s, or the post says `automod_filtered` | Verified (`automod_filtered`), otherwise *likely* |
| `removed-mod` | **Removed by moderators** | The archive saw it visible, then it was removed. Or the post says `moderator` | Verified (`moderator`), otherwise *likely* |
| `removed-unknown` | **Removed: moderators or automatic** | Removed for others, source unknown (no archive copy, or too late to tell) | Verified that it's removed, source unknown |
| `deleted` | **Deleted by you** | You deleted it (excluded from the Removed view by default) | Verified |
| `unknown` | **Couldn't check** | The check failed or was rate-limited. Never shown as "visible" | n/a |

Flags (any state): `locked`, `collapsed` (Crowd Control), `approved-after-auto` (P6), `quarantined-community`, `restored-text` (the body came from the archive).

Every label opens a short tooltip saying how we know ("Reddit marks this post as removed by moderators", or "The archive saw it 3 minutes after posting, still visible, so it was likely removed later by a moderator"). This is the honesty rule from `AGENTS.md`: we never claim more certainty than the evidence gives.

## 4. Detection rules

### 4.1 Evidence sources

| Code | Source | Gives us | Status |
|---|---|---|---|
| E1 | Your own listings, signed in: `/user/<you>/comments`, `/submitted`, or the shreddit equivalents we already read | Your items with text, as **you** see them; posts carry `removed_by_category`, `removal_reason`, `locked` | Used today for profile pages |
| E2 | A **public view** of the same items: logged-out `api/info` by ID, or the logged-out thread HTML (`credentials: 'omit'`) | `[removed]` or `[deleted]` body, `collapsed`, removal notices, which is what others see | **Unverified.** A logged-out `api/info.json` from outside the browser got **HTTP 403** on 2026-11-12, and Reveddit's source notes Reddit refusing `api/info` from its extension. Phase-0 check V1 decides which public view works. |
| E3 | Arctic Shift records for your items | Body as first captured, `retrieved_on`, so we know whether it was visible or `[removed]` at capture and the latency since posting | Used today (opt-in archive) |
| E4 | Reddit's author banners on your own posts (`[slot="post-removed-banner"]`, "removed by the moderators", "removed by Reddit's filters") | Post removal source, as Reddit tells the author | Partly parsed today (`M.domStatus`) |
| E5 | Logged-out profile page for `/user/<you>` | 404 while the name is taken = shadowbanned or deleted; "suspended" notice | Unverified (V3) |

### 4.2 Classification (applied in this order; the first match wins)

1. E1 says you deleted it (`[deleted]`, `removed_by_category: deleted|author`) → `deleted`.
2. `removal_reason` is set, or the post category is `anti_evil_ops|content_takedown|copyright_takedown|community_ops|reddit` and the banner names Reddit → `removed-admin`. A `reddit` category with a filter banner → `removed-filter`.
3. Post `removed_by_category: automod_filtered` → `removed-auto` (verified).
4. Post `removed_by_category: moderator` → `removed-mod` (verified).
5. The public view (E2) says `[removed]` or shows no body, or the item is missing for others:
   - The archive (E3) captured it already `[removed]`, or has no capture, and `retrieved_on − created ≤ 25 s` → `removed-auto` (*likely*).
   - The archive captured it with its body (visible at capture) → `removed-mod` (*likely*).
   - Otherwise → `removed-unknown`.
6. The public view shows it, but the archive captured it as `[removed]` → `visible` + `approved-after-auto`.
7. The public view shows it → `visible`.
8. Any source failed or was rate-limited → `unknown` (never `visible`).

The 25-second threshold and the "archive saw it visible, so later = moderator" rule are Reveddit's (`AUTOMOD_LATENCY_THRESHOLD = 25` in `RemovedBy.tsx`). Keep them identical so results match theirs.

## 5. Where it appears (interface)

All surfaces use Reddit's own components and the styles we already match: search rows, scope pills, Feed options menus, tooltips and status icons.

- **U1. Badges in place.** On your own comments and posts wherever Reddit shows them (threads, your profile, search results), add one compact status pill next to the time, for example "Removed by moderators", with its tooltip. Nothing is added to other people's items, and nothing appears when the state is `visible`.
- **U2. A Removed view on your own profile.** A list entry next to Saved, History and the others (the same header pill and search-row layout as our list searches), plus a Feed options filter: Removal source (any, moderators, automatic, Reddit, unknown), Type (posts, comments), Date, and Subreddit with counts. Each row shows the state pill, the community and time, the text (restored from the archive if Reddit hides it), and the actions "View as others" and "Open". The summary line says how far back the check reached and how many items were checked, never "all".
- **U3. Account check.** At the top of the Removed view, one line: "Others can see your profile" / "Your profile looks suspended or shadowbanned to others" / "Couldn't check".
- **U4. Notifications (opt-in, P11).** The extension's toolbar badge counts new removals since you last looked. The popup lists recent changes (removed, approved, locked, unlocked) with links. System notifications are a separate opt-in.
- **U5. Popup settings.** A card "Your removed content" with "Check my posts and comments" (on/off), "Notify me" (off by default), and a short privacy line. It lives in the "On Reddit" group; archive-based classification only works when "Use the archive" is on, and says so.

## 6. Checking schedule and limits

- **C1.** Badges in place (U1) check only items on screen, in batches of up to 100 IDs, at most once per item per 10 minutes.
- **C2.** The Removed view (U2) checks your newest 1,000 posts and comments: that's Reddit's listing limit, and the summary says so. Older items come only from the archive and are labelled that way.
- **C3.** Background checks (U4) run at most every 15 minutes, only over items from the last 7 days plus items currently in a removed state (to catch approvals), and back off on HTTP 429.
- **C4.** All requests run through the extension's existing bounded transports. No second sync loop, and no visible scrolling (`AGENTS.md`).
- **C5.** Results are cached per account in `chrome.storage.local`: item ID → state, flags and checked-at time. Never synced. Cleared with the other per-account data, and capped at 5,000 items (least recently checked dropped first).

## 7. Privacy, permissions, safety

- Only the signed-in account's own items are checked by this feature, with the signed-in name confirmed the way our list search already does.
- Public-view checks (E2) carry **no** cookies or tokens (`credentials: 'omit'`). They must never reveal anything a logged-out visitor couldn't see.
- Arctic Shift receives only item IDs or your username, and only when "Use the archive" is on.
- Background checks need `alarms`, and system notifications need `notifications`. Both are `optional_permissions`, requested when the user turns the setting on. No new host permissions beyond what V1 proves necessary.
- Strictly read-only: this feature never edits, deletes or reports anything.

## 8. Requirements and acceptance checks

| ID | Requirement | Acceptance check |
|---|---|---|
| R1 | Classify each of your items into §3's states with §4.2's rules | A1: unit tests over synthetic fixtures for every rule branch (all 8, including 25 s boundary cases at 25 and 26 s, archive missing, archive `[removed]`, `removal_reason` plus `[removed]`) |
| R2 | Never show `visible` without a successful public-view check | A2: a fixture where E2 fails gives `unknown`, and the UI says "Couldn't check" |
| R3 | Badges in place on your own items only (U1) | A3: L2 fixture thread with your and others' comments: pills on yours only, none on `visible` ones; live L3 on a real removed comment of yours |
| R4 | Removed view with filters and an honest summary (U2) | A4: the fixture profile shows exactly the removed items; filters narrow correctly; the summary names the checked range and count |
| R5 | "View as others" opens a logged-out view of that item | A5: the link opens a view without cookies; the item shows `[removed]` there for a known removed item |
| R6 | Account check (U3) | A6: fixtures for 200, 404-while-taken and suspended give the three lines |
| R7 | Notifications on new removal, approval, lock and unlock (U4), opt-in | A7: a simulated state change gives one badge increment and one popup entry; no duplicates on recheck; nothing while the setting is off |
| R8 | Limits and caching per §6 | A8: request counter tests: ≤1 check per item per 10 min, batches ≤100, 429 back-off honoured |
| R9 | Privacy rules per §7 | A9: tests assert `credentials: 'omit'` on public checks and no Arctic Shift call with the archive off; the manifest diff shows only optional permissions |
| R10 | Labels and tooltips match Reddit's tone and state their evidence | A10: council visual and copy review against native Reddit; every label has a tooltip naming its source |
| R11 | Matches Reveddit's verdicts | A11: for 20 of the user's real items (L3, read-only), our state matches Reveddit's label, or the difference is explained by a documented rule |

## 9. Phase-0 live checks (decide the open data questions first)

Run read-only in the signed-in browser before building:

- **V1. Public view.** Which works from the extension for an item you know is removed: logged-out `api/info.json`, logged-out `/svc/shreddit/...` comment HTML, or the logged-out thread page? Record status codes, rate limits and the removed markers. This decides E2.
- **V2. Author view.** For your own removed post and comment, what do authenticated JSON and shreddit HTML show you (`removed_by_category`, `banned_by`, `removal_reason`, banners)?
- **V3. Account check.** What does a logged-out profile fetch return for a normal account, a suspended one and a nonexistent name?
- **V4. Arctic Shift.** Confirm `retrieved_on` and the captured body for recent comments, and how quickly new items are captured (this decides how often the 25 s rule can apply).

If V1 finds no working logged-out path, the fallback is: posts via E1/E4 (verified categories), and comments marked `removed-unknown` only when the archive or another signal shows removal. The spec then states that comment coverage is partial.

## 10. Out of scope (v1)

- Public mod logs (P15). Reveddit runs its own mod-log service; we won't depend on a third party for this.
- Other people's removals beyond what we already show.
- Appealing or messaging moderators (links to Reddit's own pages only).
- Old Reddit (`old.reddit.com`).

## 11. Open questions for the user

1. Should the Removed view be a list entry next to Saved and History (U2), or a filter in Feed options on your own profile, or both?
2. Notifications: is the toolbar badge enough, or are system notifications wanted from the start?
3. Should deleted-by-you items appear in the Removed view at all (default: hidden, with a filter to show them)?
