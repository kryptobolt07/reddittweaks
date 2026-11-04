# Repository workflow

Follow the user's current instructions first. The user has authorized subagents for work in this repository: use gpt-6.1-terra with high reasoning for all subagents, while the main agent manages and reviews the work. Follow any newer user instructions about delegation or model choice.

For extension changes, Claude Code agents use the `verify-loop` skill (spec first; unit, fixture and live levels; fix loop; validation record) and its `council` skill for judging (`.claude/skills/`). The council's roles use the Claude subagent types and models fixed in its SKILL.md; those override the default subagent model above for judging.

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

## Extension constraints

- Support full-screen, floating, and minimized Reddit chat.
- Reuse Reddit's authenticated native client and events; no second sync loop and no visible background scrolling.
- Keep credentials inside Reddit's page world. Scope persistent data to the authenticated account.
- Distinguish cached/searchable data from verified history completeness. Never label incomplete or failed loads as complete.
- Use synthetic fixtures for committed tests/screenshots. Put private live diagnostics only in ignored `artifacts/research/`.
