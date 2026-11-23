# Repository workflow

Follow the user's current instructions first.

- **Delegation is optional.** The main agent may do the work itself. Use subagents only for self-contained pieces that need little live back-and-forth (research, a logic module with unit tests, a read-only sweep), choose any capable model the current tool offers, and review their diffs before committing. No particular agent, provider or model (Codex included) is required.
- **Branch names** only need to be descriptive (for example `feat/…`, `fix/…`); a `codex/` prefix is not required.

For extension changes, Claude Code agents use the `verify-loop` skill (`.claude/skills/verify-loop/`): spec first, measure native Reddit as data before building, build with Reddit's own markup, unit, fixture and targeted read-only live checks, fix loop, and the main agent verifies its own work. When the user says the verify loop isn't needed, test efficiently and hand over for their testing instead. The `council` judging skill is archived and inactive (`.claude/skills-archived/`, with a README on switching back); use it only if the user asks for a council review.

## Git and commits

- Inspect `git status` before edits; preserve unrelated user changes.
- Make a baseline commit before a substantial new feature when needed, then commit small, coherent changes separately (storage, integration, interface, release).
- Use conventional commit subjects: `feat:`, `fix:`, `test:`, `docs:`, or `chore:`. Explain why a nontrivial change is needed in the commit body.
- Run the relevant tests before each implementation commit. Run the full test suite and package validation before a release commit. Record material limitations in the release notes.
- Inspect staged changes before committing. Use explicit paths to stage only the intended files. Never commit credentials, private chat data, research captures, generated artifacts, or dependencies.
- Follow the version policy below. Keep `artifacts/reddit-chat-search/` as the stable unpacked testing folder.
- Leave completed, validated work committed. Do not push, publish, rewrite history, or discard changes without authorization.

## Extension versions

- The user's explicit version instructions override this policy. Otherwise, apply it to the final validated bundle without asking for a separate version approval.
- Keep the same version for small cosmetic/text changes, documentation/tests, internal refactors, and follow-up corrections within the current unreleased bundle that do not materially change behavior. Commit these changes normally; do not bump for every commit.
- Bump PATCH for a meaningful user-visible bug fix, reliability correction, or performance improvement (for example, 0.4.0 to 0.4.1 for removing startup search blocking).
- Bump MINOR for a new user-facing feature or a substantial compatible expansion of behavior (for example, 0.4.x to 0.5.0 for a new search mode); reset PATCH to zero.
- Bump MAJOR for an incompatible release once at 1.x or later. Before 1.0, use a MINOR bump for breaking changes and document migration/recovery steps. Never bump a storage schema merely because the extension version changes.
- Choose the smallest justified increment once per completed release bundle. Explain the choice in release notes. A version decision is independent of the number of commits or edited lines.
- Treat `extension/manifest.json` as the extension version source of truth. Synchronize only current runtime/display version references, the current release notes, and packaging paths. Preserve historical version references and independent tooling/package versions.
- Make coherent implementation commits with relevant tests first. Then run the full suite and verify archive integrity and source/stable-folder byte equality before committing release metadata. Small edits may rebuild the same-version local export with updated validation; do not replace published release assets or tags without authorization.

## Live testing

- **Signed-in Playwright only:** `node scripts/live/browser.mjs run <probe.mjs> [--url …] [--phone]` (or `open`). It launches Chrome Dev on the repo's signed-in `.chrome-dev-profile/` with Playwright's `launchPersistentContext`, headed on a private Xvfb display (`:97`), and loads `artifacts/reddit-chat-search/` fresh each launch. Run `npm run package` first.
- **No CDP of our own:** no `--remote-debugging-port`, no `connectOverCDP`, no CDP sessions for emulation or probing. The one exception is `Extensions.loadUnpacked` over Playwright's own pipe, because Chrome 137+ ignores `--load-extension`. Phone mode is Playwright's context options (viewport, `isMobile`, `hasTouch`, Android user agent); input is Playwright's mouse, touch and keyboard.
- **Keep the keyring:** never launch the profile with `--password-store=basic` or `--use-mock-keychain` (Playwright defaults the launcher already drops). They can't read the profile's encrypted cookies, so Reddit signs it out.
- **Signing in** is the user's job: `node scripts/live/browser.mjs open --headed-desktop --url https://www.reddit.com/login` opens the profile on their desktop. Agents never type passwords.
- Live checks are read-only. Never get past "Prove your humanity" or 403 pages. About 40 page loads in 30 minutes gets HTTP 429, so space loads out and reuse the page. One launch at a time (the profile is locked).
- Offline checks: `npm test` (jsdom) and Playwright pages against `npm run preview` (`demo/`, `demo/tweaks/`). The older CDP relay tools in `scripts/live/` (`relay.mjs`, `cdp.mjs`, `probe-*.mjs`, `fixture-browser.mjs`) are retired for live Reddit; use them only if the user asks.
- Probes, captures and screenshots go in ignored `artifacts/research/verify/<slug>/` and `artifacts/research/shots/`.

## Extension constraints

- Support full-screen, floating, and minimized Reddit chat.
- Reuse Reddit's authenticated native client and events; no second sync loop and no visible background scrolling.
- Keep credentials inside Reddit's page world. Scope persistent data to the authenticated account.
  - Exception (user-approved 2026-11-17): the account switcher (`extension/account-broker.js`, `docs/account-switcher-spec.md`) stores each saved account's five Reddit session cookies in worker-only extension storage, via the `cookies` permission. Cookie values never reach pages or the popup; it never calls Reddit's Log Out; removing an account deletes its snapshot. Do not widen this to other cookies or data.
- Distinguish cached/searchable data from verified history completeness. Never label incomplete or failed loads as complete.
- Use synthetic fixtures for committed tests/screenshots. Put private live diagnostics only in ignored `artifacts/research/`.
