# Spec: detect removals of your own posts and comments

Status: native-first Removed discovery, in-place own-item badges, per-account change history and opt-in toolbar counts implemented November 15, 2026 (§15). Public-view/account verification, closed-tab checks and system notifications remain unavailable. Earlier implementation status in §14 is historical.

This spec also follows the [interaction and lifecycle contract](interaction-lifecycle-contract.md). Its rules apply, and §13 lists the transitions this feature must pass. §12 lists where we'll fall short, and how the interface says so.

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

The "Ours (target)" column is the goal, not current state; §14 lists what is actually implemented.

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
| E2 | A **public view** of the same items: logged-out `api/info` by ID, or the logged-out thread HTML (`credentials: 'omit'`) | `[removed]` or `[deleted]` body, `collapsed`, removal notices, which is what others see | **Blocked for direct reads (V1).** Logged-out `api/info.json` returned **HTTP 403** on 2026-11-12, and every direct per-item route failed in phase 0. The credentialless anonymous frame now restores logged-out **profile search** for comments (public stream) and blocked-profile posts (see §9.1), but search listings are incomplete and do not expose an individual item's public thread view. |
| E3 | Arctic Shift records for your items | Body as first captured, `retrieved_on`, so we know whether it was visible or `[removed]` at capture and the latency since posting | Used today (opt-in archive) |
| E4 | Reddit's author banners on your own posts (`[slot="post-removed-banner"]`, "removed by the moderators", "removed by Reddit's filters") | Post removal source, as Reddit tells the author | Partly parsed today (`M.domStatus`) |
| E5 | Logged-out profile page for `/user/<you>` | 404 while the name is taken = shadowbanned or deleted; "suspended" notice | Unverified (V3); blocked like E2, and the anonymous search transport does not answer account checks |

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

U2 is built as a list entry (decided 2026-11-14, Q1); U1, U4 and U5 are not built yet, and U3 shows its blocked state. §14 tracks each one.

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
- Public-view checks (E2) carry **no owner-session cookies or tokens**. Direct reads use `credentials: 'omit'`; a credentialless browser frame may retain only cookies created inside its fresh, ephemeral anonymous partition. They must never reveal anything a logged-out visitor couldn't see. See [hidden browser search](public-browser-checks.md) for the separate, bounded search transport.
- Arctic Shift receives only item IDs or your username, and only when "Use the archive" is on.
- Background checks need `alarms`, and system notifications need `notifications`. Both are `optional_permissions`, requested when the user turns the setting on. No new host permissions beyond what V1 proves necessary.
- Strictly read-only: this feature never edits, deletes or reports anything.

Current state: the classification module adds no permissions of its own. The `alarms` and `notifications` optional permissions below belong to the unimplemented background and notification parts (§14); the manifest requests neither today.

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
| R10 | Labels and tooltips match Reddit's tone and state their evidence | A10: measured comparison with native Reddit's pills and tooltips (sizes, fonts, colours) and a copy review of every label; every label has a tooltip naming its source |
| R11 | Matches Reveddit's verdicts | A11: for 20 of the user's real items (L3, read-only), our state matches Reveddit's label, or the difference is explained by a documented rule |
| R12 | Every applicable transition in §13 behaves as stated | A12: one `probe-timeline` per row (native vs ours), with the expected sequence written before the run; zero flashes, blanks, duplicate requests or lost badges |
| R13 | Each limit in §12 is shown to the user in the stated wording when it applies | A13: fixtures that trigger each limit show its wording; nothing in a limited state reads as complete or clean |
| R14 | Badge state survives Reddit re-rendering (T7) and Back/Forward (T3/T4) without new requests | A14: request counters stay flat across re-render and Back; badges reappear in the same frame as their items |

## 9. Phase-0 live checks (decide the open data questions first)

Run read-only in the signed-in browser before building:

- **V1. Public view.** Which works from the extension for an item you know is removed: logged-out `api/info.json`, logged-out `/svc/shreddit/...` comment HTML, or the logged-out thread page? Record status codes, rate limits and the removed markers. This decides E2.
- **V2. Author view.** For your own removed post and comment, what do authenticated JSON and shreddit HTML show you (`removed_by_category`, `banned_by`, `removal_reason`, banners)?
- **V3. Account check.** What does a logged-out profile fetch return for a normal account, a suspended one and a nonexistent name?
- **V4. Arctic Shift.** Confirm `retrieved_on` and the captured body for recent comments, and how quickly new items are captured (this decides how often the 25 s rule can apply).

