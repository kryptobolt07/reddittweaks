# Repository workflow

Follow the user's current instructions first. Do not delegate unless the user explicitly authorizes subagents for the current task.

## Git and commits

- Inspect `git status` before edits; preserve unrelated user changes.
- Make a baseline commit before a substantial new feature when needed, then commit small, coherent changes separately (storage, integration, interface, release).
- Use conventional commit subjects: `feat:`, `fix:`, `test:`, `docs:`, or `chore:`. Explain why a nontrivial change is needed in the commit body.
- Run the relevant tests before each implementation commit. Run the full test suite and package validation before a release commit. Record material limitations in the release notes.
- Inspect staged changes before committing. Use explicit paths to stage only the intended files. Never commit credentials, private chat data, research captures, generated artifacts, or dependencies.
- Update the manifest version only when the user requests a release/version bump. Keep `artifacts/reddit-chat-search/` as the stable unpacked testing folder.
- Leave completed, validated work committed. Do not push, publish, rewrite history, or discard changes without authorization.

## Extension constraints

- Support full-screen, floating, and minimized Reddit chat.
- Reuse Reddit's authenticated native client and events; no second sync loop and no visible background scrolling.
- Keep credentials inside Reddit's page world. Scope persistent data to the authenticated account.
- Distinguish cached/searchable data from verified history completeness. Never label incomplete or failed loads as complete.
- Use synthetic fixtures for committed tests/screenshots. Put private live diagnostics only in ignored `artifacts/research/`.
