# Chat scrolling reconciliation

## Goal and observed behavior

Native chat scrolling should not repeatedly run full extension discovery as Reddit virtualizes rows. Discovery must still reconcile current data after scrolling and promptly respond to navigation. This applies to the full-screen and floating chat, including a transition to or from minimized chat.

In a visible live chat-list capture, 30 synthetic wheel events produced 30 scroll events. Reddit's `rs-roving-focus-native` replaced `rs-rooms-nav-room` children and text nodes, and virtual-scroll spacer styles changed. The extension's broad mutation observer scheduled repeated full discovery. The 120 ms scheduled callbacks took 268.91 ms inclusive across 16 calls (maximum 19.40 ms) during the trace. This is evidence of extension work during that capture, not proof that every report of jank has the same cause.

## Behavior and transitions

| Transition | Expected behavior |
|---|---|
| Idle → native chat scrolling | Ordinary native mutations queue reconciliation; while the native scroller is active, defer expensive discovery until 180 ms of quiet. |
| Scrolling continues | Reconcile within 1.2 s of the first queued refresh, even if no pause occurs; later mutations can queue another refresh. Do not discard mutations or start a new sync loop. |
| Scrolling → pause | Read the latest native list and message state after the pause, including updates received while scrolling. |
| Scrolling → sidebar route change or extension control removed | Reconcile immediately, preserving the native first-paint restoration path and bounded discovery follow-up. |
| Full-screen ↔ floating ↔ minimized, or room/sidebar replacement | Existing root discovery and control mount, suspend, restore, and removal remain in effect. Scroll listeners follow discovered roots and are removed when roots disappear. |
| Page unload | Cancel queued work and remove observers and scroll listeners. |

Only native elements matching the adapter's scroller selectors start the quiet period; scrolling extension-owned search results does not. The existing discovery heartbeat also defers during a native gesture. Search history completeness and account scoping are unchanged.

## Validation

`tests/mobile-search-lifecycle.test.cjs` exercises deferred reconciliation, the maximum wait during continuous scrolling, and immediate route changes while scrolling, along with existing mobile restoration and unload tests. Before implementation the deferral test failed with two repeated synchronizations; it passed after implementation.

In matched visible live captures after packaging, 30 synthetic wheel events again moved the list from 133 to 4,000 px. Scheduled callback time fell from 268.91 ms to 72.80 ms inclusive; calls over 1 ms fell from 16 to 4. Heartbeat callbacks fell from 45.31 ms to 0.15 ms in those captures. The longest remaining scheduled callback was 19.26 ms. These short traces include scrolling and one second afterward; they do not establish performance for physical input, message-pane scrolling, all device sizes, or native Reddit without the extension.
