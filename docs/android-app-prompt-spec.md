# Android app prompt

When the modern Reddit site presents its Android app-promotion dialog, use the dialog's own browser continuation. The page stays open and Reddit manages dismissal and focus. The extension runs in the top-level Android document and recognizes the prompt by its title, app action, and separate browser action. It leaves other dialogs and prompts without a safe browser action in place.

| Transition | Expected behavior |
|---|---|
| A visible prompt is present on initial load (T1) | Invoke the web action once. |
| Reddit adds or hydrates the prompt (T7) | Wait until the prompt exposes a visible and enabled browser action. A dialog within an app-promotion sheet receives one click. |
| Back or Forward restores the page (T3, T4) | Preserve the existing dismissal. A new prompt receives its own browser continuation. |
| Non-Android viewport or another dialog (T15) | Preserve Reddit's normal handling. A community age or access prompt cannot qualify as an app promotion. |

The extension adds no markup. A document observer discovers native HTML and recognized open shadow roots. Weak references prevent duplicate actions without retaining discarded dialogs. The unit fixtures cover English controls, including the Chrome row's short Continue label. Other languages and variants without a recognized action retain the native dialog.
