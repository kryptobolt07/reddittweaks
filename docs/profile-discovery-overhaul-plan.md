# Profile discovery overhaul plan (0.19.0)

Goal: profile Overview, Posts and Comments should feel like Reddit's own feed. The only visible differences should be the cues on hidden, deleted and removed items. Loading should never look slower or jumpier than the native feed.

## Diagnosis (0.18.17)

1. **Arctic Shift sits outside the normal feed.** In All activity, archive discovery only runs after the archive icon is clicked. Deleted items never appear inline automatically. Pages use `limit=25`; a live probe showed `limit=100` costs about the same (0.65–0.85 s), so we make four times as many round trips as needed.
2. **Sources block each other.** Reddit search uses one `busy` flag and the archive uses `archiveBusy`. `continueProfile`, `prefetchProfilePage` and `loadMore` bail out while either flag is set, and `loadMore` advances only one provider per step. The slowest provider gates continuation.
3. **Deleted-view verification is slow and blocks paging.** `verifyArchiveStatuses` checks 2 items at a time in sequence, and `metadataPending` blocks archive continuation until every check finishes.
4. **Reddit's own cards can wait indefinitely.** In New / All activity, incoming native cards stay hidden behind `data-rt-order-pending` until every source covers their dates. One slow or retrying source therefore stalls Reddit's own feed.
5. **Fallbacks don't look like Reddit.** If Reddit can't render a card (a deleted comment, a 404 or a missing fragment), the user sees a plain link, a Retry button and a `<details>` "Recovered text" box. The Reddit-styled reconstruction (`renderArchivedNative`) only runs for deleted or banned accounts.
6. **Archived comments have no context.** Arctic Shift comment records have no post title, so reconstructed comment cards show "View post".
7. **Extra page chrome.** A toolbar with refresh and archive icons, plus technical status text, sits above the feed and doesn't match Reddit.

## Changes

### A. Archive transport (`post-broker.js`)
- Request profile pages with `limit=100`, and keep the overlap-second cursor and stall detection.
- Request `retrieved_on` so cues can say when the snapshot was taken.
- After a comment page, batch-fill missing post titles through `/api/posts/ids` (≤100 IDs, `fields=id,title,subreddit,over_18,spoiler`). This is best effort: comments keep working if the lookup fails.
- Honor `X-RateLimit-Reset-At` as well as `X-RateLimit-Reset`.

### B. Independent source scheduling (`profile-sources.js`, new)
- Track each stream (`post`, `comment`, `comment-public`, `archive-post`, `archive-comment`) separately: cursor, in-flight state, exhaustion, failure and chronological floor.
- Streams load concurrently. Continuation advances every stream at or above the publication floor, shallowest first, instead of choosing a single provider.
- Archive discovery starts automatically with Reddit discovery whenever the archive setting is enabled, in every activity filter.
- Keep the existing `Discovery` method names (`loadReddit`, `loadArchive`, `loadMore`, `moreReddit`, `moreArchive`, …) as thin wrappers.

### C. Bounded native gating
- Native cards wait for discovery coverage for at most a short budget (about 1.2 s per native page). After that they're released. Late discoveries are inserted in chronological order, and the reading position is compensated with the existing viewport transaction.
- A failed or rate-limited source never holds native cards.

### D. Faster Deleted verification
- Skip verification for items Reddit already lists (native feed or Reddit search). Those count as available evidence for the Hidden and Deleted filters.
- Verify with the shared native-read capacity (4 comments, 2 posts) rather than sequential pairs. Let the archive cursor run one page ahead while verification continues.

### E. Native-looking fallbacks and cues
- When Reddit can't render an item that has archive data or proven deletion, use the native-looking reconstruction rather than the link-and-Retry box. Transient failures keep a Retry action styled with Reddit's button classes.
- Reconstructed comment cards show the real post title and community.
- Recovered text replaces the `[deleted]` body inline, styled like Reddit's own body text. There's no `<details>` disclosure. Provenance stays in the item's cue tooltip, including the snapshot date.

### F. Less non-native chrome
- Move Refresh into Reddit's Feed options menu, next to the Activity submenu, and drop the standalone archive button.
- Keep a screen-reader status region. Show errors only in the feed-bottom continuation row, with plain wording.

## Invariants kept
- Credentials stay in Reddit's page world. Archive requests are opt-in, cookie-free and not persisted.
- An archive snapshot never proves current deletion. Deleted and removed come only from Reddit's native evidence.
- Incomplete or failed sources are never labeled complete.
- Native nodes and virtualization stacks are never moved or rewritten.

## Delivery
Commits in order: archive transport; source scheduler; native gating budget; verification; fallbacks and cues; chrome and menu; release 0.19.0 (MINOR: new automatic archive merge behavior).