### 9.1 Results (2026-11-13, signed-in Chrome, read-only, your newest 100 comments and 100 posts)

| Check | Result |
|---|---|
| V1 public view | **No direct logged-out path works from the extension.** Without cookies, from the Reddit page or from the extension worker, these all return HTTP 403 with Reddit's block page: `api/info.json`, `by_id`, `api.reddit.com`, comment-permalink `.json` and `/comments/<id>.json`. The `svc/shreddit/comments/…` partial and `svc/shreddit/comment/…` are blocked the same way. The logged-out thread HTML loads (200), but it is only a shell: the comments come from that blocked `svc` partial. old.reddit.com redirects logged-out requests to its login page. **Update (0.32.2):** the credentialless anonymous frame now restores logged-out **profile search**: comment search for public streams, and post search for explicitly blocked profiles. The route is allowlisted to `/svc/shreddit/search/`, so there is still no per-item public thread view. |
| V2 author view | **Posts:** your listing carries `removed_by_category` (15 of 100 posts say `moderator`) and `locked`, so posts are fully determinable. **Comments:** every moderation field is null for all 100 (`removal_reason`, `banned_by`, `mod_reason_*`, `collapsed*`, `comment_type`), so your own data can't show a comment removal. Still unverified for a comment known to be removed (none was known). |
| V3 account check | Not run separately: it needs the same logged-out fetch that V1 shows is blocked. |
| V4 Arctic Shift | **Posts** are captured within a median of **18 s** (87 of 100 within 25 s) and carry `removed_by_category`, so the 25 s rule works for posts. **Comments** are captured within a median of **~4 h** (minimum 7 min, none within 25 s), and the `author=` comment search sometimes times out and needs `sort=desc`. None of your 100 comments was captured as `[removed]`. |

**Initial observation (2026-11-13):** a brand-new, cookie-free browser context received Reddit's **"Prove your humanity"** challenge page instead of the thread. Its only cookie was `edgebucket`, and the tested JSON and `svc` requests returned 403 even with its anonymous cookies included. This establishes failure in that context; it does not establish that all signed-out browser sessions are blocked. A subsequent credentialless browser-frame test hydrated Reddit's signed-out homepage and successfully fetched native comment-search HTML. See [hidden browser search](public-browser-checks.md). Follow-up commits made that transport reliable for logged-out profile search: native initialization is awaited, the homepage navigation uses a real origin-only referrer, Reddit's own JS verification is allowed to finish, and a verified anonymous session is reused for later reads (`18daef4`, `cec6f1a`, `5ffba1f`, `c3e4d90`, packaged as 0.32.2). Comment search uses it for the public discovery stream; post search uses it for explicitly blocked profiles. It is still a **search/list** transport: scanning a profile's visible items is not the same as verifying one item's public thread visibility, so it does not by itself classify a removal. Interactive CAPTCHA handling remains with the user.

Also found: Reddit now issues **13-character comment IDs** (e.g. `19sh…`); post IDs are still 7. Our comment ID checks allow up to 32 characters; post ID checks allow 10.

**Current implementation (2026-11-14):** the pure classifier `RTRemovalModel.classify` and its helpers exist, are unit-tested, and are loaded by the manifest, but nothing calls them. Posts classify from Reddit's author-visible categories and the archive. Comments classify only from an archive capture of the removal, and otherwise read "Couldn't check". The account check (U3) is unavailable. The anonymous browser transport restores logged-out profile search for posts and comments, but no per-item public verification or account check is built on it. Userless OAuth remains an open route (§11, Q4). See §14 for the full implemented/not-implemented split.

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
4. Comments can't be checked as others see them (§9.1). Should we offer an opt-in where you register your own Reddit app (client ID pasted in the popup) so comments can be checked through a userless token? Without it, comments show only what the archive saw. Still open: the anonymous transport covers profile **listing** searches, not per-item public views.

## 12. Where we'll lag behind (caveats)

