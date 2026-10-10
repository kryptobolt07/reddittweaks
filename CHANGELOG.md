# 0.4.0

- Persist messages already fetched by Reddit or individual searches, scoped by account and shared between individual and global search.
- Add People / All chats search scope, local message/date filtering, compact sender rows, and exact room/event/thread navigation. Global search explicitly shows incomplete coverage.
- Capture existing native events, loaded timelines, edits and redactions without another sync loop or background history crawl.
- Import supported locally cached Reddit history once, using readonly 200-row chunks and durable write acknowledgements. Save the completion marker only after successful writes; reuse it across reloads.
- Add cache statistics and a separate Clear saved messages control. Failed writes retry within bounded memory; account switches and clear operations invalidate stale work.
- Initialize Git and document the repeatable commit/validation policy in AGENTS.md.

The optional full-history build is deferred. Existing local tails and newly fetched pages do not establish complete global coverage. No fixed storage ceiling is promised.
