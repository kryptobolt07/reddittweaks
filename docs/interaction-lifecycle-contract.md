# Interaction and lifecycle contract

Applies to every feature that injects UI or data into Reddit's pages. Written 2026-11-12 from the bugs we actually shipped and fixed. A feature isn't done when it looks right in a settled screenshot. It's done when it behaves correctly **through** every transition below, with no flash, blank, jump, duplicate request or lost state.

Each feature spec lists which transitions apply (T…) and adds its own. The verify-loop's standing check S9 means: every applicable T-row has a `probe-timeline` run, native vs ours, with the expected sequence written down **before** the run.

## 1. How Reddit behaves (facts we must design around)

These are measured, not assumed. Each one caused at least one bug.

| # | Fact | Bug it caused (fix) |
|---|---|---|
| F1 | Reddit is a single-page app. Clicking a link changes the URL first, keeps the old page on screen while it fetches, then swaps `main` (about 0.1–2 s later). | We removed our UI on the URL change and the user saw a blank page (a7616c9). |
| F2 | Back and Forward **rebuild** search pages from scratch; Reddit never reattaches our old elements. Profile feeds are sometimes reattached. | Every Back reran the whole search (38d9f8c, 49f4b6f). |
| F3 | `history.replaceState` to the **same** URL makes Reddit's router reload the page. | Two reloads per filter change (f016b5f). |
| F4 | Reddit re-renders its header search (and our pills inside it) about 1 s after navigation and during hydration. Elements briefly disappear and come back as new nodes. | We took the disappearance as "the user removed the pill" and never re-added it (cbb2275). |
| F5 | On a fresh load Reddit may replace its page once during start-up, removing anything we inserted. | The list search restarted from page one (a7616c9). |
| F6 | The header search and several menus live in **shadow roots**. Our stylesheets don't reach them. | Pill icons and close buttons rendered at the wrong size (9ed47b4). |
| F7 | Reddit's custom elements may set attributes in their constructor. `document.createElement('rpl-…')` then throws on some pages; parsed elements are fine. | "The result must not have attributes" on community pages (20f305b). |
| F8 | Some Reddit elements render their own text (`faceplate-number`, `faceplate-timeago`). Adding our own text duplicates it. | "2020 votes" for 20 (20f305b). |
| F9 | Mobile and desktop use different elements for the same control (for example `filter-drawer` vs `search-sort-dropdown-menu`). | Filters missing on mobile (1f81e1c). |
| F10 | Reddit's markup changes without notice (test IDs, wrappers). | "Reddit's post search format changed" on every search (39efb7f). |
| F11 | Chrome's scroll anchoring moves the page when content above or at the anchor changes size; `display:none` loaders shorten the page. | Jumps past new posts and pulls back up at the halo (3f79a1b, 1d0685c). |
| F12 | Our own page CSS (`.rt-posts button`) can outrank a component's rules by specificity. | Pills 38 px tall until moved (52639aa). |
| F13 | The extension worker sleeps after ~30 s idle. Rebuilding the unpacked folder without reloading the extension can leave a browser (seen in Brave) unable to start it. | "Background worker is not responding" (2026-11-12). |
| F14 | Reddit's search results vary between identical requests minutes apart. | A "regression" that was only data drift (2026-11-06). |
| F15 | Background tabs and windows are throttled: timers, observers and lazy loads pause. | False "didn't load" verdicts in tests. |

## 2. Rules (how code must be written)

**State and ownership**

1. **One owner per element.** Every element we insert has one creator and one remover, both recorded in the feature's lifecycle audit. No other code removes it.
2. **Absence isn't intent.** A missing Reddit element (F4, F5) means "re-rendering" until proven otherwise. Only an explicit user action (click, key) or a changed route or scope means "gone".
3. **Keep what's loaded.** Leaving a view parks its state (data, cursors, filters, scroll) keyed by the full address. Returning restores it into whatever DOM Reddit rebuilt (F2). Never refetch what's already loaded unless it's stale by a stated rule.
4. **Progress is explicit.** Every loader records `loading / done / error / cursor`. Resume continues from the cursor; it never restarts because a generic "loaded" flag wasn't set (49f4b6f).
5. **Generations guard async work.** Every request carries the view's generation; a late answer for an old view is dropped, never rendered.

**Transitions**

