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
