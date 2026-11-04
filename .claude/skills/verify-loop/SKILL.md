---
name: verify-loop
description: Spec-first test-and-fix loop for Reddit Tweaks extension changes. Use when implementing or fixing any extension feature or UI (chat search, profile discovery, archive, popup), when asked to "test", "verify", "check it works", "validate", or prepare a release. Writes observable expectations first, then checks them at increasing cost (unit tests, headless fixture browser, signed-in Chrome), fixes real causes with at most 3 attempts per expectation, runs the council for judging, and records validation.json.
---

# Verify loop (Reddit Tweaks)

Goal: you test your own change, judge it against what was expected and fix it in a loop, so the user doesn't have to check each change by hand. Evidence beats impressions: every "pass" needs a command and a measured value. Anything you couldn't check is reported as **not verified**, never as passed.

Tools and commands: [reference/tools.md](reference/tools.md). Templates: [templates/spec.md](templates/spec.md), [templates/validation.json](templates/validation.json). Judging: the `council` skill.

## 0. Start
- Follow `AGENTS.md`: `git status`, keep unrelated user changes, branch off main if on it, and make a baseline commit before a substantial feature.
- Working folder: `artifacts/research/verify/<slug>/` (git-ignored). Everything private or generated goes there.

## 1. Expectations first (before editing code)
Copy `templates/spec.md` to the working folder and fill it in:
1. **Expectations (X1…)**: what must be observably true after the change, the level that proves it, and the exact evidence (a test name, a probe command and the value it must show).
2. **Standing checks S1–S9** for any UI change. Mark one n/a only with a reason.
3. **Code lifecycle audit** (cheap; it finds timing bugs that screenshots never show). For each region the change touches, grep the feature code for what *creates, replaces or removes* it (`mount`, `unmount`, `replaceChildren`, `replaceWith`, `remove`, `innerHTML`) and what *triggers* that (`popstate`, `reddit:route`, `MutationObserver`, settings and storage listeners, timers). Write one transition row per path, for example "feed → post (click): `scan()` → `unmount()` → nav placeholder rebuilt, filled asynchronously". Each row becomes an S9 timeline case.
4. **Data-to-UI fields** for features that render records (Arctic Shift, Reddit JSON): which field shows where, and in what native format.
5. **Out of scope**: list anything else you notice here instead of changing it.

## 2. L0/L1: static and unit (seconds; loop here first)
- `node --check` every changed `.js`/`.mjs` file.
- Run the relevant `tests/*.test.cjs` first, then the full `npm test`. Add or extend tests for each expectation that logic can prove. Fixtures and tests use synthetic data only.

## 3. L2: fixture browser (the unattended fix loop)
- Start `node scripts/live/fixture-browser.mjs` in the background, then use `RELAY_PORT=9334` for every probe.
- Pages: `demo/` (chat: full, floating and dark toggles) and `demo/tweaks/` (profile discovery), which load the real extension scripts on synthetic Reddit-like markup. **If the touched surface has no fixture (for example the archive), add one first**: a synthetic page under `demo/<feature>/` modelled on `demo/tweaks/` (mock `chrome.runtime` replies with invented records, native-like markup copied structurally from Reddit). Commit it with the change.
- For each expectation and standing check, run the evidence command from the spec. Catch problems in this order:
  1. **Automatic DOM checks**: `probe-ui` (overflow, clipping, targets, covered controls, contrast, tab order, console) per mode and theme, at 1280px and at the 380px floating width.
  2. **Parity as data**: `probe-inventory` on the native element and ours, then diff (missing, extra, different size, font, weight, colour or control state).
  3. **Transitions**: `probe-timeline` for every lifecycle row, on ours and on the native equivalent.
  4. **Pixel diff**: `probe-shot` before and after (same viewport and clip), then `probe-pngdiff --mask <edited area>`. Changes outside the mask need an explanation or a fix.
  5. **Looks native**: only now, one `probe-sheet` contact sheet (native next to ours) for the council's visual reviewer.
- **Loop rules**: fix the real cause, never the test or the probe. At most **3 attempts per failing expectation**; then stop and report it with the evidence (command, values, artifact paths). Don't widen the change to make something pass; out-of-scope findings go on the list.

## 4. Council (judging)
When L2 passes, run the `council` skill in **routine** mode for the touched surfaces. It returns verified issues only. Fix the in-scope ones (the same 3-attempt rule applies) and record the rest as open issues.

## 5. L3: live, once, at the end (signed-in Chrome, read-only)
1. `npm run package` (the stable folder `artifacts/reddit-chat-search/` must match `extension/`).
2. Start `node scripts/live/relay.mjs` in the background and **tell the user to approve Chrome's remote-debugging prompt**, then wait for `connected`.
3. Open your own tab only. Reload the extension through a temporary popup tab and confirm the `[data-rcs-version]` marker matches the manifest. **On a mismatch, stop and report.**
4. Check each L3 expectation on real Reddit: transitions by real clicks (`probe-timeline`), a foreground tab, `visibilityState` checked, native pages as the baseline. Strictly read-only: no voting, joining, posting, commenting, saving, reporting or settings changes.
5. Captures stay in the working folder. Close your tab and stop the relay when done.
- Live data drifts (posts change, the archive times out). If a check depends on live data that isn't available, the result is **not verified (reason)**.

## 6. Release (only when packaging a release bundle)
Run the `council` skill in **release** mode, then the full suite, then integrity checks:
`python3 -m zipfile -t artifacts/reddit-tweaks-v<ver>.zip`, `sha256sum` on it, and source vs stable-folder byte equality:
`(cd artifacts/reddit-chat-search && find . -type f) | while read f; do cmp -s "extension/$f" "artifacts/reddit-chat-search/$f" || echo "DIFF $f"; done` (no output = equal).
Choose the version bump per `AGENTS.md`.

## 7. Record and commit
- Write `artifacts/validation-v<version>/validation.json` from the template: expectations with results and attempts, standing checks, what each level covered, council roles with token counts and verified issue counts, `not_verified`, and `out_of_scope`. Copy only the key screenshots alongside it.
- Commit per `AGENTS.md`: small coherent commits (fixture, implementation and tests, release metadata), conventional subjects, explicit paths, staged diff inspected. Never commit `artifacts/`, captures, tokens or private data.

## 8. Report to the user
Start with the outcome. Give a table of expectations (pass / fail / not verified, with one line of evidence each), then verified open issues, then out-of-scope notes and anything that needs the user (approval prompts, decisions).

## Pitfalls learned the hard way
- **Settled screenshots miss timing bugs.** Use `probe-timeline` with real clicks; direct `nav` loads skip the client-side router, which is where re-mount bugs live.
- **Background tabs and windows are throttled**, which pauses lazy images, infinite scroll and observers. At L3 use one foreground tab with focus emulation on (see tools.md); the L2 fixture disables throttling.
- **Native first**: before calling something a defect, check native Reddit on the equivalent page. Some quirks are Reddit's own; for example, native pages also scroll 15px sideways.
- **The relay's event buffer drains per session** and holds the last 1000 events. Enable Log/Runtime/Network before acting, and read them soon after.
- **The extension service worker sleeps.** Wake it by opening a feature page, then attach; attach again if it restarts.
- **Headless real Reddit serves a bot check.** Real-Reddit checks happen only at L3.
