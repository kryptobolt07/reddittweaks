# Videos: respect "Autoplay media" off, pause when scrolled away (2026-11-18)

User report (phones): turning off autoplay in Reddit's settings has no effect, and a playing video keeps playing until it is far off screen.

## Measured (live, read-only, phone view 390×844)

- Reddit's player is `shreddit-player` (attributes include `is-mobile`, `single-playback`, `player-type=in_feed_player`) with an open shadow root holding the `<video>` (`autoplay=false`, `preload=metadata`): playback is started by Reddit's script, not the `autoplay` attribute.
- `/api/v1/me/prefs` is not readable from the page (401/403). Reddit's settings page (`/settings/preferences`) carries the account's preferences in `settings-preferences[initialstate]`, including `isVideoAutoplayDisabled` (true for the user's account), yet videos autoplayed.

## Behaviour

- **Respect Reddit's “Autoplay media” setting** (`videoRespectAutoplay`, default on): the preference is read once per browser session per signed-in account (session storage, bound to the account ID; re-read after 1 hour or after visiting Reddit's settings). When autoplay is off, a video that starts playing without a tap, click or key on that same player within the last 1.5 s is paused at once. Playing after your own tap is never touched. Signed out or unknown preference: nothing is blocked.
- **Pause videos that scroll away** (`videoPauseOffscreen`, default on): a playing video pauses as soon as less than half of it is on screen. It does not resume by itself.
- Both apply to `shreddit-player` and `shreddit-player-2` anywhere on Reddit (feeds, posts, search), on phones and desktop.

## Transitions

| | Transition | Expected |
|---|---|---|
| T1 | Feed with autoplay off scrolls a video into view | Reddit starts it; it is paused immediately; poster stays |
| T2 | Tap play | Plays normally |
| T3 | Scroll a playing video half off screen | Paused |
| T4 | Scroll it back | Stays paused (autoplay off) until tapped |
| T5 | Autoplay on in Reddit | Reddit's autoplay kept; only the off-screen pause applies |

## Limits

The preference read is a one-off request for Reddit's settings page (about 400 KB) per browser session per account. A video Reddit starts may play for a fraction of a second before it is paused.