These are known limits, not bugs. Each one is shown to the user in the wording given, never hidden.

| # | Limit | Why | What the user sees |
|---|---|---|---|
| L1 | Comments may not be checkable at all from the extension | Reddit refuses a direct logged-out view (`api/info` and every per-item route returned HTTP 403; Reveddit notes the same from its extension). The anonymous transport only searches profiles, so it cannot verify one comment. | Comments: "Couldn't check: Reddit blocks logged-out checks of comments. Turn on 'Use the archive' to catch removals the archive saw." Posts still work from what Reddit tells the author. |
| L2 | Mod vs automatic is a guess for comments | It relies on when the archive captured the comment. Arctic Shift often captures hours later, so the 25 s rule rarely applies to fresh comments. | "Removed: moderators or automatic" until evidence decides; the tooltip says why. |
| L3 | No mod-log evidence | Reveddit reads subreddits' public mod logs through its own service; we don't (§10). | Fewer confident "Removed automatically" verdicts than Reveddit on subreddits with public mod logs. |
| L4 | Only your newest 1,000 posts and 1,000 comments from Reddit | Reddit's listing limit | "Checked your newest 1,000 comments"; older ones only if the archive has them, labelled "from the archive". |
| L5 | Private and quarantined communities | A logged-out view can't see them, so "others can't see it" is always true and meaningless | "Can't check: private community" (or quarantined); never "removed". |
| L6 | Detection isn't instant | Checks are batched and spaced (§6); notifications run only while the browser is open | Badges show "Checking…" until the first result; the popup shows "Last checked 12 min ago". |
| L7 | Approval and unlock are seen only if we recheck | We recheck removed items on a schedule, not live | Restored items clear on the next check; the time of the last check is shown. |
| L8 | Account-level shadowban check can be wrong right after a name change or a deletion | It infers from a logged-out profile 404 | "Your profile looks hidden to others (could be a shadowban or a temporary Reddit issue)". |
| L9 | Crowd Control collapse may need a full thread read | It isn't on item listings | Shown only on threads you open, not in the Removed view, unless V1 finds a cheap source. |
| L10 | Reddit's markup and data change without notice | Shared risk (contract F10) | One unreadable item is skipped and counted; the view says "Some items couldn't be read". |

## 13. Transitions this feature must pass

From the contract's catalogue, plus rows specific to this feature. Each row is an acceptance check under R12. None of these transitions exist yet: there is no injected UI, schedule or cache to exercise (§14).

| T | Transition | Expected |
|---|---|---|
| T1 | Load your profile or a thread directly | Badges appear once per item, after its check; no remount during Reddit's start-up swap; items wait in "Checking…" rather than blank. |
| T2 | Open one of your items from the Removed view | The view stays until Reddit shows the post; the pill on that item is visible on the post page too (same state, no recheck). |
| T3 | Back to the Removed view | List, filters, checked range and scroll restored instantly; zero new checks. |
| T5 | Change a filter in the Removed view | Filters apply to loaded results locally; no rechecks; the URL is written once. |
| T6 | Scroll your profile or a long thread | Badges are added as items appear, and Reddit's virtualized comments get their badge back when they scroll back in. |
| T7 | Reddit re-renders a comment or thread (sort change, "load more replies", collapse/expand) | Badges reattach in the next frame from cache; no new requests. |
| T9a | You post a new comment | It shows "Checking…" and is checked at about 30 s and 5 min (automatic removals are fast); if removed, the pill appears in place and the badge count rises. |
| T9b | You edit a comment | Its state is kept and it's rechecked once (an edit can trigger AutoModerator). |
| T9c | You delete a comment | It becomes "Deleted by you" and leaves the Removed view (unless that filter is on). |
| T10 | Turn the feature off in the popup | Every badge and the Removed entry disappear from open tabs without reload; background checks stop; the cache stays until cleared. |
| T11 | Switch account or sign out | Badges and the Removed view clear at once; nothing from the previous account shows; checks restart for the new account. |
| T12 | Extension reloaded or updated | Open tabs say "Refresh this tab"; no stale badges keep updating. |
| T13 | Worker asleep during a background check | The alarm wakes it; a missed check is caught up once, never repeated in a burst. |
| T14 | Tab in the background | No checks from hidden tabs; background checks are the worker's job only. |
| T15 | Mobile layout and dark mode | Pills, the Removed view and filters work and match Reddit in both. |

