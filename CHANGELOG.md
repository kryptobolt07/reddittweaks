# 0.4.1

- Show already-committed global/room matches without draining queued captures. Worker reads run separately from ordered mutations; whole-room reads use a single snapshot.
- Preserve explicit save barriers and invalidate stale reads after clearing or changing accounts. Remove the redundant full stats scan during initialization.
- Keep saved matches searchable during saving failures, show Saving paused, and let Refresh retry pending writes without turning ordinary searches into a retry loop.
- Document proportional version decisions in AGENTS.md. This meaningful startup performance fix receives a PATCH bump; no feature or cache-schema version change is required.

Validation: 181 tests pass, including paused client/worker/storage queues, snapshot consistency, durable barriers, clear protection, saving failure/Refresh behavior, and existing native catch-up/UI tests. Authenticated-account readiness, an active IndexedDB write, and local matching can still take time; global coverage remains incomplete.

# 0.4.0

- Persist messages already fetched by Reddit or individual searches, scoped by account and shared between individual and global search.
- Add People / All chats search scope, local message/date filtering, compact sender rows, and exact room/event/thread navigation. Global search explicitly shows incomplete coverage.
- Capture existing native events, loaded timelines, edits and redactions without another sync loop or background history crawl.
- Reconcile supported locally cached Reddit history on each chat attachment, using readonly 200-row chunks and durable write acknowledgements. Persist successful reconciliation timestamps; skip unchanged message/identity writes.
- Add cache statistics and a separate Clear saved messages control. Failed writes retry within bounded memory; account switches and clear operations invalidate stale work.
- Initialize Git and document the repeatable commit/validation policy in AGENTS.md.

Buffer fix within 0.4.0: throttle startup/sync capture as well as native database import, coalesce native bursts, skip unchanged snapshots, and recover rejected captures locally instead of latching the buffer error indefinitely. The buffer limits are unchanged.

Search fixes within 0.4.0: return saved global/room matches while the initial local import continues; coalesce incoming capture updates without cancelling queries or clearing visible results; avoid saved-room reads in hidden controls. Preserve unresolved invitations/departed rooms when their participant endpoint denies access, continue accessible username resolution, retain invite state, and persist denied status to avoid repeated failures on reload. Unexpected participant failures remain visible.

Sidebar fixes within 0.4.0: keep All chats visible behind its calendar and while interacting with a conversation or opening a matched message. Outside clicks and Escape close the calendar without reverting the global sidebar to Reddit's native list. People search and individual message menus remain dismissible.

Reconnect fixes within 0.4.0: automatically reconcile messages Reddit cached while capture was disabled, including new messages, older edits and redactions. An old import-complete flag no longer blocks catch-up. Late database readiness and replacement clients/databases attach without a second sync loop; searches keep using saved data during reconciliation. Individual history completion waits for saved writes. Pending invitations avoid forbidden member reads, acceptance updates saved room metadata, and named community conversations appear in People with a distinct caption.

After re-enabling, reload open Reddit tabs. Local catch-up cannot recover events that Reddit no longer retains; persisted extension history is not removed merely because Reddit evicted it.

The optional full-history build is deferred. Existing local tails and newly fetched pages do not establish complete global coverage. No fixed storage ceiling is promised.
