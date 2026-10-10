# Shared saved-message search — 0.4.0

## This release

1. Persist messages already obtained by Reddit or an explicit individual message search in extension-owned IndexedDB. Store compact event data, sender references, edits/redactions, and coverage metadata per account. Reuse one database for individual and global search.
2. Observe Reddit's existing native event stream and loaded timelines. Import only locally available history; do not issue a second sync loop, crawl every conversation, scroll the chat, or fetch profiles merely to populate the cache.
3. Provide an All chats message-search mode alongside username search, using existing date filters and compact Reddit styling. Search only saved messages, display partial coverage, and navigate to the exact room/event/thread.
4. Read saved room messages before individual network searches and preserve them across refreshes. A saved snapshot is not proof of complete history; explicit individual searches may continue fetching missing history.
5. Add account-safe cache management, tests for persistence/edits/redactions/no-network global search, full/floating visual checks, and versioned/stable exports.

## Deferred

An optional full-history build is not part of 0.4.0. First measure stored bytes and verify offline gap detection/recovery and thread completeness. Do not promise a 30–50 MB maximum or exhaustive global results.

## Commit sequence

- `chore: initialize repository and document workflow` — existing 0.3.8 baseline.
- `feat: persist account-scoped message events` — database and extension messaging.
- `feat: capture native and searched chat history` — page-world event integration.
- `feat: search saved messages across conversations` — global and individual interface.
- `fix:` commits for identity retention and multi-account clearing found during integration.
- `chore: release chat search 0.4.0` — integration, validation, documentation, manifest bump.

Apply the workflow in AGENTS.md to future tasks as well.

## Completed validation

All five implementation stages are complete. The full suite passes 153 tests, including a 12,000-message native-cache import through the actual page/client/worker layers, durable chunk backpressure, restart reuse, account isolation, edits/redactions, local-only global search, and existing directory/history regressions.

Synthetic Brave preview checks cover full chat, floating chat in both themes, the shared date calendar, global result navigation, and the minimized Search chats entry point. This is not a claim that the newly packaged build has been installed and validated against the signed-in account.

The reproducible Node/fake-indexeddb measurement stores 20,000 invented messages across 1,000 rooms: approximately 12.37 MiB of compact data, with a 236 ms median global scan in this environment. It excludes database overhead and does not establish a size ceiling. These findings support the initial saved-message scope; full-history building remains deferred.

## Buffer correction within 0.4.0

Read-only Brave diagnostics found 20,303 native timeline events across 1,006 nonempty timelines. The original synchronous startup capture exceeded the unchanged 500-batch / 10,000-event / 8 MiB queue before its writer could drain. Database-import backpressure did not cover this producer, and the latched overflow blocked every subsequent read. Unchanged snapshot rescans could also thrash the 10,000-event dedup window.

Startup/sync capture now drains through durable, bounded chunks, records native event references to skip unchanged snapshots, and coalesces ordinary native event bursts. Rejected identifiers are replayed from local native/history sources; only a matching durable recovery clears the transient error. Missing local sources retain an explicit partial-capture status, and genuine storage failures stay visible.

The old implementation reproduced the exact error in a 20,400-event startup fixture. The corrected implementation passes 157 tests, including that fixture, unchanged-sync reuse, cross-room coalescing, coverage boundaries, and a 12,500-event burst recovery. A separate, temporary Brave probe captured 16,418 searchable live SDK messages in memory in about 604 ms, then continued receiving native events. The diagnostic code was removed afterward. This verifies the live producer shape, not installation or persistent storage of the corrected build in Brave.

No version bump, new sync loop, server recovery requests, visible scrolling, or cache clearing is required by this correction.

## Saved-search and participant-loading correction within 0.4.0

Read-only signed-in Brave inspection confirmed that an unresolved invitation's `/members` lookup returns HTTP 403 `M_FORBIDDEN`. The participant phase previously let that single failure abort the entire directory. Restricted rooms now remain explicitly unresolved while accessible conversations continue; departed rooms avoid a futile membership lookup. Denied status survives directory persistence and is retried on relevant native changes or explicit refresh. Invite state is retained even alongside an empty normal state array.

Saved-message reads previously awaited the whole initial native import, and every capture notification reset the global query's 100 ms debounce and generation. Continuous writes could therefore postpone a query indefinitely. Search/room reads now return current saved data while a shared import continues. Capture changes mark an active query dirty for one subsequent refresh, preserve current results, and use a 500 ms background refresh delay during import. Hidden message controls no longer scan their room on each capture. Explicit ready calls and durable import markers retain their completion guarantees.