**Lifecycle audit to complete before building:** for the badge pill, the Removed view's header pill, its feed, its filters and the popup badge, record the creator, the remover and every trigger (route events, `MutationObserver` on threads and feeds, settings changes, account changes, alarms, cache updates). Each trigger becomes a transition row above if it isn't one already.

## 14. Historical implementation status (2026-11-14; superseded by §15)

This is what exists in the current bundle; everything else in this document remains the target.

### Done

| Item | Where | Notes |
|---|---|---|
| Pure classification model | `extension/removal-model.js` (commit `1f1ccf2`) | `RTRemovalModel.classify` applies §4.2 rules 1–8 in order, including deletion precedence, Reddit/admin/filter categories, the 25 s `AUTO_LATENCY` rule, archive-visible → moderator, approval after removal, private communities → "Couldn't check", and failure → "Couldn't check". It never reports `visible` without evidence. |
| Evidence normalisation and helpers | same file | `evidence()` normalises Reddit and Arctic Shift records; `isRemovedBody()`; `STATES` labels; `change()` computes `removed` / `approved` / `locked` / `unlocked` transitions for future notifications without duplicates. `classify` also carries `locked`, `collapsed` (Crowd Control), `approved-after-auto` and `quarantined-community` flags. |
| Manifest load | `extension/manifest.json` (commit `7282c51`) | Loaded with the post scripts before `post-discovery.js`. It defines only `RTRemovalModel`, has no side effects, and adds no permissions. |
| Unit tests | `tests/removal-model.test.cjs` | 10 tests over synthetic fixtures: all rule branches, 25 s and 26 s boundaries, missing archive, archive `[removed]`, deletion precedence, approvals, private communities, flags, and change detection. All pass. This covers A1 and the model half of A2. |
| U2 Removed list | `post-discovery.js` (`classifyRemoved`, `summarizeRemoved`, `removalPill`), `post-page-bridge.js` (`list:'removed'`), `post-broker.js` (`archive-removal`) | "Removed" in your own profile's List menu (`/user/<you>/search/?rt_list=removed`), with the same header pill, tabs (All, Posts, Comments, Media), query and Feed options filters as Saved and History. The bridge reads your signed-in `overview.json` (100 per page, up to Reddit's 1,000) and keeps only the author-visible moderation facts (`removed_by_category`, whether `removal_reason` is set, `locked`, `subreddit_type`, `quarantine`, your text); another author's item makes the page malformed. Posts classify from those facts. Comments classify only from the archive's first capture (`archive-removal`: ≤25 IDs, your own profile only, needs "Use the archive", your records only). Each row carries one state pill with the evidence as its tooltip. The summary reads "Checked your newest N posts and comments · K removed"; the notes say how many comments couldn't be checked and why, that the account check is blocked (U3), and when Reddit's 1,000 cap applies. An archive failure leaves comments as "Couldn't check" with a note. Tests: `tests/removed-list.test.cjs`. |
| Anonymous public profile search | `extension/public-browser.js`, `post-page-bridge.js` (commits `18daef4`, `cec6f1a`, `5ffba1f`, `c3e4d90`, packaged 0.32.2) | An invisible credentialless iframe runs Reddit's native signed-out flow and reads the allowlisted `/svc/shreddit/search/` route. It serves the public **comment** discovery stream for profiles and **post** search for explicitly blocked profiles. One frame per page, at most two pending reads, 60 s idle removal, 10 min refusal cooldown, bounded `Retry-After`, verified-session reuse. It has no per-item public thread view and no account check, so it does not feed the removal model. |

### Not implemented

