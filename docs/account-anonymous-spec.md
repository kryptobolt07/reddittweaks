# Anonymous browsing

Selecting Anonymous browsing saves the current account's existing five-cookie snapshot, clears only the two authentication cookies, marks intentional anonymous state in worker storage, and reloads Reddit tabs. Device and analytics cookies stay untouched. An unsaved signed-in session must never be discarded. Account metadata and an `anonymous` boolean are the only state returned to pages and the popup; cookies remain worker-only.

The intentional signed-out state survives service-worker restarts and signed-out observations. Listing reports `current: ''` and `anonymous: true`; switching to a saved account or observing a native sign-in exits anonymous mode. Adding another account from anonymous opens Reddit sign-in without restoring an earlier account if the flow is canceled. Cookie operations are serialized, and failed transitions restore the original session and state where possible.
