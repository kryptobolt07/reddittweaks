---
name: verify-loop
description: Spec-first, measure-native-first build and verify loop for Reddit Tweaks extension changes. Use when implementing or fixing any extension feature or UI (chat search, profile discovery, archive, popup), when asked to "test", "verify", "check it works", "validate", or prepare a release. Captures Reddit's own component programmatically before building, builds with Reddit's own markup and elements, checks with unit tests, the fixture browser and targeted read-only live comparisons, fixes real causes (at most 3 attempts per expectation), and records the evidence. The main agent verifies its own work; there is no judge panel (the council is archived in .claude/skills-archived/).
---

# Verify loop (Reddit Tweaks)

Goal: ship changes that match native Reddit, including its transitions, sizes and loading order, without the user checking each change by hand. Evidence beats impressions: every "pass" needs a command and a measured value. Anything you couldn't check is reported as **not verified**, never as passed.

Tools and commands: [reference/tools.md](reference/tools.md). Templates: [templates/spec.md](templates/spec.md), [templates/validation.json](templates/validation.json). Reddit facts and transition rules: `docs/interaction-lifecycle-contract.md`.

## 0. Start
- Follow `AGENTS.md`: `git status`, keep unrelated user changes (stage explicit paths only), and branch off main if you're on it.
- Working folder: `artifacts/research/verify/<slug>/` (git-ignored). Captures, dumps and private notes go there.

## 1. Spec first (before editing code)
Copy `templates/spec.md` to the working folder and fill it in. It's a spec sheet, not a step plan. The user prefers parity targets, acceptance checks, honest limits and transitions over task lists.
1. **Expectations (X1…)**: what must be observably true, the level that proves it, and the exact evidence (a test name, or a probe and the value it must show).
2. **Standing checks S1–S9**: mark one n/a only with a reason. S9 lists every applicable transition (T-rows) from the lifecycle contract with its expected on-screen sequence.
3. **Code lifecycle audit**: for each region the change touches, find what creates, replaces or removes it, and what triggers that. Each path becomes a transition row.
4. **Out of scope**: list what you notice; don't change it in this loop.

## 2. Measure native Reddit first (L3, read-only, targeted)
Before building anything that should look or behave like Reddit, capture Reddit's own version of it **as data**, not as screenshots.
- **Markup**: dump the native component's outerHTML, including shadow roots (`shadowRoot.innerHTML`), with tracking attributes and SVG bodies stripped.
- **Computed styles per state**: idle, hover, focused, typed, results, empty, error. Record box sizes and positions, padding, margin, gap, border, radius, font weight, size and line-height, colours and transitions (`styledump.mjs`-style deep dump; see tools.md).
- **Behaviour**: which keys do what (Enter, Escape, empty vs typed), what happens on blur, what the URL becomes, what a click opens and where the page scrolls. Drive it with real CDP input events.
- **Timing and order**: when each part appears on a direct load and after a click (post, toolbar and comments for example). Use `probe-timeline`, or a polling loop that records the first time each selector has height.
- Write `FINDINGS.md` in the working folder with the measured numbers, and settle any contradiction (for example "inline or collapsed?") by measuring again at the user's real window size before building.
- Keep browser use minimal and targeted: one tab, closed afterwards. Don't touch the user's other tabs.

## 3. Build with Reddit's own pieces
- Prefer Reddit's own custom elements and classes when they're defined on the page (`faceplate-search-input`, `rpl-input-chip`, `shreddit-comment` attributes such as `is-highlighted`). Check `customElements.get()` from the page world first. Fall back to CSS only for what Reddit's page stylesheet lacks, using the measured values.
- Create Reddit custom elements by parsing markup, never with `document.createElement` (it throws once they're defined).
- The extension's isolated world can't read Reddit element properties (for example `faceplate-search-input.value`). Read and write the element's inner `textarea` or `input` instead, and listen for keys in the capture phase.
- Respect the load order you measured: insert extension UI in the same frame as the native content it belongs to, never before it.

## 4. L0/L1: static and unit (seconds; loop here first)
- `node --check` every changed `.js` or `.mjs` file.
- Run the relevant `tests/*.test.cjs`, then the full `npm test`. **Read the failure list before committing**: packaging tests fail on extension files the manifest doesn't reference. Add tests for every expectation that logic can prove. Synthetic data only.

## 5. L2: fixture browser (where a fixture exists)
- `node scripts/live/fixture-browser.mjs` in the background, then `RELAY_PORT=9334`. Pages: `demo/` (chat: full, floating and dark) and `demo/tweaks/` (profile discovery).
- Use it for surfaces with no live data needed, such as chat chips and floating layouts. Measure computed values there the same way as live.
- Loop rules: fix the real cause, never the test or the probe. At most **3 attempts per failing expectation**; then stop and report with the evidence. Don't widen the change to make something pass.

## 6. L3: compare ours with native live (read-only)
1. `npm run package`. Reload the extension (tools.md: keep the popup tab open about 1.5 s) and confirm the version it prints.
2. Run the same dump as in step 2 on our version, and **diff the numbers**: sizes, offsets, fonts, colours and every state. A match means equal to within 1 px. Explain any remaining difference (for example, banned-community pages use Reddit's older colour palette) or fix it.
3. Re-run the timing check for load order and transitions.
4. Strictly read-only: no voting, joining, posting, commenting, saving, reporting or settings changes. If live data isn't available, the result is **not verified (reason)**.
5. Close your tab, stop the relay and delete the relay token (`artifacts/research/live-probe/relay-token*`).

## 7. Release (only when packaging a release bundle)
Full suite, then integrity checks:
`python3 -m zipfile -t artifacts/reddit-tweaks-v<ver>.zip`, `sha256sum` on it, and source vs stable-folder byte equality:
`(cd artifacts/reddit-chat-search && find . -type f) | while read f; do cmp -s "extension/$f" "artifacts/reddit-chat-search/$f" || echo "DIFF $f"; done` (no output = equal).
Choose the version bump per `AGENTS.md`. Release notes say what was measured live and what wasn't.

## 8. Record and commit
- For a release, write `artifacts/validation-v<version>/validation.json` from the template, including the native-vs-ours measurements.
- Commit per `AGENTS.md`: small coherent commits, conventional subjects, explicit paths, staged diff inspected. Never commit `artifacts/`, captures, tokens or private data.

## 9. Report to the user
Start with the outcome. Then the measured comparisons (native vs ours, with numbers), what wasn't verified and why, and anything that needs the user. Keep progress updates short while working.

## Pitfalls learned the hard way
- **Settled screenshots miss timing bugs.** Measure appearance order and transitions with real clicks; direct loads skip the client-side router.
- **Measure, don't eyeball.** The user wants programmatic, accurate values; screenshots are for a final glance only.
- **Native first.** Before calling something a defect, check native Reddit on the equivalent page at the user's real window size.
- **Background tabs and windows are throttled.** Use one foreground tab with focus emulation on.
- **The relay's event buffer drains per session.** Enable Log, Runtime and Network before acting, and read the events soon after.
- **The extension service worker sleeps.** Wake it by opening a feature page, then attach to it.
- **Reddit challenges cookieless and headless sessions** ("Prove your humanity"). Never try to get past it. Real-Reddit checks happen only in the user's signed-in Chrome.
- **Never stage files you didn't change.** The user often has their own work in progress.
- **A judge panel is optional and off by default.** If the user asks for an independent review, the archived council in `.claude/skills-archived/council/` can still be used once (see that folder's README).