| Item | Status |
|---|---|
| U1 in-place badges | Not started. On thread pages Reddit already shows authors a removal banner on their posts; comments have no evidence without the archive, so badges would mostly read "Couldn't check". |
| U2 extras | No separate "Removal source" filter (the pill and the query cover it); no "View as others" action, because no logged-out view works from the extension (V1). Deleted items are hidden (Q3 default). |
| U3 account check | Shown as a fixed "Couldn't check … Reddit blocks logged-out checks" note; no request is made. |
| U4 notifications and toolbar badge, U5 popup settings | Not started. Background checks would need Reddit reads outside a Reddit tab, which conflicts with keeping credentials in Reddit's page world; the Removed list is checked on demand instead. |
| E2 per-item public view (thread HTML or `api/info`) | Still blocked by Reddit; the anonymous transport covers profile search only. |
| E5 account-level check | Not started; same blocked direct route. |
| C1–C5 checks, batching, scheduling, caching | Not started. No `alarms`, no per-account cache, no request budget. |
| `alarms` / `notifications` optional permissions | Not requested. |
| A3–A14 (badges, view, account lines, notifications, limits, privacy, copy, Reveddit parity, transitions) | Not run; no surface exists to test. |

### Summary

The feature today is the unit-tested classification core plus the on-demand **Removed list** (U2) on your own profile. The latest 0.32.2 work fixed logged-out **profile search** (public comment discovery and blocked-profile post search) in the anonymous frame; it did not add per-item public verification, so it does not change how comments are classified. Remaining work is U1, U4 and U5, which depend on a public-view route that Reddit currently blocks.

## 15. Native-first monitoring increment (2026-11-15)

This increment supersedes legacy-JSON assumptions in §§4, 6, 13 and 14 for new removal work. It extends the existing classifier and Removed view rather than building another discovery feed. Removals monitoring is opt-in; no content writes, public-view bypasses, new host permissions, or public Data API credentials are introduced.

### Parity and limits

| Capability | Increment | Limit shown to the user |
|---|---|---|
| Own-item badges (U1) | Native ownership, moderation state and notices; matching archive evidence when enabled; cached badges reattach to replacement cards | Missing native evidence is “Couldn’t check”; author-visible text and UNMODERATED are not proof of public visibility |
| Removed view (U2) | Native overview HTML and its validated newest-first continuation, with existing filters and archive classification | Native listing/search coverage may be incomplete; no invented 1,000-item completeness claim for HTML |
| Identity | Logged-in app ID plus native account drawer/author-ID mapping; no `/api/me.json` needed for Removed | Unresolved or conflicting identity stops the check; viewing a profile does not establish ownership |
| AutoModerator | Explicit native automatic-removal evidence, or archive removal within 0–25 s labelled likely | Plain REMOVED/SPAM does not identify the actor; historical capture alone does not establish current visibility |
| Change history and toolbar count (U4) | Local per-account verdict cache, bounded recent changes, opt-in unread count; no duplicate changes across tabs/reloads | Monitoring operates while browsing Reddit, not with all Reddit tabs closed; initial historical discoveries do not trigger alerts |
| Popup (U5) | Monitoring/notification preferences, current account summary, recent changes, open Removed and clear own monitoring data | No active signed-in Reddit page means no account summary; no other account's history is substituted |
| Account shadowban/public view (U3/E2) | Existing explicit unavailable state retained | No inference from an empty search, an unavailable native card, or a failed request |

Native inspection through the approved Chrome relay found `shreddit-app[user-logged-in][logged-in-user-id]`, an account-specific native user-drawer partial, post `author-id` and `item-state`, and profile comment author identity in its matching overflow control. The profile comment's `user-id` is the **viewer**, so it must never establish authorship. Evidence and styles are recorded under ignored `artifacts/research/api-phaseout-2026-11-15/native-removal-*.json`. No live writes were made. Further CDP use is limited to one targeted read-only installed verification; synthetic tests cover state combinations unavailable live.

### Expectations and proof

