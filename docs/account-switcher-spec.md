# Account switcher (2026-11-17)

User request: switch between Reddit accounts easily, built into Reddit's own interface at the right places (desktop and phone, transitions handled), with a copy in the extension popup; extension settings stay shared. User decisions: the extension stores each saved account's Reddit session on this device (an explicit exception to AGENTS.md "keep credentials inside Reddit's page world", recorded there); a second account is added through an "Add account" flow.

## Measured (live, read-only, cookie names only)

- Reddit's web app has no account switcher; its account menu lists View Profile, Edit Avatar, Drafts, Achievements, Earn, Premium, Mod Mode, Display Mode, Log Out, Advertise, Reddit Pro and Settings.
- Desktop: the avatar button (`#expand-user-drawer-button`) opens an `rpl-dropdown` whose `#user-drawer-content` holds `li[rpl].relative.list-none.mt-0 > a.flex.justify-between…py-xs` rows. Phone (below 768 px): it opens a bottom sheet `#hui-user-drawer-bottom-sheet > rpl-modal-card > ul > (faceplate-tracker >) li > a` with the same rows.
- reddit.com cookies: the signed-in session is `reddit_session` and `token_v2` (both HttpOnly, invisible to page scripts), with account-tied `loid`, `csrf_token` and `session_tracker`. The rest are analytics or device preferences (`_ga*`, `FP*`, `edgebucket`, `pc`, `csv`, chat view, media codecs, sort) and are left alone.

## Behaviour

- **Saved accounts** (worker, `chrome.storage.local` key `rt-accounts-v1`): per account ID (`t2_…`), its username, avatar URL, saved time and a snapshot of the five session cookies. Cookie values never leave the worker: pages and the popup receive names, avatars, which one is current and whether a session expired. Storage is restricted to trusted extension contexts.
- **Remembering:** a signed-in Reddit page reports its account (logged-in account ID from `shreddit-app`, username and avatar from the account menu or own-profile identity). A saved account's snapshot is refreshed then, so rotating tokens stay current. An unsaved account is saved the first time the account menu shows the Accounts section or Add account is used.
- **Switch:** re-save the current account's cookies, remove the five session cookies, set the target's snapshot, then reload every open Reddit tab. The tab that switched shows Reddit's loader until it reloads.
- **Add account:** asks once more ("Select again to continue"), saves the current account, removes only the sign-in cookies (`reddit_session`, `token_v2`) locally — `loid`, `csrf_token` and `session_tracker` stay so Reddit's sign-in form remains valid, and other tabs are not reloaded (simultaneous reloads raced the sign-in page for fresh cookies) — then opens `https://www.reddit.com/login/` in the same tab (a new tab from the popup). Reddit's Log Out is never called, so the saved session stays valid. After signing in, the page reads its own name from `/api/me.json` and the new account is saved.
- **Not signing in:** if the sign-in tab leaves Reddit's sign-in pages (`/login`, `/register`, `/account`, `/password`, …) still signed out, or is closed while signed out, the previous account's session is put back and Reddit tabs reload as it. A signed-out page in another tab ends it only after 10 minutes, so loading Reddit elsewhere never cuts a sign-in short.
- **Only real input acts:** rows ignore scripted clicks (`isTrusted`).
- **Expired session:** if after a switch the page signs in as a different account or is signed out, the target is marked "Sign in again"; choosing it then runs Add account.
- **Remove:** forget a saved account (its snapshot is deleted); the current session is untouched.
- **Data:** every extension store is already keyed by account ID (Removed list and checks, viewed History, archive caches, chat search); the per-tab signed-in name cache is bound to the account ID (fixed separately), so switching never shows one account's data under another.

## Interface

- **Reddit's account menu** (desktop dropdown and phone bottom sheet): an "Accounts" group directly after View Profile — one row per saved account (Reddit's avatar row markup, `u/name`, a checkmark on the current one, "Sign in again" caption when expired) and an "Add account" row — separated by Reddit's own divider. Rows are Reddit's menu rows (same classes), so hover, focus and phone sizing match.
- **Popup:** an Accounts card with the same list, Switch and Remove actions, and Add account. It works when a Reddit tab is open; otherwise Add account opens Reddit.

## Transitions

| | Transition | Expected |
|---|---|---|
| T1 | Open the account menu (desktop) | Accounts group after View Profile; current account checked |
| T2 | Open the account menu (phone) | Same group inside Reddit's bottom sheet, rows full width |
| T3 | Switch to a saved account | Current re-saved, cookies swapped, all Reddit tabs reload as the target |
| T4 | Add account | Current saved, local session cleared, login page opens; next sign-in saved |
| T5 | Switch to an expired session | Marked "Sign in again"; Add account flow instead |
| T4b | Add account, then leave or close sign-in | Previous account restored; Reddit tabs reload signed in |
| T6 | Remove an account | Gone from both lists; nothing else changes |
| T7 | Reddit re-renders the menu | Group re-inserted once, never duplicated |
| T8 | Extension turned off / signed out | No Accounts group; saved accounts stay until removed |

## Limits

Sessions are stored unencrypted in extension storage on this device (any extension-level compromise could read them); removing an account deletes its snapshot. Reddit can revoke a session at any time (password change, Log Out elsewhere), which shows as "Sign in again". Switching reloads open Reddit tabs, so unsent drafts in them can be lost.
