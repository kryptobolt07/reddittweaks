# Chat History Search & Storage v2 Specification

## Overview

Reddit's Matrix homeserver (`matrix.redditspace.com`) does not expose `/_matrix/client/v3/search` for chat messages. Finding matches in unfetched chat history therefore requires fetching uncovered history ranges at most once, persisting verified coverage spans, and executing all search queries locally.

This document specifies the storage v2 layout (`rcs-chat-v2`), the O(batch) write path, the in-memory column search projection, verified coverage spans, v1→v2 migration, and search-driven backfill.

## Storage Layout (`rcs-chat-v2`)

Every record is scoped by integer account ordinal `a` (and per-account room ordinal `n`) so long Matrix IDs are not duplicated across every key and index entry.

| Store | keyPath | Indexes | Purpose |
|---|---|---|---|
| `accounts` | `owner` | `a` (unique) | Account ordinal, `nextRoom`, import markers, resumable migration cursor, delta-maintained stats (`messages`, `rooms`, `completeRooms`, `bytes`, `unknownEvents`) and `mediaTypeCounts`. |
| `rooms` | `[a, n]` | `id` `[a, roomId]` (unique) | Room ordinal map, `latest` preview pointer, `headSeen`, thread roots, `inaccessible` (403/404), `legacyComplete` (from v1), `unknownCount`, and derived `coverage`. |
| `msgs` | `[a, n, e]` | `time` `[a, t]`, `order` `[a, n, p, s]` | One record per visible message with display body `b` after latest valid edit, media bitmask `f`, MIME/preview/dimensions, thread root `th`, and applied edit pointer `eb`/`et`. Original fields are kept in `orig` only when edited so redacting all edits restores the original. |
| `rels` | `[a, n, e]` | `target` `[a, n, target]` | Edits (`k: 'edit'`) and permanent redaction tombstones (`k: 'redact'`). Supports out-of-order arrival and edit-redaction fallback. Redacted tombstones never retain plaintext or media metadata. |
| `spans` | `[a, n, p, hi]` | — | Verified backward-pagination coverage spans `{a, n, p, hi, lo, tHi, tLo, bottom, at, src}`. Adjacent/overlapping spans (`lo <= other.hi + 1`) merge on write. |
| `people` | `[a, id]` | — | Per-person identity records with display-name history (`aliases`) for stable Matrix ID resolution under `from:`. |
| `meta` | `key` | — | Global schema counters (`nextAccount`). |

## Write Path & Correctness Guarantees

- **O(batch) writes:** Each ingest prefetches affected `people`, `rooms`, and (for existing rooms only) `msgs`/`rels` in parallel waves inside a single IndexedDB transaction. Brand-new rooms perform zero `msgs`/`rels` reads.
- **Order-independent reduction:** Any arrival permutation of originals, edits, forged edits, and redactions yields the exact same visible state, `summaries()`, and `stats()`.
- **No silent drops:** Unhandled non-state event types increment `room.unknownCount` and `accounts.stats.unknownEvents`. Any room with `unknownCount > 0` or `inaccessible` is never labelled complete.
- **Local echoes:** Temporary `~…` IDs are never persisted and are filtered on read if present.

## Search Engine & Query Plan

- `RCSCore.compilePlan()` compiles a parsed query once into guaranteed-superset prefilters (`requiredNeedles` sorted longest-first, unconditional `timeRange`, `requiredMediaMask`, `fromMode`, `anySenders`, `roomPruneSenders`) plus zero-allocation pre-folded evaluators matching `RCSCore.prepareQuery()`.
- On first query after worker wake, the worker builds a per-owner column projection (`Float64Array t`, `Uint32Array room`, `Uint32Array senderIdx`, `Uint8Array flags`, `folded[]`, `ids[]`) in bounded 5,000-row primary-key `getAll` batches, sorted descending by `t` for O(log N) date-window binary search.
- Subsequent writes patch the projection in place. Only the returned page (≤500 records) is fetched by primary key from `msgs`.
- Single-room reads (`room()` and cold single-room `search()`) read only that room's `[a, n]` key range without building a full-account projection.