| ID | Observable expectation | Proof |
|---|---|---|
| N1 | Removed identity/list discovery makes zero legacy `.json`/`/api/` requests | Bridge tests with native fixtures reject any legacy request |
| N2 | Native author IDs/names must match the authenticated identity; viewer IDs, profile URLs and quoted replies cannot claim ownership | Native reader tests, including long comment IDs and foreign-author fixtures |
| N3 | Empty categories, UNMODERATED, failed reads, and missing cards never prove visible/approved | Model tests with incomplete native evidence; archive-only verdicts remain likely and do not prove current approval |
| N4 | Automatic, moderator, Reddit/filter, unknown and self-deleted verdicts preserve confidence/source | Model/reader tests; negative/late archive timestamps cannot identify AutoModerator |
| N5 | Persist only bounded account-scoped metadata/verdicts, not comment bodies or credentials | Store/broker tests for account isolation, caps, TTL, concurrent updates, deduplication and clear |
| N6 | Visible native own cards get one badge; re-renders and Back reuse cached results; hidden tabs pause optional requests | Monitor DOM tests with request counters and cancellation |
| N7 | Popup/settings changes stop/restart observers cleanly; identity changes remove prior account badges immediately | Monitor/popup integration tests; late responses cannot update another account |
| N8 | Notifications count transitions, never failed checks, initial history, duplicate reports or history opened in the popup | Store/broker tests, including worker restart and account switching |
| N9 | Native continuations stay on the same profile/source/sort and reject repeated/foreign cursors | Bridge pagination tests; existing Removed filters and scroll snapshots retained |

### Lifecycle ownership and transitions

The native reader owns no DOM. The existing Discovery owns the Removed header/feed/filters and its route snapshots. The monitoring controller alone creates/removes in-place badge nodes, observers, pending reads and its timers. The worker owns serialized per-account cache/change writes and tab-scoped toolbar badges. The popup owns its current-account summary and clears only that account's history.

| T-row | Expected sequence |
|---|---|
| T1 | Wait for authenticated native identity/card metadata; mount badges once; a startup host swap reattaches them without restarting loaded work |
| T2/T4 | Keep badges on connected outgoing cards until Reddit replaces them; validate the new route before publishing async work |
| T3 | Restore the existing Removed route snapshot/scroll; attach cached badges without fresh archive reads |
| T5 | Existing local filters use loaded results; one URL update; native listing continuations remain scope-bound |
| T6/T7 | Newly visible own cards are checked once per freshness window; replacement hosts reuse verdicts; no comment skeletons or feed remount |
| T8 | Popup controls remain keyboard accessible; opening change history acknowledges that account only |
| T9 | Native metadata/body changes invalidate only the affected observation; self-deletion never becomes a removal alert |
| T10 | Turning monitoring off aborts pending work, removes its badges and toolbar counts, preserves cached history; archive-off prevents archive reads |
| T11 | Account switch/sign-out cancels the generation and clears visible prior-account state before any new reads |
| T12 | A disconnected extension stops checks and exposes refresh guidance rather than claiming successful checks |
| T13 | Worker restarts recover stored metadata; duplicate reports remain idempotent; no alarm or background credential storage |
| T14 | Hidden tabs pause checks; foreground resumes bounded stale work once without a catch-up burst |
| T15 | Reuse existing native metadata/pill classes and theme tokens; wrap within the card at narrow widths; no fixed-height spacers |
| T16 | Off on Old Reddit |

Standing checks S1–S9 apply to page/popup surfaces; chat layout changes are n/a because no chat UI is changed. Native style measurements precede implementation. Logic, transitions, account isolation and zero-legacy-transport checks are synthetic tests; live claims are restricted to the final measured read-only pass. No preview browser or destructive live test is used. System notification delivery, closed-tab monitoring and unrestricted logged-out verification are not claimed by this increment.

Storage implementation: `removal-store.js` and `removal-broker.js` persist metadata only, serialize writes per account, retain a last-known verdict through failed checks, and verify the current native tab identity before accepting reports or exposing popup history. Initial observations establish a baseline; only later transitions enter change history. N5/N8 are covered by `tests/removal-store.test.cjs` and `tests/removal-broker.test.cjs` alongside the existing worker/cache regressions.

Current monitoring behavior: native metadata is observed as Reddit loads or updates cards; no independent polling/crawl or closed-tab alarms run. Optional archive checks batch at most 25 own IDs per kind and reuse the shared backoff/transport. In-memory verdicts are reused for ten minutes; native evidence changes invalidate the affected item. The account store is capped at 5,000 metadata records and 50 changes; the popup shows the newest 20. Hidden tabs pause enrichment. The existing Removed-view safety budget remains 1,000 loaded items, labelled as a local stop rather than an HTML/API completeness limit. Tests cover cached reattachment, duplicate hosts, native text edits, authorship changes, archive-off, stale account responses, worker restart, and popup acknowledgement/clear controls.

