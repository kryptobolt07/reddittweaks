# Videos: respect "Autoplay media" off, pause when scrolled away (2026-11-18)

User report (phones): turning off autoplay in Reddit's settings has no effect, and a playing video keeps playing until it is far off screen.

## Measured (live, read-only, phone view 390×844)

- Reddit's player is `shreddit-player` (attributes include `is-mobile`, `single-playback`, `player-type=in_feed_player`) with an open shadow root holding the `<video>` (`autoplay=false`, `preload=metadata`): playback is started by Reddit's script, not the `autoplay` attribute.
- On Brave desktop, opening a native video post changes the URL while the original `in_feed_player` is still mounted. Reddit then replaces it with a `post_detail_screen` player with the same `post-id`. The feed card's title and full-post links both point to the post permalink.
- The feed host's ordinary disconnect calls `stop()`, which pauses and clears the media source. Reddit's player has a reparenting hook that suppresses both disconnect teardown and its off-screen pause while native playback moves between containers. Reddit also calls its background pause at the start of an in-app route change. Suppress that call on the held player while the tab is visible, and restore its normal handler on placement or cancellation.
- In Brave with 0.45.1 installed, the outgoing feed remained visible after the post URL changed. The moved player was fully in view at post load (381 px high at y=168 in a 687 px viewport), but the extension's scroll-away observer paused it at placement.
- With lazy loading, the detail player can have no active source until Reddit initializes it. Calling its native `load('metadata')` method attaches the source and loads metadata without starting playback.
- `/api/v1/me/prefs` is not readable from the page (401/403). Reddit's settings page (`/settings/preferences`) carries the account's preferences in `settings-preferences[initialstate]`, including `isVideoAutoplayDisabled` (true for the user's account), yet videos autoplayed.

## Behaviour

- **Respect Reddit's “Autoplay media” setting** (`videoRespectAutoplay`, default on): the preference is read once per browser session per signed-in account (session storage, bound to the account ID; re-read after 1 hour or after visiting Reddit's settings). When autoplay is off, a video that starts playing without a tap, click or key on that same player within the last 1.5 s is paused at once. Playing after your own tap is never touched. Signed out or unknown preference: nothing is blocked.
- **Silent previews** (`videoPreviews`, default on, sub-option of the above): instead of pausing Reddit's autoplay, the video plays muted, looping its first 10 s; scrolling away pauses it and resets it to where it started, so it never advances. Your tap ends the preview: back to the start, Reddit's sound setting restored, playing. There is no on-screen "Preview" badge.
- **Keep playing when opening a post** (`videoContinueOnOpen`, default on): on same-document navigation, keep the live player and its media buffer mounted while Reddit prepares the post. Move that player into the matching detail slot without seeking or calling Play again. A cancelled open returns the player to its feed slot. A full navigation or a native player without the reparenting hook uses the saved position and sound settings. The handoff expires after 12 seconds. Media controls, other links, new-tab clicks, paused videos and silent previews leave playback alone.
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
| T8 | Reddit keeps the outgoing feed mounted while the post loads | Hide the outgoing content without collapsing its layout. The original video stays visible and playing until it occupies Reddit's detail slot |
| T9 | Use a player control, open a different page, go back before the video loads, or turn continuation off | Release the move and restore the feed slot when still mounted |
| T10 | Back after a completed move | The retained feed still has its own native player, and the old detail player cannot keep playing offscreen |
| T11 | The post settles and the reader scrolls away | Discard visibility readings from before or during the player move. Measure the player in the painted post and pause when a fresh reading shows it below the scroll-away threshold |

## Limits

The preference read is a one-off request for Reddit's settings page (about 400 KB) per browser session per account. A video Reddit starts may play for a fraction of a second before it is paused.
Native buffering can still interrupt a video. A full document navigation cannot carry the original media element across documents. If the browser blocks playback after such a navigation, the video is positioned for the user's next Play press.

## Verification

A clean Chromium profile running only this extension loaded a real Reddit feed, started a video with Reddit's own control, then opened its title. The same video stayed connected, advanced from 0.54 s to 1.40 s during the 0.86 s transition, and continued to 2.29 s. It emitted no pause, seek, waiting or source-reset events during the move. Synthetic tests also cover retained feeds, cancelling the move, a fresh document, delayed metadata and continuation with Reddit autoplay disabled.

On live Reddit in Brave, the outgoing feed and its main column were hidden through the move. The same video advanced from 0.77 s on the feed to 2.03 s at placement and 4.38 s after the post settled, with no pause event. Synthetic checks inject an outdated intersection report and then a fresh scroll-away report to exercise both paths.
