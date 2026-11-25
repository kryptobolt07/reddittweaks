# Store listing: Chrome Web Store and Firefox Add-ons

Copy and settings for both store listings, ready to paste. Images are built locally into
`artifacts/store-listing/final/` (ignored): screenshots `01`–`05` (Chrome and Firefox), extras `06`–`08` (Firefox
only, or swap into Chrome), `store-icon-128.png`, `promo-small-440x280.png` and `promo-marquee-1400x560.png`. Chat
screenshots use the synthetic demo in `demo/`. Live screenshots use public SFW posts, with account names replaced.

## Shared fields

| Field | Value |
|---|---|
| Name | Reddit Tweaks |
| Homepage | https://github.com/kryptobolt07/reddittweaks |
| Support | https://github.com/kryptobolt07/reddittweaks/issues |
| Privacy policy | https://github.com/kryptobolt07/reddittweaks/blob/main/PRIVACY.md |
| Language | English |
| Mature content | No |

## Chrome Web Store

**Summary** (132 characters max; this is 113, the same as the manifest description):

> Better feeds, media playback, account switching, downloads, raffles, chat search and profile archives for Reddit.

**Category:** Social Networking (under Lifestyle). Functionality & UI is the alternative.

**Screenshots** (1280 × 800, 24-bit PNG, no alpha), in this order:

1. `01-chat-search.png`: find any message in every Reddit chat
2. `02-feeds.png`: one Sort & filter menu for every feed
3. `03-media.png`: videos and media your way: playback settings, Download media and Find visually similar
4. `04-hidden.png`: removed comments restored, profile search, banned communities
5. `05-accounts-tools.png`: switch accounts, anonymous browsing, redaction and your removed content

**Promo tiles:** small `promo-small-440x280.png`, marquee `promo-marquee-1400x560.png`. **Store icon:** `store-icon-128.png`.

**Official URL:** leave empty unless you verify a domain in Google Search Console.

### Description (plain text: the Chrome store shows no Markdown)

```text
The Reddit website, finished.

Reddit Tweaks adds what's missing to reddit.com, inside Reddit's own pages and styled like Reddit's own menus and buttons. It isn't a different app or a new theme. Every feature has its own switch in the toolbar popup. Everyday improvements are on from the start. Anything that uses a service outside Reddit stays off until you turn it on.

CHAT SEARCH
• A real search box in Reddit chat: full-page chat and the floating chat window.
• Search People, Messages or All, with every match highlighted. Click a result to jump straight to that message.
• Search every chat, including old conversations Reddit no longer lists.
• Filters: from:me, from:name, has:image, has:link, "exact phrases" and a date picker for on, before, after or between.
• Private by design: messages are indexed on your device as you use chat, never uploaded. See how much is stored and clear it from the popup.

FEEDS
• One Sort & filter menu on Home, Popular, All, communities and custom feeds: sort, card or compact view, and filters for post type (text, images, GIFs, videos, galleries, links, polls and more), flair, community and date.
• Show posts awaiting approval in communities you moderate.
• Smooth scrolling on long feeds, profiles and search results.
• Back returns you to the same posts in the same place, instead of reloading from the top.
• Clean shared links without tracking parameters.

VIDEOS AND MEDIA
• Decide how Reddit videos, GIFs and players embedded from other sites start: Reddit's default, autoplay muted, preview on hover, or only when you press Play.
• Decide what a click does: play in place, open the post, or go full screen.
• A playing video carries on into its post without restarting.
• One video at a time, remembered volume, hold for 2× speed, loop rules, preferred quality and a data saver, and a floating mini-player.
• Download images, galleries, GIFs and videos.

PROFILES AND SEARCH
• Search anyone's posts and comments, including posts Reddit hides from their profile.
• See when an account has blocked you, and view its public profile anyway.
• Keep up to 5,000 viewed posts (or all of them) instead of Reddit's last 20, searchable and stored only in your browser.
• One search language everywhere: "exact phrases", OR, -exclusions, (groups), title:, u/, r/, site:, flair: and type:image. Press Ctrl+/ in a search box for tips.

ACCOUNTS AND YOUR CONTENT
• Switch accounts from Reddit's own account menu, or browse anonymously, without signing out and in.
• Redaction: overwrite or delete your old posts and comments in bulk, filtered by community, with a review step before anything changes.
• See which of your posts and comments were removed, with an optional count of new changes on the toolbar icon.

THE ARCHIVE (OPTIONAL, OFF BY DEFAULT)
Turn on "Use the archive" to use Arctic Shift, a public Reddit archive:
• Read deleted and removed posts and comments where they used to be, with their images and authors.
• Open banned and private communities and search their old posts.
• Find activity missing from profiles, including deleted and suspended accounts.
• Keep scrolling a filtered feed after Reddit's listing ends.

VISUAL SEARCH (OPTIONAL, OFF BY DEFAULT)
• A Visual tab in Reddit search that finds images, GIFs and videos by what they look like.
• Search with your own picture (upload, paste or drag), or find posts that look like the one you're viewing.

MORE TOOLS
• Raffles: pick winners from a post's commenters, right from its ⋯ menu.
• Comment tools: color-coded threadlines, jump buttons, collapse AutoModerator, a better comment composer.
• On phones: keep browsing when Reddit pushes its app, and choose whether the top bar stays, hides as you scroll, or stays hidden.

PRIVACY
• No analytics, no tracking, no account. Nothing is sent to the developer.
• Your chats, history and settings stay in your browser.
• Optional services (Arctic Shift for the archive, infini.wtf for Visual search, RedditRaffler for public raffles) receive only what each feature needs, and only after you turn it on.
Full details: https://github.com/kryptobolt07/reddittweaks/blob/main/PRIVACY.md

Works on www.reddit.com (not old.reddit.com), signed in or out. Chat search, account switching, redaction and your removed content need you signed in.

Reddit Tweaks is an independent project. It is not affiliated with or endorsed by Reddit, Inc.
```

