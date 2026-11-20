# Mobile app prompt

When the modern Reddit site presents an app-promotion dialog on Android or iOS, keep the current web page open. For the app-only blocking promotion, remove its owning element before Reddit mounts the overlay. For a promotion with an explicit browser action, use that action. The extension runs in the top-level mobile document and leaves unrelated dialogs in place.

**Settings → Browsing → Hide Mature Content overlay on mobile** controls removal of the app-only promotion. The default is on for existing and fresh installs. Read the preference before handling a blocking promotion. On T10, turning the setting on removes an existing matching promotion. Turning it off leaves subsequent promotions in place. Refresh the Reddit page to restore a promotion already removed.

**Reveal NSFW media on mobile posts** is a separate setting and defaults off. The native mobile post showed `shreddit-blurred-container[reason="nsfw"][blurred]` inside its media slot. Use the existing reveal button for that component, or the archive renderer's equivalent button, only for the post ID in the current URL. A spoiler-only overlay, a recommendation and a feed card remain outside this setting. A new toggle or route change can reveal the current post after its media controls hydrate.

| Transition | Expected behavior |
|---|---|
| A promotion is present on initial load (T1) | Remove its app-only owner or invoke the web action once. |
| Reddit adds or hydrates the prompt (T7) | Recognize the app-only promotion before it opens. An ordinary app-promotion sheet receives one click after its browser action becomes available. |
| Back or Forward restores the page (T3, T4) | Preserve the existing dismissal. A new prompt receives its own browser continuation. |
| Desktop or another dialog (T15) | Preserve Reddit's normal handling. The app-only match requires the exact promotion owner and dialog ID. |

The extension adds no markup. A document observer discovers native HTML and recognized open shadow roots. Weak references prevent duplicate actions without retaining discarded dialogs. The unit fixtures cover English controls, including the Chrome row's short Continue label. Other languages and variants without a recognized action retain the native dialog.

The existing `/r/totalkalesh/` tab in regular Chrome supplied the native `configured-xpromo-modal > rpl-dialog` structure. The **Mature Content** promotion's template contains **View In App** and **Go Home**. The feed already contains its rendered posts beneath the promotion. The extension removes only that promotion and leaves the existing feed and URL in place.