6. **Nothing disappears early.** On navigation away, our UI stays until Reddit replaces the page (F1). On return, ours appears in the same frame as Reddit's (or earlier), never after it.
7. **Nothing native flashes.** Native content we hide stays hidden through the transition. Restoring it is deferred until Reddit has had time to replace it, and only happens if it's still connected.
8. **No redundant navigation.** Never write an unchanged URL (F3). One user action produces at most one load per source.
9. **Scroll is ours to keep.** Positions are document-relative. Loaders keep their space (`visibility:hidden`, not `display:none`). Our containers set `overflow-anchor:none` where Reddit's anchoring would misfire (F11). Restored views put the scroll back exactly once, without visible scrolling.

**Markup and styling**

10. **Build Reddit components the way Reddit does.** Create custom elements by parsing (F7). Let self-rendering elements render (F8). Copy Reddit's markup and classes from a live capture, not from memory.
11. **Shadow roots get inline styles** for anything we place inside them (F6). Page-level rules are scoped and specific enough not to fight Reddit (F12).
12. **Both layouts.** Every control is found by desktop and mobile selectors, and checked at 1280 px and at the 380 px floating width (F9).
13. **Parse defensively.** One unreadable item is skipped and counted; only a page where nothing is readable reports "format changed" (F10).

**Honesty and resilience**

14. **Unknown is never good news.** A failed or skipped check shows "Couldn't check", never a clean state.
15. **Live data drifts.** A live failure is reproduced against a direct Reddit request before it's called a regression (F14).
16. **The worker can sleep or be stale.** Messages time out with a clear message; the popup and pages tell the user to reload the extension when the worker can't start (F13).

## 3. Transition catalogue

Every feature spec marks which rows apply. "Expected" is what the user must see; the probe is `probe-timeline` (real clicks, foreground tab) unless stated.

| T | Transition | Expected |
|---|---|---|
| T1 | Direct load (typed URL, reload) | Our UI mounts once; no remount during Reddit's start-up swap (F5); Reddit's own loading skeleton until data. |
| T2 | Click into a post or item from our UI | Our view stays on screen until Reddit shows the post; no blank, no native flash, header pills stay until Reddit changes scope. |
| T3 | Back to our view | Loaded data and scroll restored with no refetch, in the same frame as Reddit's page; pills and filters with it. |
| T4 | Forward again | Same as T2 for the reopened page; no duplicate work. |
| T5 | Switch tab, sort or filter within the view | One load per change; the previous view's UI leaves immediately (it's replaced at once); the URL is written once and only if changed. |
| T6 | Infinite scroll / load more | Loader keeps its space; no jump; no duplicate pages; retries quiet unless repeated. |
| T7 | Reddit re-renders a host element (header, feed, tabs) without navigation | Our additions come back in the next frame; no state lost; nothing marked dismissed. |
| T8 | Open and close a menu or sheet; click it twice | Second click closes; outside click and Escape close; focus returns to the trigger. |
| T9 | Item edited, deleted or posted by the user | The affected item updates in place; no full rerender of the view. |
| T10 | Settings toggled in the popup | Applies to open tabs without reload; turning a feature off restores Reddit exactly. |
| T11 | Account switch or sign-out | Account-scoped data disappears at once; nothing from the old account renders. |
| T12 | Extension reloaded or updated | Old tabs show "Refresh this tab"; nothing half-works. |
| T13 | Worker asleep when a request arrives | It wakes and answers, or the request times out with the stated message. |
| T14 | Tab in the background, then foregrounded | Work resumes; no false errors from throttling (F15). |
| T15 | Desktop vs mobile layout, light vs dark | Same behaviour; controls present in both. |
| T16 | Old Reddit (`old.reddit.com`) | Feature stays off unless the spec says otherwise. |

## 4. How a spec uses this

A feature spec must include:

1. **Applicable transitions**: the T-rows it touches, plus feature-specific ones, each with an expected sequence.
2. **Lifecycle audit**: for each injected element, its creator, its remover and the triggers (route events, observers, settings, timers).
3. **Acceptance checks for transitions**: one per applicable row, stated as a timeline (for example "0–N ms: our rows visible; post appears; rows gone in the same frame").
4. **Where we lag**: the honest list of limits users will hit, with the wording the UI uses for each.