### Privacy practices tab

**Single purpose:**

> Reddit Tweaks improves the reddit.com website. It adds search, feed filters, media playback controls, account switching and archive tools inside Reddit's own pages.

**Permission justifications:**

| Permission | Justification |
|---|---|
| `storage` | Saves the user's settings, and the chat search index and viewed-post history on the device. |
| `unlimitedStorage` | The on-device chat search index and viewed-post history can be larger than the default storage quota. Nothing leaves the device. |
| `cookies` | Account switching only: saves and restores the reddit.com session cookies of accounts the user adds, so they can switch accounts without signing out. Cookie values stay in the extension's background worker and are never shown to pages or sent anywhere. |
| `scripting` | After install or update, adds the extension's scripts to reddit.com tabs that were already open, so features work without reloading them. |
| `declarativeNetRequestWithHostAccess` | Sets the Referer header on two requests that need it: Reddit's signed-out profile search, and creating a public raffle on RedditRaffler. |
| `downloads` | The "Download media" feature saves images, galleries, GIFs and videos from Reddit posts through the browser's download manager. |
| Host permission: reddit.com | The extension runs on Reddit's pages and reads Reddit's own data for search, feeds, profiles and chat. |
| Host permission: arctic-shift.photon-reddit.com | Optional archive feature (off by default): restores deleted posts and comments, and banned or private communities, from the Arctic Shift public archive. |
| Host permission: infini.wtf, video.infini.wtf | Optional Visual search (off by default): finds Reddit images and videos by appearance. |
| Host permission: redditraffler.com | Optional public raffles: creates and reads verifiable raffle results for a post. |
| Optional host permissions (redd.it image hosts, video embed sites) | Requested only when the user turns on the matching feature: reading a post's image for Visual search, and controlling embedded video players (sound, play, pause) on Reddit pages. |

**Remote code:** No, I am not using remote code. All JavaScript ships in the package.

**Data usage.** Google's User Data FAQ says data handled only on the device must still be disclosed, so tick these five:

- Personally identifiable information: Reddit usernames (saved accounts for the switcher; usernames looked up in the optional archive are sent to Arctic Shift). Google lists "username" as PII.
- Authentication information: session cookies of accounts the user adds to the account switcher, stored locally.
- Personal communications: Reddit chat messages, indexed locally for chat search.
- Web history: viewed Reddit posts, if the user raises History length.
- Website content: Reddit posts, comments and images that features read, save or search (post IDs and images go to the optional archive and Visual search services).

Leave unticked: Health, Financial and payment, Location (no geolocation or IP collection), User activity (no click, scroll or keystroke monitoring).

Certify all three: data is not sold to third parties, not used or transferred for purposes unrelated to the single purpose, and not used to determine creditworthiness or for lending.

## Firefox Add-ons (addons.mozilla.org)

| Field | Value |
|---|---|
| Name | Reddit Tweaks |
| Add-on URL slug | `reddit-tweaks` |
| Summary (250 characters max) | Search your Reddit chats, filter any feed, decide how videos play, switch accounts, and bring back what Reddit hides. Free, no tracking, everything stays in your browser. |
| Categories, desktop (up to 2) | Social & Communication; Photos, Music & Videos |
| Categories, Android | Social Networking; Photos & Media |
| Tags | reddit, search, video, feed, privacy |
| Support email | optional (leave empty or use a project address) |
| License | The repository has no LICENSE file yet. Pick one on AMO (for example MIT) and add it to the repo, or choose "All Rights Reserved". |
| Requires payment / experimental | No / No |

**Description:** AMO supports basic Markdown. Use the Chrome description above, with two changes:

1. Replace the bullet "See when an account has blocked you, and view its public profile anyway." with "See when an account has blocked you." (the signed-out view uses a Chromium-only feature).
2. Add after the privacy section: "Firefox 140 or later on desktop, Firefox 142 or later on Android."

**Screenshots:** the same five, then `06-visual-search.png`, `07-chat-floating-dark.png` and `08-settings.png`, with these captions:

1. Search every Reddit chat: people, messages, or both, with every match highlighted and a date picker for any range.
2. One Sort & filter menu on every feed: sort, card or compact view, and filters for post type, flair, community and date.
3. Choose how videos, GIFs and embeds start, download media, and find posts that look alike from the ⋯ menu.
4. Read removed and deleted comments where they used to be, with the optional archive.
5. Switch Reddit accounts from Reddit's own menu or the toolbar, without signing out.
6. Visual search (optional): find images and videos by what they look like, or search with your own picture.
7. Chat search works in full-page chat, the floating chat window and minimized chat, in light or dark.
8. Every feature has its own switch. No analytics, no tracking, and your data stays in your browser.

**Data collection:** the Firefox build already declares `searchTerms`, `browsingActivity`, `websiteContent` and `personalCommunications` in the manifest, so Firefox shows them at install. They cover requests to Reddit and to the optional archive, Visual search and raffle services.

**Notes to reviewer:**

> No build step or minification: the uploaded ZIP is the source. The source ZIP adds scripts/package.py and BUILDING.md, which rebuild the add-on ZIP offline with only the Python standard library. Most features need a reddit.com account to see (chat search, account switching, redaction). Optional services are off until the user turns them on in the popup: Arctic Shift (archive), infini.wtf (Visual search), RedditRaffler (public raffles). No analytics or telemetry.
