# Chat startup: settle Reddit's conversation list before showing it (2026-11-17)

User report (screenshots): opening Reddit chat after a while or after a browser restart, the conversation list fills from the bottom up — rows without a name or avatar (title empty, preview ": Okay"), avatars arriving later, newer conversations continuously inserted above the ones already shown. The user confirmed this is Reddit's own client behaviour and asked for the startup itself to be changed.

## Status

- Done: later cached pages read 100 at a time (`extension/chat-cache-read.js`, page world, wraps `rs-matrix-client.startSync` → `client.store.getSavedSync`).
- Implemented: one-time bounded presentation hold (`extension/chat-startup.js`), loaded at document start with bounded shadow-hydration discovery; no additional sync loop or ongoing timer after the first hold.

## Measured (live, read-only)

- The list is `rs-rooms-nav` → (shadow) `rs-virtual-scroll.flex-1` → `rs-roving-focus-native` → `rs-rooms-nav-room[room]` rows. Each row's shadow root holds `.room-name`, `.last-message`, `.last-message-time` and `rs-room-icon`, whose shadow root renders an `[avatar]` span (snoovatar or image) once the member profile is known.
- The extension never writes into Reddit's chat client (read-only bridge), so the startup churn is Reddit's own.
- Reddit's client (`rs-matrix-client`, IndexedDB `reddit-chat-store`: rooms, room_state, room_timeline, sync with `next_batch`) reads its saved sync in pages of 20 (`paginatedCacheRead`, newest-first by `rooms@membership|updated_at`) and processes the live `/sync` only after the last page. 1,008 conversations: 51 pages, list complete at 6.4 s, longest main-thread pause 0.36 s. Page size after the first page — 50: 4.8 s / 0.32 s; 100: 4.6 s / 0.34 s; 200: 4.5 s / 0.60 s; all at once: 4.2 s / 2.5 s. Names were present from the cache (2 of 1,008 blank) on a normal open; the user's nameless rows were not reproduced (possibly a server `response_type: restarted`, which makes Reddit call `store.resetAllData()`).

## Behaviour

- The first time Reddit's conversation list appears in a document, the extension hides the list scroller (`visibility:hidden`, so layout, lazy loading and avatar requests continue) and shows Reddit-style placeholder rows over it, sized from Reddit's own row metrics.
- It reveals Reddit's list in one step once it has **settled**: the visible rows (room order) have not changed for 300 ms, every visible row has a name, and every visible avatar has rendered (images inside it complete). Avatars still pending 1.2 s after the rows are stable no longer hold it.
- Hard cap: the list is never held for more than 4.5 s after it first appears; an empty list (no conversations) is revealed once stable.
- Only the first appearance per document is held. Switching conversations, Reddit re-rendering the list, searching and later updates are never hidden.
- Scroll position and focus are Reddit's own; placeholders are inert (`aria-hidden`), and the list keeps `aria-busy` while held.
- Full-screen, floating and minimized chat are all covered (the floating list uses the same `rs-rooms-nav`).

## Transitions

| | Transition | Expected |
|---|---|---|
| T1 | Cold open: rows arrive bottom-up, nameless, avatars late | Placeholders until settled, then the complete list at once |
| T2 | Warm open: list already complete | Revealed after the 300 ms stability check |
| T3 | Reddit never finishes a row (deleted account, slow avatar) | Revealed by the 1.2 s avatar grace or the 4.5 s cap |
| T4 | Switch conversation / list re-render after startup | Never hidden again |
| T5 | Extension reloaded mid-hold / page hidden | Hold released; no stale placeholders |

## Verification and lifecycle

- Synthetic shadow-DOM fixtures cover room-order changes, nameless rows, incomplete image avatars, offscreen rows, empty lists, the deadline, cleanup and zero-sized minimized lists. Native scroll position and prior inline styles/ARIA state are retained.
- Native measurement on 2026-11-17: row frame 60px, padding 8px 12px, gap 8px; scroller is in the nav shadow root, rows are inside the scroller shadow root. Avatars render `[avatar]` with a snoovatar/SVG or image. The page registers `faceplate-shimmer`, reused when available with a reduced-motion fallback.
- Early chat-root observation and bounded 100ms shadow-hydration probes find the first list before document-idle controls; existing content-script discovery is a backup. Starting the hold disconnects these observers and cancels hydration probing; releasing it clears both bounded timers and removes its listeners and overlay. Later discovery does nothing. Hidden/pagehide/detached scroller/invalid extension context release it.

- Live packaged Chrome check: placeholder and native scroller bounds matched exactly (299.44px by 586.46px, top107.99px); placeholder rows matched native60px. The first hold was observed at1198ms and released by1923ms, with no remaining overlay. Chrome isolated worlds can have a null custom-element registry; the themed fallback handles this without blocking startup. The original long-gap nameless startup and all display modes were not reproduced live.

## Limits

The first list paint is delayed by up to 300 ms on a warm open in exchange for never showing the bottom-up churn. Reddit's data and order are unchanged; when Reddit itself takes longer than 4.5 s, the remaining churn is visible as before.