## 16. Signed-out item verification correction (2026-11-15)

This supersedes §15's metadata-only visibility limitation. Reuse the **existing** credentialless native-browser session used by unsigned profile search. A read-only Chrome probe confirmed HTTP 200 with an exact matching profile-comment fragment and post fragment from that signed-out session, while the parent stayed authenticated. A full comment page did not yield an exact static item and is not used as evidence. No challenge parser, remote patterns, alternate request styles, ordinary authenticated fallback, or new JSON endpoint is added.

| Requirement | Acceptance |
|---|---|
| Public visibility comes from a separate viewer | The current signed-out browser fetches only the allowlisted native item fragments; frame authentication/partition checks remain unchanged |
| Check only the authenticated user's observed items | Bridge accepts an exact fullname, resolves ownership from current native DOM or its verified own overview listing, rejects foreign/unseen IDs and caller-supplied URLs/headers |
| Parse what Reddit actually returns | Native profile comments can use `id="-post-rtjson-content"`; exact-ID and author checks, content/notice validation, and native metadata precede a verdict |
| Positive evidence | Exact item with readable matching content → visible; explicit removed/deleted markup → that state; missing/unreadable/gated/403/429/challenge → unknown |
| Fresh public evidence beats stale owner metadata | Fresh readable fragments resolve unknown visibility. Readable text alone does not prove a known moderator removal was reversed; fresh approval evidence can clear it. A fresh removed fragment cannot be overridden by an author-visible body/APPROVED state |
| Search absence is not removal evidence | No verdict is based on omission from an author search or cursor exhaustion |
| Metadata/archive remain supporting evidence | Native removal causes and archive timing may identify the actor; old archive removal cannot override fresh public visibility |
| No per-item unknown spam | Visible and unknown items have no in-place badge; unchecked coverage remains in the popup and Removed-view summary |
| Reuse and isolation | Successful exact-item checks cache for ten minutes, failed checks for one minute; body/metadata changes or explicit refresh invalidate the affected proof. New checks share the existing anonymous frame/session and queue. A refused item endpoint must not discard a healthy search session |
| Lifecycle | T1/T6/T7: check new visible own items, deduplicate identities and reattach cached badges; T2–T4: preserve views/cache and discard old-route responses; T9: invalidate one edited item; T10/T11: abort checks on disable/account change; T14: pause hidden tabs. No closed-tab crawler |

Proof levels: unit tests first for allowlists, parser, classifier precedence, cache provenance, unknown UI, ownership, cancellation and source integration. Minimal read-only live source probe is recorded under `artifacts/research/verify/unsigned-removal/transport-probe.json`; final installed checks are restricted to a small read-only sample. Reveddit's supplied description is reference context only; the earlier local source copy was unavailable and is not needed for the implementation. Main verification must distinguish healthy source extraction from actual known-removed samples, which may only have synthetic coverage.

§16 implementation evidence: successful proofs carry their source/status/time through the metadata cache; pre-0.37.1 metadata-only verdicts cannot suppress the first signed-out check or generate approval notifications during migration. Item-level refusals preserve the healthy anonymous search frame and pause only that item; rate limits still pause the shared transport. Route changes and cancellation cannot coalesce new work with a cancelled old read, and native cards arriving during a read are checked after it settles. Unknown/visible badges are omitted; the popup and Removed summary report coverage. The supplied Reveddit description was sufficient reference; no Reveddit download or challenge-solver code was used.


## 17. Own-profile Removed entry (2026-11-15)

Expose the existing Removed view from **Feed options → Activity → Removed** on the authenticated user's Overview, Posts and Comments tabs. Reuse the current native menu row, removed icon, keyboard handling and navigation; no new detector, archive scan, timer or API transport is introduced. Overview opens `rt_list=removed&type=all`, Posts opens `type=posts`, Comments opens `type=comments`. The destination's existing All/Posts/Comments tabs remain usable. The existing Deleted activity filter retains its present behavior, including verified deletion/removal recovery; this entry opens the separately verified own-removal list. Deleted items not listed by Reddit cannot be recovered by this entry and must never be inferred from absence.

