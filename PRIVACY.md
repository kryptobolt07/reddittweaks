# Privacy

Reddit Tweaks runs in your browser. It has no account system, no analytics and no telemetry, and it sends nothing to its developers.

## What stays on your device

| Data | Why | How to remove it |
|---|---|---|
| Your settings | To remember your choices | Uninstall the extension |
| Chat directory and saved messages (when **Chat search** is on) | To search your Reddit chats and messages offline and instantly | Popup → Data → **Clear saved messages** / **Clear saved usernames** |
| Viewed-post history (only if you raise **History length**) | To keep more than Reddit's last 20 viewed posts | Set **History length** back to Reddit's default |
| Saved accounts (when you use **Switch accounts**) | To switch between your Reddit accounts | Remove the account from the switcher |

Saved accounts keep each account's Reddit session cookies in extension storage that only the extension's background worker can read. They are never shown to web pages or the popup.

## What is sent elsewhere, and when

Reddit Tweaks talks to Reddit the same way Reddit's own site does when you browse. A few optional features use outside services, and only when you turn them on or use them:

| Feature | Service | What it receives |
|---|---|---|
| **Use the archive** (off by default): restore deleted posts and comments, browse banned or private communities, find hidden activity | [Arctic Shift](https://arctic-shift.photon-reddit.com) | Usernames, community names, post and comment IDs and search words being looked up |
| **Visual search** (off by default) | [infini.wtf](https://infini.wtf) | Your visual search words, links to public posts you search from, and images you choose to search with (resized, with metadata removed). Never your Reddit account or cookies |
| **Raffles**, public draws only | [RedditRaffler](https://www.redditraffler.com) | The post link and the raffle rules you set |
| **Direct embed controls** (asks for permission first) | The video players already embedded in Reddit posts | Nothing extra: it only lets the extension control players that are already loaded |

Downloads use your browser's own download manager.

## Permissions

- **Storage and unlimited storage**: settings, chat search and history on your device.
- **Cookies**: only for switching between your saved Reddit accounts.
- **Scripting**: to run on Reddit pages.
- **Declarative net request**: to set the `Referer` header on two kinds of request that need it: signed-out profile search on Reddit, and creating a public raffle on RedditRaffler.
- **Downloads**: for **Download media**.
- **Site access**: Reddit, plus the services listed above. Turning on Visual search also asks for Reddit's image servers (i.redd.it, preview.redd.it, external-preview.redd.it), so the extension can read a post's picture when you search with it.

Reddit Tweaks is an independent project and is not affiliated with Reddit.