The suite passes 164 tests, including delayed-import progressive reads, continuous capture/query starvation, deferred refresh retaining matches, disconnected-control completion, persistent denied-room reuse, retained invite state, and unexpected participant errors. Brave preview checks use synthetic messages and cover full/floating search and minimized restore; the signed-in participant diagnosis verifies the failure response, not installation of this corrected build. Both fixes retain manifest version 0.4.0 and require no cache clearing or new history/sync requests.

## Persistent global sidebar correction within 0.4.0

The calendar-open condition hid the entire results panel, exposing Reddit's native roster underneath. The shared outside-click handler also treated All chats as a temporary dropdown and dismissed it when the user focused the room. Global results now remain visible as the selected sidebar view, including during calendar selection and exact message navigation. Outside clicks close an open calendar without dismissing the global panel; Escape in the field closes the calendar first. People and individual message menus retain their normal dismissal rules.

Validation includes full/floating tests for retained result elements, scroll position, query, selected scope, calendar dismissal, room changes and unchanged request counts, plus Escape behavior. Synthetic Brave checks verify full chat calendar layering, conversation-pane focus, navigation to another room while preserving global results, and floating chat. The full suite passes 167 tests. No version, cache schema, fetching policy, or installed browser extension has been changed by this UI correction.

## Reconnect persistence and invitation correction within 0.4.0

A permanent native-import completion flag prevented later database reads, so messages fetched while the extension was disabled could remain absent unless they reappeared in a loaded timeline. Native attachments now start one local reconciliation automatically; late database readiness and replacement clients/databases are handled without another server sync loop. Available local rows are checked again for newly cached events and older edits/redactions. Unchanged durable ledgers and identities skip rewrites and notifications, and successful EOF/write acknowledgement records a last reconciliation timestamp. Saved searches remain progressive. Individual history completion also waits for saved-write acknowledgement.

Pending invites with no exposed participants skip forbidden member requests. Native membership/type/name metadata is compared with saved pending records on startup, and raw or wrapped membership events trigger a delta update. State merges preserve newer membership events. Named community/modmail conversations are searchable in People and visibly distinguished from personal chats; acceptance clears pending status when native data resolves it.

Synthetic tests cover restart with a replaced worker, an extension-disabled interval with no capture listeners, native-cache-only missed messages/edits/redactions, preserved extension-only history after native eviction, no duplicate writes, automatic catch-up before a search, late readiness/replacement, failed storage acknowledgement, invite acceptance in-place and after restart, community search captions, and existing full/floating/minimized search behavior. Re-enabling requires reloading existing Reddit tabs. Native cache eviction can leave unrecoverable local gaps; full server-history building stays deferred. Manifest/cache schema versions remain unchanged.

Final validation passes 175 tests. Synthetic Brave checks show a named community request in People, clear its pending caption after membership changes, and verify real browser IndexedDB persistence of edited text/redaction across a tab reload, with duplicate ingestion returning unchanged. The browser fixture uses a separate localhost database and no private Reddit data; its temporary room-model overrides were removed by reload. This does not claim that Brave was terminated/restarted or that the rebuilt extension has been reloaded in the signed-in Reddit tab.

## Committed reads in 0.4.1

Search reads previously awaited the isolated capture drain, joined the worker mutation queue and awaited the store writer queue. Interactive search/room/stats now take committed readonly snapshots without those logical barriers. Mutations stay ordered, and native capture/import/history completion plus explicit ready/flush still wait for save acknowledgement. Room hydration projects one snapshot once, preventing repeated page reads from mixing concurrent room versions. Read revisions reject results that finish after clearing or switching accounts. Saving errors preserve searchable committed matches with a paused status, and manual Refresh explicitly retries pending writes without an automatic failure loop. Initialization no longer loads all rooms just to return unused statistics.

Version policy assigns 0.4.1 to this meaningful performance fix. The manifest and current runtime stamp are synchronized; cache schemas/keys, historical references and the private tooling package version are unchanged. Tests pass for stalled queues at all three layers, durable barriers, whole-room snapshot consistency, stale-clear rejection, failed saving with preserved matches and explicit retry. Full validation passes 181 tests. Account initialization, a currently active database transaction and local matching remain real costs; the optional full-history build is still deferred.

Brave verification used a separate localhost IndexedDB fixture: a committed read returned two matches while the future capture write was held, and the search UI displayed those matches with the 0.4.1 runtime stamp. Releasing the write and refreshing produced three matches. Temporary API overrides were removed by reload. This checks browser database behavior and the synthetic view, not installation of 0.4.1 in the signed-in Reddit tab. Packaging also rejects a mismatched runtime version stamp.
