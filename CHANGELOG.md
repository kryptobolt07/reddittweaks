# 0.4.0

- Persist messages already fetched by Reddit or individual searches, scoped by account and shared between individual and global search.
- Add People / All chats search scope, local message/date filtering, compact sender rows, and exact room/event/thread navigation. Global search explicitly shows incomplete coverage.
- Capture existing native events, loaded timelines, edits and redactions without another sync loop or background history crawl.
- Import supported locally cached Reddit history once, using readonly 200-row chunks and durable write acknowledgements. Save the completion marker only after successful writes; reuse it across reloads.
- Add cache statistics and a separate Clear saved messages control. Failed writes retry within bounded memory; account switches and clear operations invalidate stale work.
- Initialize Git and document the repeatable commit/validation policy in AGENTS.md.

Buffer fix within 0.4.0: throttle startup/sync capture as well as native database import, coalesce native bursts, skip unchanged snapshots, and recover rejected captures locally instead of latching the buffer error indefinitely. The buffer limits are unchanged.

Search fixes within 0.4.0: return saved global/room matches while the initial local import continues; coalesce incoming capture updates without cancelling queries or clearing visible results; avoid saved-room reads in hidden controls. Preserve unresolved invitations/departed rooms when their participant endpoint denies access, continue accessible username resolution, retain invite state, and persist denied status to avoid repeated failures on reload. Unexpected participant failures remain visible.

The optional full-history build is deferred. Existing local tails and newly fetched pages do not establish complete global coverage. No fixed storage ceiling is promised.
