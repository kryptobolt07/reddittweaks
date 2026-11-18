# Videos: respect "Autoplay media" off, pause when scrolled away (2026-11-18)

User report (phones): turning off autoplay in Reddit's settings has no effect, and a playing video keeps playing until it is far off screen.

## Measured (live, read-only, phone view 390×844)

- Reddit's player is `shreddit-player` (attributes include `is-mobile`, `single-playback`, `player-type=in_feed_player`) with an open shadow root holding the `<video>` (`autoplay=false`, `preload=metadata`): playback is started by Reddit's script, not the `autoplay` attribute.
- On Brave desktop, opening a native video post changes the URL while the original `in_feed_player` is still mounted. Reddit then replaces it with a `post_detail_screen` player with the same `post-id`. The feed card's title and full-post links both point to the post permalink.
- With lazy loading, the detail player can have no active source until Reddit initializes it. Calling its native `load('metadata')` method attaches the source and loads metadata without starting playback.
- `/api/v1/me/prefs` is not readable from the page (401/403). Reddit's settings page (`/settings/preferences`) carries the account's preferences in `settings-preferences[initialstate]`, including `isVideoAutoplayDisabled` (true for the user's account), yet videos autoplayed.

## Behaviour

- **Respect Reddit's “Autoplay media” setting** (`videoRespectAutoplay`, default on): the preference is read once per browser session per signed-in account (session storage, bound to the account ID; re-read after 1 hour or after visiting Reddit's settings). When autoplay is off, a video that starts playing without a tap, click or key on that same player within the last 1.5 s is paused at once. Playing after your own tap is never touched. Signed out or unknown preference: nothing is blocked.
- **Silent previews** (`videoPreviews`, default on, sub-option of the above): instead of pausing Reddit's autoplay, the video plays muted, looping its first 10 s; scrolling away pauses it and resets it to where it started, so it never advances. Your tap ends the preview: back to the start, Reddit's sound setting restored, playing. There is no on-screen "Preview" badge.
- **Keep playing when opening a post** (`videoContinueOnOpen`, default on): opening the playing video's own permalink in the same tab carries its latest position, volume, mute setting and speed to the post player. The feed player can keep playing while Reddit prepares the post. The handoff waits for the matching detail player's metadata and pauses any remaining feed playback when the post takes over. It expires after 12 seconds. Media controls, other links, new-tab clicks, paused videos and silent previews leave playback alone.
- **Pause videos that scroll away** (`videoPauseOffscreen`, default on): a playing video pauses as soon as less than half of it is on screen, including a video continued into a post. It does not resume by itself. This is independent of the option above.
- All apply to `shreddit-player` and `shreddit-player-2` anywhere on Reddit (feeds, posts, search), on phones and desktop.

## Transitions

| | Transition | Expected |
|---|---|---|
| T1 | Feed with autoplay off scrolls a video into view | Reddit starts it; it is paused immediately; poster stays |
| T2 | Tap play | Plays normally |
| T3 | Scroll a playing video half off screen | Paused |
| T4 | Scroll it back | Stays paused (autoplay off) until tapped |
| T5 | Autoplay on in Reddit | Reddit's autoplay kept; only the off-screen pause applies |
| T6 | Start a feed video, open its post | The post player starts at the latest feed position with the same sound and speed |
| T7 | Continue a video into a post, then scroll it half off screen | Paused; the scroll-away option still applies |
| T8 | The URL changes before the old feed player leaves, or the detail player mounts before its video | Only the matching detail video consumes the handoff once its metadata is ready |
| T9 | Use a player control, open a different page, go back before the video loads, or turn continuation off | No outstanding handoff is applied |

## Limits

The preference read is a one-off request for Reddit's settings page (about 400 KB) per browser session per account. A video Reddit starts may play for a fraction of a second before it is paused.
Reddit can remove or pause its old player before the new one is ready, which may cause a brief interruption. If the browser blocks playback on a full navigation, the video is positioned for the user's next Play press.

## Verification

On live Reddit in Brave desktop, a video started through the native feed control was at 14.396 s when its post opened. The detail player began at 14.402 s, preserved 1.25× speed and the unmuted state, and played after Reddit detached the feed player. Synthetic tests cover a fresh document, delayed metadata, Back before playback, unrelated clicks and continuation with Reddit autoplay disabled.