| Target | Acceptance |
|---|---|
| Own-profile gating | Current native account identity must match the viewed username; absent identity, sign-out, another profile and archive-only pages offer no entry. Stale saved username is insufficient |
| Scope | One navigation to the existing Removed route, selecting All/Posts/Comments to match the source view; no scan begins just from mounting/opening the menu |
| Native reuse | Existing rpl-menu-item row, removed glyph, submenu focus/keyboard/close handlers; no new CSS or standalone filter control |
| T1/T7 | Identity arriving after menu mount inserts one entry; repeated scans/native menu replacement retain one entry |
| T2/T3/T4 | Use existing real-link navigation and parked profile/search restoration; no new history/scroll logic |
| T5/T8 | Click/Enter/Space closes Feed options, navigates once and preserves source content scope |
| T10/T11 | Existing discovery opt-out restores the menu; native account loss/change removes entry and an old detached entry cannot navigate |
| T12–T16 | Existing extension recovery, paused-tab, responsive/theme and Old Reddit behavior unchanged; no new background work |

Lifecycle: ensureActivityMenu creates/rebuilds the own-profile entry on current native identity, its existing teardown removes it when menu/route/settings change, and activation checks identity again. Tests are written before implementation for entry visibility, typed destination, no eager checks, keyboard activation, late identity, account changes and native host replacement. Prior native-profile menu measurements and the committed native-profile-controls fixture supply native markup; no new presentation is introduced. Per user preference final live installed review is left to the user, with no CDP or constructed preview for this addition.

## 18. Signed-in vs signed-out profile comparison (2026-11-16; supersedes §16's per-item scan)

Measured live on the user's account (read-only, 2026-11-16): one signed-out item read per profile item (~1,000) made
Reddit refuse further signed-out reads (HTTP 403) after ~200, leaving most comments unchecked and letting a stale
archive snapshot decide (a post approved after an early AutoModerator removal showed as "removed"). Signed-out author
search found only ~220 items (search coverage is incomplete). Through the existing credentialless anonymous session,
the profile as a signed-out visitor sees it loads page after page (HTTP 200, 25 items), and single signed-out item
reads work. A plain cookieless request gets page 1 only (403 on continuations). Page 1 for visitors is a cached copy:
the 4 newest comments were missing there yet visible when read directly.

### Approach

- **P1 Bulk visibility.** Walk the signed-out overview (`/user/<you>/?sort=new` and its `profile_overview-more-posts`
  continuations, anonymous session only, own profile only) alongside the signed-in walk, newest first, only as far
  back as the items being checked. An item present there is publicly visible (`source: signed-out-profile`).
- **P2 Direct checks for differences only.** An item absent from the signed-out pages that cover its time, newer than
  the signed-out page 1 (cache lag), or older than signed-out coverage (walk stopped) gets one signed-out item read.
  At most 50 a scan, one at a time; the rest stay unchecked. Absence alone is never removal evidence.
- **P3 Removed, then deleted.** With the archive enabled, Arctic Shift author history over the scanned time span adds
  items no longer on the profile whose archive shows a moderator, Reddit or AutoModerator removal
  (`removed_by_category` at capture or `_meta.removal_type` at its re-check). Self-deletion alone (`deleted`) is not
  shown. These rows say "Removed, then deleted by you". Fresh signed-out visibility always beats archive evidence.
- **P4 Entry.** Removed is a list beside Saved, History, Hidden, Upvoted and Downvoted (same list switcher and header
  pill), reachable from the own profile like the other lists.

### Limits

Signed-out reads still depend on Reddit's anonymous session; a refusal stops P1 and leaves P2's budget to the
newest differences, reported as unchecked. Visitors' page 1 can lag minutes behind. Arctic Shift records are
snapshots with their own gaps; P3 lists only what it captured.

### Transitions

| T | Transition | Expected |
|---|---|---|
| T18.1 | Signed-out walk refused mid-scan | Already-seen items stay visible; later items take direct checks within budget, the rest unchecked with the reason |
| T18.2 | Account switch during the walk | Both walks stop; nothing from the old account is classified |
| T18.3 | Leaving the Removed list | Walks and direct checks are cancelled |
| T18.4 | Archive off | P3 is skipped and said so; P1/P2 unchanged |