## Migration from `rcs-messages-v1`

- On opening `rcs-chat-v2`, any existing `rcs-messages-v1` database is migrated per owner in resumable 500-event transactions tracked in `accounts.migration.cursor`.
- Until an owner finishes migration, reads fall back to v1 and new ingests dual-write to both v1 and v2.
- Rooms marked `coverage.complete === true` in v1 become `rooms.legacyComplete` (never reported complete until an overlapping head span verifies them).
- After migration completes, 20 fixed differential queries compare v1 vs v2 totals and IDs. `rcs-messages-v1` is deleted only after every owner passes verification.

## People Previews

- Directory traversals (`getRoomList` with `include: {timeline: true}`) populate `lastPreview` alongside `rooms.latest` in v2.
- A preview older than the chat's `lastSeq` or directory `timestamp` is rendered dimmed with `…` until refreshed, never presented as current.
- `from:` picker rows for people without a direct chat display their latest message from any shared group chat prefixed with the group name.
- A chat row on screen with neither a saved message nor a directory preview reads its newest events once per session (bridge method `latest`, `/rooms/{id}/events` with `dir=b, before=20`, a second page only when the first had no message, at most 12 rooms per batch). The events are saved through the normal cache path and the summaries reload. A room with no messages reads "No messages yet"; a failed read is tried again on a later render. Inaccessible rooms (403/404) are left blank.

## Searching older messages with no match yet

- While older messages are searched (or Reddit's local cache is read) and nothing has matched, the list shows **No matches yet** · "Searching older messages across your chats. Results appear as messages are found." Once that message has shown for a query, later batches rerun the saved search without swapping it for skeleton rows, so neither the skeleton nor its scrollbar flashes. A new query, scope, date range or filter shows skeletons first, as before.

## Persisted Coverage & Global Backfill

- In-room `history` and global `backfill` persist verified spans from `/rooms/{id}/events` backward pagination cursors (`seq = lo - 1`, `bottom: true` on empty page or `lo === 0`), reusing `coordinatedRead` / `retryRead` / `ctx.client.http.authedRequest` without touching Reddit's own IndexedDB or scrolling timelines.
- Global backfill orders incomplete main and thread scopes (including modmail) in a unified max-heap by frontier timestamp `F(r)` so matches and recent thread replies stream newest-first and the watermark `W = max F(r)` moves monotonically backward.
- **Certified-watermark early stop (`sort: newest`):** When an active search/filter uses newest-first ordering, `Store.searchCount()` checks certified matches strictly above `W + 60s` (`O(log N)` slice over the descending projection with early break). Once ≥ `targetMatches` (initially 50) are certified—including 0-request instant pause if already cached locally—backfill pauses cleanly (`N+ matches · Searched back to <date> · Scroll for older`) and advances automatically on scroll before the user reaches uncertified results. Rare queries with `< 50` matches keep advancing automatically, and `sort: oldest` / `sort: relevant` disable early stop.
- **Additional lossless optimizations:** `m.room.create` marks room bottom immediately without a trailing empty `seq=0` request; full `conversations()` directory scans seed backfill freshness (updated live by incoming Matrix events) to avoid repeating `/rooms`; intra-page and inter-page non-monotonic timestamps trigger a `dateOrderUnsafe` guard disabling premature stopping or over-certification.
- Default budget is 300 requests or 3 minutes per active search/filter run (resumable automatically by scrolling near the bottom of results), coordinated per account across tabs via `rcs-backfill-lease:<owner>`. Browsing unfiltered Messages with no search term or filter makes zero automatic requests and loads older batches (12 requests per batch) on demand as the user scrolls near the bottom.
- Lossless `from:` room pruning (`excludeRoomIds`) skips resolved 1:1 direct rooms whose counterparty cannot match any required sender in `compilePlan().roomPruneSenders`, while always keeping all group rooms, modmail rooms, unresolved DMs, and uncached rooms.
- Backfill keeps running when chat is minimized and stops cleanly after the in-flight request when the search panel closes, the query clears, the account changes, or chat search is disabled.
