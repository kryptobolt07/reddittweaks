# Videos: respect "Autoplay media" off, pause when scrolled away (2026-11-18)

User report (phones): turning off autoplay in Reddit's settings has no effect, and a playing video keeps playing until it is far off screen.

## Measured (live, read-only, phone view 390×844)

- Reddit's player is `shreddit-player` (attributes include `is-mobile`, `single-playback`, `player-type=in_feed_player`) with an open shadow root holding the `<video>` (`autoplay=false`, `preload=metadata`): playback is started by Reddit's script, not the `autoplay` attribute.
- On Brave desktop, opening a native video post changes the URL while the original `in_feed_player` is still mounted. Reddit then replaces it with a `post_detail_screen` player with the same `post-id`. The feed card's title and full-post links both point to the post permalink.
- Reddit exposes separate Play, playback toggle and mute buttons inside the player's native media controls. A playing video's surface also toggles playback, so the first click during a preview must be handled before that toggle.
- The feed host's ordinary disconnect calls `stop()`, which pauses and clears the media source. Reddit's player has a reparenting hook that suppresses both disconnect teardown and its off-screen pause while native playback moves between containers. Reddit also calls its background pause at the start of an in-app route change. Suppress that call on the held player while the tab is visible, and restore its normal handler on placement or cancellation.
- In Brave with 0.45.1 installed, the outgoing feed remained visible after the post URL changed. The moved player was fully in view at post load (381 px high at y=168 in a 687 px viewport), but the extension's scroll-away observer paused it at placement.
- With lazy loading, the detail player can have no active source until Reddit initializes it. Calling its native `load('metadata')` method attaches the source and loads metadata without starting playback.
- `/api/v1/me/prefs` is not readable from the page (401/403). Reddit's settings page (`/settings/preferences`) carries the account's preferences in `settings-preferences[initialstate]`, including `isVideoAutoplayDisabled` (true for the user's account), yet videos autoplayed.

## Measured 2026-11-19 (live, user's Chrome, frame logs and traces)

- Desktop 1280×625, previewed video opened from its title: the preview **paused** when the pointer moved from the player to the title (14.21 s, 0.64 s before the click), resumed **with sound** at the URL change, then floated alone for **0.81 s over a blank page** (the extension hides the outgoing feed) at its feed size 588×540. It snapped into Reddit's 303 px detail slot (the 180 ms ease is clamped to ±120 px and 0.85–1.15 scale), and Reddit's layout then moved the slot from y=267 to y=168. Playback itself was continuous (14.28 → 18.98 s, same element).
- Phone 390×844 (touch emulation): Reddit plays in-feed video muted; opening the post kept the same element playing (11.31 → 18.04 s, still muted), but the screen was **white except the floating video for about 0.6 s**, then the post appeared around it and the video grew from 358 px to the full 390 px.
- Without the extension, Reddit keeps the outgoing feed on screen until the post page is ready.
- Reddit keeps sound in its own volume state (`volumeController.setVolume`, saved as `@reddit/shreddit-player-media-volume` plus an in-memory session value). A new post player re-applies it to every player, and players Reddit counts as autoplay are muted unless sound was chosen this session. Setting `video.muted` directly was undone at post load (desktop and phone).
- Reddit re-applies its saved volume when a video starts, so a preview could start with sound once the saved state was unmuted.
- Reddit's autoplay observer pauses a player (`pause('scroll')`) while less than its threshold is visible unless the reparent window (`beginDomReparent`) is open; a moving picture that is partly off screen tripped it.
- Reddit's main thread is busy for 0.1–1 s while it renders the post; a frame-driven move got about four frames.
- Reddit's controls (play icon, poster) follow its own `play()`; a preview started with `<video>.play()` left the opened post showing Reddit's play icon over the playing video. Our plays now go through Reddit's player.
- Reddit's `play()` pauses a player its visibility observer has not reported yet (about 150 ms after load on the phone feed); such a play goes to the `<video>` directly.
- On a post page (Reddit autoplay off), our scroll-away rule paused the post's video at 42 % visible and nothing resumed it.

## Behaviour (expected, desktop and phone)

### Previews — the YouTube model
- A preview is **muted and inline**; it never takes the sound or the page by itself.
- **Desktop:** resting the mouse on a paused feed video for 160 ms starts its preview. Moving within the **same post card** (to its title, flair, votes) keeps it playing; leaving the card for 250 ms pauses it where it is.
- **Phones** (no hover): optional **in-view previews**, like YouTube's phone feed — once scrolling has stopped for 600 ms (or the feed has loaded without a scroll), the feed video that is at least 60 % visible and nearest the middle of the screen previews muted. A playing preview keeps going while you scroll until less than half of it is on screen; the next one starts only after scrolling stops again. Off by default, so turning off Reddit's autoplay still stops videos starting on their own.
- A preview stays muted even when Reddit's saved volume is unmuted.
- **Clicking or tapping a preview** follows *Clicking a preview*: **Open the post** (default, as YouTube does) or **Play here**. Reddit's own mute/volume button always works in place (a preview you unmute keeps playing where it is), as do captions, seeking and fullscreen.
- Opening a previewed video continues from *Opened previews start*: **where the preview is** (default) or **from the beginning**, with sound per *Sound when opening a preview* (default on; the sound fades in over 200 ms). Sound is turned on through Reddit's own volume state, as Reddit's sound button does, so the post's player keeps it.
- With Reddit's autoplay off, a video Reddit starts on its own (not a preview, not your tap) is paused.

### Keep playing when opening a post (shared-element transition)
- Opening a post whose video is playing (or previewing) keeps **the same video element** playing without a seek or reload.
- The **feed stays on screen**, exactly as Reddit leaves it, and the video stays at its place in its card until Reddit has laid out the post's video slot. Nothing is hidden and nothing blanks. The page bridge sets `html[data-rt-media-moving]` from the hold until placement; a type-filtered subreddit feed, which otherwise conceals itself during post navigation, stays visible (still filtered) while it is set.
- When the slot is laid out, the video takes it at once, and its picture moves from where it was in the card to the slot over **220 ms** (ease-out): one uniform scale from picture to picture (no distortion, no clamp), clipped to the card's box at the start, on the compositor so Reddit rendering the post cannot stall it. Tight `overflow: hidden` wrappers inside `shreddit-post` are temporarily unclipped during the 220 ms flight (while `clip-path` keeps the rounded corners) and restored on landing. Reddit's reparent window stays open until the move ends. Later layout shifts of the post page carry it with them. With reduced motion it takes the slot without moving.
- An explicit NSFW media reveal on the playing card carries into that same post: the extension waits for Reddit's native reveal button, clicks it, and waits for the blur to clear before placement. Direct visits, other posts, and spoiler covers keep their own reveal behavior.
- A video playing with sound keeps it in the post.
- While a playing video or embed is held for its post, its stage sits in document coordinates (`position: absolute`) so scrolling stays completely free and the browser compositor scrolls the player in pixel lockstep with its feed card without ever pausing playback or floating as an overlay. When Reddit removes the feed or resets `scrollY` for the post swap, the stage pins to its last on-screen viewport rect (or conceals if scrolled off-screen, on user scroll while pinned, or over an unrevealed blur/spoiler gate) while keeping playback alive for landing. Opening another page, Back before the post appears, a player control, or 12 s without a slot returns the video to its card. Back after the move: the feed card has its own fresh player and the post player stops.

### Scrolling away
- Feed: a playing video pauses when less than half of it is on screen and stays paused.
- Post page: the post's own video plays on while any of it is visible, pauses once it is fully out of view, and resumes at the same time when half of it is back (reloading Reddit's source first if Reddit unloaded it). A video the user paused stays paused.

### Popup options (Videos card, 2026-11-19, revised)
User decisions: options say only what the extension does, with no reference to Reddit's settings; the start choice replaces Reddit's own autoplay and its "Autoplay media" setting (no longer read, which also drops the ~400 KB settings-page fetch); the card adapts to phones. Keeping a playing video playing into its post is the default again (user report: the continuation looked lost once it became opt-in); a post's video keeps playing off screen, as on Reddit.

| Field | Choices (default first) | Setting key |
|---|---|---|
| Feed videos start (computers only) | **Autoplay, muted** (the video in view, one at a time, about 150 ms after scrolling) · Preview on hover, muted · Only when I press Play | `videoStart` |
| Feed videos start (phones only) | **Autoplay, muted** · Preview the one I stop on, muted (after 600 ms) · Only when I press Play | `videoStartTouch` |
| Clicking a muted video (hidden with Only when I press Play) | **Opens the post** · Shows controls, stays muted · Plays here with sound | `videoPreviewClick` |
| Once you open it, it plays (same) | **From where it was** · From the beginning | `videoPreviewFrom` |
| Sound when opening a preview (same; switch) | **On** | `videoUnmutePreview` |
| Opening a post that is playing | **Keeps playing in the post** · The post's player starts again | `videoOpenPost` |
| A post's video when you scroll past it | **Keeps playing off screen** · Pauses, and resumes when back | `videoScrollAway` |

- Each device shows only its own start row: the popup on a phone is a page on that phone (touch: `(hover: none), (pointer: coarse)`), and each device keeps its own extension storage.
- On touch screens the choice menus are up to 320 px wide with 44 px rows and 14 px text; the trigger keeps its 40 px height.
- Any video Reddit starts by itself is paused at once; Autoplay then plays the one in view through the same muted-preview path, so a click follows *Clicking a muted video* and its sound button unmutes in place.
- Migration: 0.48's `reddit` start becomes `autoplay`; only the 0.46–0.47 opt-ins carry over (phone previews → Preview the one I stop on; click plays here → Plays it here; restart → From the beginning). A choice is stored only once picked. The popup draws every switch and choice from its own synchronous copy of the settings on the first paint.

### One video at a time

Feed startup has separate choices for Reddit videos, GIFs, and embedded players. Each device has Autoplay, a muted preview mode (hover or stop scrolling), and Only on Play. Embeds inherit the saved video choice until configured, and GIFs default to Autoplay. The shared preview settings appear if any kind can preview on the current device. Automatic GIF loops are silent and can run alongside the selected video or embed. On the sampled mobile Reddit feed, a GIF used an ordinary `shreddit-player[gif][post-type="gif"]` without `single-playback`.
User report (phones): several videos played at once. Whatever starts (a Reddit video by any means, a preview, a continuation, or a YouTube player by its own controls) pauses every other playing video and stops any other preview; a video held for its post keeps playing. YouTube players report starting through the page bridge (`onStateChange` → `rt-embed-playing`) and are paused by it (`rt-media-exclusive`).

### Embedded YouTube videos

- A tap on a muted preview requests sound during the gesture if the current iframe can be moved. The placed player keeps that sound state. With a fresh player, the saved sound choice is applied as it starts. A tap before the player API reports its position still opens the post and starts there from the beginning if no position is known.
- A Play here or sound-control tap that arrives while YouTube is still connecting to its player is applied as soon as that same player is ready. An already-connected player receives the command during the tap. A provider that cannot change volume without reloading keeps its current position when handed off.
Measured 2026-11-19 (r/india, desktop): Reddit renders a YouTube link post as `shreddit-embed[providername="YouTube"]` holding `lite-youtube` with the YouTube player API enabled (`js-api`). Clicking it activates YouTube's player with sound. Reddit pauses embeds that scroll away (its own playback observer, also for Vimeo and TikTok). On the post page Reddit keeps the outgoing feed, with the same post's card and embed, in the page.

- **Previews** follow the video rules: desktop hover (160 ms, same card grace), phone in-view after scrolling stops. The player is activated muted (`mute=1`) through Reddit's own lite-youtube, so YouTube's pre-roll ad may play first.
- While it previews, a transparent layer over the embed takes the click (YouTube's iframe would otherwise take it): **Open the post** or **Play here** per *Clicking a preview*. A round sound button on the layer unmutes in place. Ending a preview pauses it and turns its sound back on for YouTube's own play button.
- **Opening the post** of a playing YouTube embed (preview, Play here, or the user's own play) keeps the same YouTube player: its iframe moves (with `moveBefore`, which keeps an iframe loaded; moving Reddit's `shreddit-embed` itself makes Reddit rebuild it) into a document-anchored stage (`position: absolute`) at its card while the feed stays on screen, then into the post's own embed once Reddit has laid it out, with the 220 ms unclipped compositor move. The post's own embed stays hidden until the moved player lands (placement is tried every frame without deadlocking on our own `visibility: hidden`), and the emptied feed card stays hidden during the hold, then resets to an unplayed embed for Back. The move scales YouTube's 16:9 picture uniformly with the same clip as videos. Sound follows the option; *Play opened previews from the start* seeks to 0. Scrolling stays free throughout: the stage scrolls natively with its feed card, pins to its last on-screen rect across the post swap, and conceals instead of floating if scrolled while pinned or off-screen; Back before the post is ready returns the iframe to its card. Where moving is unavailable, the post's embed starts at the same second instead (from 0 during an ad). The cached feed copy is never restarted.
- **Thumbnails on type-filtered feeds** (read from Reddit's client code, 2026-11-19): Reddit's feed virtualizer swaps a top-level batch for a placeholder once it is a screen plus 1000 px above the viewport and puts it back on the way up. `shreddit-embed` drops its content on disconnect (and removes a YouTube iframe); back in view it renders a new `lite-youtube`, which loads `hqdefault.jpg` and 100 ms later swaps to `sddefault.webp`. With a type filter a 48-post batch shows one or two cards, so batches come and go far more often and thumbnails kept reloading. On feeds with `rt_type`, the page bridge skips that virtualization and restores anything already swapped out; hidden cards cost no layout. Unfiltered feeds keep Reddit's behaviour.
- **What Reddit embeds, by provider** (Reddit's stored embed code, `/domain/<host>.json`, latest 25 posts each, 2026-11-19; no video played): YouTube 24/25 (its own player with `enablejsapi=1`, or an Embedly wrapper); Vimeo 21/25 (Embedly wrapper; Reddit's client turns it into `lite-vimeo`); Streamable 25/25 and Twitch 24/25 (Embedly wrapper `cdn.embedly.com/widgets/media.html`); RedGIFs 25/25 (its own `/ifr/` player); Dailymotion, Gfycat, TikTok, Rumble, SoundCloud, Spotify, Twitter/X 0/25 (link posts). Reddit's client code names only YouTube, Vimeo and TikTok; every other embed is the stored code as-is, and only those three are paused by Reddit when scrolled away.
- **Plain provider iframes** (Embedly-wrapped Streamable, Twitch and others; YouTube's own iframe when Reddit renders it plainly; RedGIFs):
  - Each is controlled by its own protocol: Embedly's `player.js` (`play`, `pause`, `mute`, `unmute`; `ready` and `play` events), YouTube's iframe API (`playVideo`, `pauseVideo`, `mute`, `unMute`; `onStateChange`), Vimeo's message API. Commands sent before a player is ready are sent again on its `ready` event or 300 ms after its frame loads.
  - Previews start muted in place (no reload) behind the same click layer and card grace; leaving pauses and restores sound; Play here and the sound button unmute in place.
  - A provider player that starts by its own controls reports it, so Reddit videos and other players pause; anything else starting pauses these players.
  - Players without a protocol (RedGIFs and unknown providers) fall back to reloading with autoplay and mute flags.
  - Clicking into one marks it in use; opening its post moves the same iframe into the post's embed.
- **Vimeo** (Reddit's `lite-vimeo`, read from its module 2026-11-19: a click adds `player.vimeo.com/video/<id>?dnt=1`, with `autoplay=1` only when the element has `autoload` and `autoplay`): Autoplay and previews set both attributes, trigger its click and add `muted=1`, then drive it with Vimeo's messages (`play`, `pause`, `setMuted`, `setVolume`: a player loaded with `muted=1` stays silent at any volume until `setMuted(false)`); a Vimeo player you start by its own controls reports it, so the rest pause. Opening its post moves the same player (in lite-vimeo's shadow root) into the post: it replaces the post's Vimeo player, or covers the post's unstarted lite-vimeo, so it keeps its moment and gets its sound during the tap.
- **Players with no controls** (RedGIFs: its embed is a `<video autoPlay loop muted playsInline>` with no message API, read from its embed scripts; unknown providers). Options judged: unloading behind a blank play button (crude, reloads), a poster placeholder that never loads until chosen (chosen), or keeping it loaded off screen for the browser to pause (only true pause, but browser-dependent and unverified). As Reddit does for YouTube and Vimeo, the player stands behind a placeholder: the post's own preview image (Reddit's read-only post data, `/api/info.json`, one request per 100 posts) with a play button. The iframe is caught as Reddit inserts it (a watcher on the embed's shadow root), so it never downloads or plays unseen. It loads when chosen: Autoplay or a stop-scrolling preview (phones), hover (computers), or a tap on the placeholder. Leaving or another video starting puts the placeholder back. Short loops restart from the beginning. Opening the post of one that plays moves the same player there at the same moment, still muted: sound would need a reload, which starts it over, so its own sound button turns it on (user report 2026-11-19: reloading for sound lost the moment on phones). A reloaded player's frame is given `allow="autoplay"` (Reddit's Embedly frames already have `allow="autoplay; fullscreen"`), so a reload with sound may play it.
- **Players that are not the one playing** show the post's preview image, as YouTube's phone feed returns to the thumbnail: a feed player with controls (Embedly, Vimeo, YouTube) that played and then stopped (scrolled past, another video started) stays loaded and paused under the image, so a later preview resumes where it was; a tap on the image plays it with sound. With no image in Reddit's post data, its paused picture shows instead. A paused player is no longer carried into its post. Players that never played keep their provider's own poster.
  - **Embedly players that never answer** `player.js` (a `getPaused` probe; 2.5 s): driven by flags instead, written into the provider's own address inside the wrapper (Twitch: `autoplay=true&muted=true`). A Play here or sound tap during the probe is kept through the fallback. Moving the iframe into a post still takes priority over reloading it.
- Twitch: Reddit's current layout shows Twitch clips as a link preview with an Open button, so there is no player in the feed to start.
- Limits: not verified live; Embedly's player.js relay per provider is unknown until a player answers.

For Vimeo and Embedly players with audio commands, the preview sound button unmutes the current iframe in the feed. Opening the post with preview sound enabled sends the same command on the tap and again after the held iframe lands. A late readiness signal replays the latest sound intent. Controls remain available on RedGIFs, Twitch Clips and other embeds that only support startup flags. Their overlay sound affordance hands control to the current player and keeps the same playback position.

| Feed transition | Expected behavior |
|---|---|
| Tap sound while the preview is playing | Keep the current iframe and its position. For a player without an audio command, reveal its own controls. |
| Scroll until that card leaves the viewport | Pause a controllable iframe and add the Play overlay back over the paused frame or ready poster. For players driven only by startup flags, unload offscreen to stop playback. |
| Return and preview or press Play | Resume a retained player at its saved position. Hover previews are muted. Pressing Play asks the existing player for sound. A player unloaded offscreen starts a new loop. |
| Scroll toward an upcoming media card | Warm images about one viewport ahead. Use the native poster when available and batch the existing embed-poster lookup for cards that lack one. |

### Direct embed interaction

| Transition | Expected behavior |
|---|---|
| Tap a muted preview on its picture | Open the card's Reddit permalink by default. Keep the playing frame when possible and apply the open-with-sound preference. |
| Tap the preview's sound button | Unmute and keep playing in the feed at the same position. |
| Tap a provider's video surface after sound is on | With link blocking enabled for this surface, toggle playback and keep the Reddit page open. The player's own controls remain usable. |
| Move an embed from the feed to a post | Apply the destination's link-blocking preference to the same player. |
| Scroll a promoted preview off screen | Pause it and put the preview cover back. A controllable player keeps its position. |
| Approach a feed embed, in any start mode | Warm the native poster or Embedly thumbnail ahead of the viewport. With optional access, fill missing artwork from supported providers' public player metadata. Never start playback to produce a thumbnail. |
| Show an idle embed in On Play mode | Keep the image and Play button visible on phones and computers. A raw iframe stays parked until a tap. When a provider exposes no image, use its native poster if available. |

The optional **Direct embed controls** permission lets the extension control the actual media element when a provider command is unavailable. It applies to the supported player URLs on Reddit, including Vimeo, RedGIFs, Streamable and Twitch, plus the Embedly wrapper. **Block embed links** defaults to Off and can apply to the feed, posts, or both. Standard outbound links on the Reddit page are outside this setting. A provider that exposes neither a command nor an accessible media element keeps its own sound control. A full document navigation cannot preserve the same iframe. Browsers may require a tap inside a cross-origin player to allow sound.

Chrome Dev's desktop device emulation can paint a cross-origin iframe smaller than its CSS box. The same crop appeared with the extension disabled. This is an emulation artifact; the extension does not resize or clip the iframe to compensate. Reddit and the provider keep ownership of the player's size in the feed and the post.

### Preview clicks and missing stills

- **Clicking a muted video** has three choices. **Opens the post** follows the Reddit permalink. **Shows controls, stays muted** hands the existing player over in place at its current position and volume. **Plays here with sound** also hands it over in place and asks the player for sound. The preview's sound button still works directly. The **Sound when opening a preview** switch applies only when an active preview opens its post, including via the card's title.
- An external preview and its controls fill the space reserved by Reddit for the player on desktop and mobile. The provider keeps ownership of the video, its aspect ratio and its controls.
- Use artwork supplied by Reddit or by the provider's public metadata. Read native Vimeo's Embedly image from Reddit's `html` attribute as soon as its card arrives. Missing-image lookups start within five viewports ahead and one and a half behind. If a still fails to load or is too small, try the other available images. An idle Vimeo card can show the fallback still and gives the slot back to the provider as it starts. RedGIFs artwork retains the supplied case and is loaded without a referrer. If all candidates are missing, use a native idle frame where possible, with the existing optional Direct embed controls for providers that play immediately. Capturing a frame from the video URL would require a second media load and cross-origin access, so the existing provider player remains the fallback.

## Transitions

### Comment media

- Chrome's mobile Reddit page rendered Giphy comment GIFs as `figure.rte-media → shreddit-async-loader → shreddit-player[gif]` with a muted, lazily prepared native video. The player had no `player-type` attribute. The comment body was inside an open `details` and Reddit's comment host also observes `collapsed`.
- Native players and direct HTML video in visible comments use the same start preferences as feeds. A tapped preview plays in place, with sound for audible video if enabled. Closing a thread stops its media and cancels automatic or visibility-based resumption until the thread is open again.
- For controllable comment media, the scroll-away choice applies as on the post's video. Silent automatic GIF loops run only while visible. Static images and animated images rendered as plain `img` keep their native behavior.

| | Transition | Desktop | Phone |
|---|---|---|---|
| V1 | Rest on / leave a paused feed video | Muted preview after 160 ms; leaving the card for 250 ms pauses at its position | — (no hover) |
| V2 | Pointer from preview to its title | Preview keeps playing | — |
| V3 | Stop scrolling on a video | — | With in-view previews: muted preview after 600 ms; the previous one paused when it went half off screen |
| V4 | Click/tap a preview's surface | Opens the post (default) or plays here with sound | Same |
| V5 | Reddit's mute button on a preview | Unmutes in place, keeps playing | Same |
| V6 | Open a playing/previewing video's post | Feed stays; video stays in its card, then moves into the post slot in 220 ms; position kept; sound per option, faded in | Same, full width slot |
| V7 | Reddit starts a video by itself | Paused at once; with Autoplay, the video in view then plays muted | Same |
| V8 | Scroll a playing feed video half off screen | Paused, no auto-resume | Same |
| V8b | Scroll a post's playing video fully away, then back | Keeps playing leaves it running. Pause & resume pauses the playing video once gone and resumes at the same position when half back. A manually paused player stays paused. | Same |
| V9 | Back / other page / control before the slot is laid out | Video returns to its card, still playing | Same |
| V10 | Back after the move | Feed card has a fresh player; the post player stops | Same |

## Limits

Chrome CDP captured Reddit's detail visibility controller pausing native media on scroll. Its `playOutOfViewport` flag suppresses that pause. For supported post embeds, the extension owns the same viewport transition as native detail video. Resume uses YouTube's current player state or the provider's play and pause messages. An embed without usable playback state, such as some TikTok or flag-only players, can retain native pause behavior in Pause & resume mode and may need to be started manually.

The preference read is a one-off request for Reddit's settings page (about 400 KB) per browser session per account. A video Reddit starts may play for a fraction of a second before it is paused.
Native buffering can still interrupt a video. A full document navigation cannot carry the original media element across documents. If the browser blocks playback after such a navigation, the video is positioned for the user's next Play press.

## Verification

2026-11-19, live in the user's Chrome (0.46.0 plus these changes), frame sampler on the moving video:
- Desktop 1280×625: the preview kept playing when the pointer moved to the title and paused 251 ms after leaving the card. Clicking it opened the post through its permalink; the same element kept playing, sound faded 0 → 0.25 over about 160 ms and stayed on after the post loaded; the feed stayed on screen while the post rendered; the picture then moved into the 620×319 slot over 220 ms at full frame rate with no pause.
- Phone 390×844 (touch emulation): a tapped video and a tapped in-view preview both continued into the post with sound, moving from 358 px to the full 390 px slot without a pause. In-view previews moved from one video to the next while scrolling.
- Post page: the video played at 16 % visible, paused when fully out of view at 5.6 s and resumed at 5.6 s when scrolled back.

- YouTube embed (r/india): hover started a muted preview with the layer; clicking with *Play here* on played it with sound in place; opening its title kept the same iframe at its card for about 2 s while Reddit rendered the post, then moved it into the post's embed; it played on with sound (5 s → 11.4 s) with no reload.

Earlier verification (0.45):

A clean Chromium profile running only this extension loaded a real Reddit feed, started a video with Reddit's own control, then opened its title. The same video stayed connected, advanced from 0.54 s to 1.40 s during the 0.86 s transition, and continued to 2.29 s. It emitted no pause, seek, waiting or source-reset events during the move. Synthetic tests also cover retained feeds, cancelling the move, a fresh document, delayed metadata and continuation with Reddit autoplay disabled.

On live Reddit in Brave, the outgoing feed and its main column were hidden through the move. The same video advanced from 0.77 s on the feed to 2.03 s at placement and 4.38 s after the post settled, with no pause event. Synthetic checks inject an outdated intersection report and then a fresh scroll-away report to exercise both paths.

On live Reddit in Brave, hovering started a muted video. Clicking its surface turned on sound and advanced from 0.44 to 0.66 s without seeking. In a separate pass, moving to the title paused the preview at 0.88 s, then opening the post resumed it with sound. The same media element ran through the 180 ms placement animation and was still playing at 2.33 s. The incoming slot was initially zero-sized, so the held player waited for Reddit to lay it out before moving.

## Idle embeds: still, own first frame, or placeholder (2026-11-20)

User direction: a thumbnail is not required. When there is no good one, the player's own first frame, paused, is better. Options judged:
- the provider's idle player (free, shows its own first frame or poster, but its interface shows);
- holding the provider's video on frame 0 from inside its frame (real first frame, plays in place; needs Direct embed controls);
- drawing the first frame from the provider's video file in our cover (double download, depends on the provider allowing their files to load elsewhere);
- Reddit's muted preview copy (needs Reddit's post-data request, removed on purpose);
- checking still quality;
- a plain placeholder.

Order per idle feed embed:
1. A still from Reddit's markup (lite-youtube, lite-vimeo, Embedly `image`) or the provider page, used only once it loads at 160×90 or larger. It is fitted on black (`contain`), like the player, not cropped.
2. A player with controls (Embedly, YouTube iframe, Vimeo) with no usable still stays or becomes loaded idle, without `autoplay`, so its own first frame or poster shows. On Play still parks it behind Reddit's still when there is one, so nothing loads until tapped; if that still fails the check, the player loads idle instead.
3. A player that starts by itself (RedGIFs), with Direct embed controls on: the page asks the worker once (`rt-embed-direct`: permission granted and frame script registered). The frame stays loaded, and the frame script holds its video on frame 0 from document start. On its `hello`, the page answers `pause` for an idle feed card and `play` for one chosen (preview, Autoplay pick, tap) or outside the feed. Viewer input inside the player is never held. With no answer in 3 s, or outside Reddit, the video plays as it would have.
4. Otherwise it is unloaded behind a plain placeholder: black with the play button and the provider's name.

User report (0.51.0): cards from one embed provider showed only the placeholder. Measured live 2026-11-20:
- That provider's stills load only when no Referer is sent. With Reddit as referrer the request fails, so a CSS background never showed one.
- The lowercase ID in its player address doesn't name a still: the capitals matter.
- Reddit refuses its batched post lookups (`/api/info.json`, `/by_id`: HTTP 403). A single post's `/comments/<id>.json` answers.

So stills are drawn as an `<img referrerpolicy="no-referrer">`, fitted with `object-fit: contain`. When neither the markup nor the provider page has one, the still comes from that post's own Reddit data: its preview image first, then the provider's still. Reads go one post at a time, at most four per batch, 300 ms apart, only for cards near the screen, and pause for 5 minutes after a 403 or 429.

User report (0.51.1): on phones the still appeared only once the card was on screen, after a black box. Causes:
- A card was watched for its still only after Reddit inserted its player, which Reddit does just before the card reaches the screen.
- The lookahead was 700 px, less than one phone screen.
- Each batch queued up to 8 cards but read only 4, so the rest were marked as having no still.

Now every feed card's embed is watched as soon as the card is in the page, its player named by Reddit's markup (`embed-html`, Embedly). Stills are prepared and decoded 5 screens ahead and 1.5 behind (`rootMargin: 150% 0px 500% 0px`). Every queued card is read, 200 ms apart. This applies to every provider.

User report (0.51.2): on a fresh page the first stills arrived late, though stills further down were ready in time. Each batch of 8 was read one card at a time, 200 ms apart, and painted only once the whole batch finished, so the first screen waited about 3 s. Now cards nearest the screen are prepared first, reads run two at a time, 150 ms apart, and each still is painted the moment it's read.

User report (0.51.2): stills still arrived late or not at all, and paused players were covered. Now:
- stills are prepared when the post arrives in the page, nearest the screen first;
- a card shows its still until Reddit's player is inserted and has loaded (plus 400 ms);
- a paused player keeps no cover, so its own frame shows where it stopped.

## Feed and post playback regressions

- Feed artwork may load ahead of the viewport. It covers the whole media slot without stretching. A raw iframe starts in view. The already prepared still stays in front while the iframe loads in Reddit's reserved slot. An authorized player reports its first available frame without waiting for playback. A provider without a readiness signal falls back to the frame's load event.
- **Plays here with sound** and the preview sound control keep the current frame and time. Capable players unmute and keep playing. When a provider cannot take an unmute command in place, show its controls and keep the current playback. Do not reset an already-started frame to change sound.
- Once the viewer takes control of an embed, another automatic preview waits until that embed leaves view. Site link blocking applies to the provider's picture or outbound link and leaves playback buttons and sliders usable.
- A feed-to-post handoff moves the existing iframe and excludes it from competing-player pauses until it lands. A successful move retains its media size and resumes viewport tracking in the destination. When a full navigation replaces the iframe, YouTube and authorized direct players resume from the last known position and sound state.
- **Pause and resume** applies to the opened post's playing native video and controllable embed. A feed preview timer cannot release ownership of detail-page scrolling. Pause once the player has left the screen and resume the same media when half is back. A manually paused player stays paused.
- Chrome can drop dynamically registered player scripts when the unpacked extension reloads. Restore missing registrations from the already granted provider permissions. An installation without that grant registers nothing.

## Streamlined Passive-Default Architecture (2026-11-22)

### Default State Rule & Passive Initialization
- All media & enhancement settings default to Reddit/Provider Default (`videoStart`/`embedStart`/`gifStart`/`mediaClickAction`/`videoScrollAway`/`videoOpenPost`/`loopPolicy` = `'default'`, `clickAudio` = `'muted'`, `embedBlockLinks` = `'off'`, `streamQuality` = `'auto'`, `singleVideo`/`volumeMemory`/`holdFor2x` = `false`).
- When all media settings are passive (`isPassive()`), `video-control.js` attaches **zero** DOM/Intersection observers, **zero** capture listeners, **zero** embed covers/facades, **zero** autoplay blocking, and **zero** viewport overrides. Toggling any option activates live via `settings-changed`; returning to passive cleanly tears down and restores parked embeds and native state.
- `post-page-bridge.js` gates `shreddit-embed.prototype.setupLoadObserver` on `html[data-rt-embed-override]`, and gates HLS/DASH manifest filtering on `html[data-rt-stream-quality]`.
- `embed-player.js` receives `{ authorized, holdFeed }` from `rt-embed-player` (`holdFeed = embedStart !== 'default'`), so even with Direct embed controls permission granted, fresh installs never stall third-party players on their first frame.

### Unified Feed Start & Click/Audio Interaction Matrix
- Unified per-kind start keys (`videoStart`, `embedStart`, `gifStart`) with values `'default' | 'autoplay' | 'preview' | 'play'`. Platform touch detection is standardized on `(hover: none) and (pointer: coarse)`:
  - `'preview'` (Smart Preview): desktop hover with **300 ms** intent delay + 250 ms card grace; touch center-most card (≥60% visible) **600 ms** after scroll stops.
  - `'play'`: blocks script autoplay on native videos and parks raw embeds behind lightweight static facades until tapped.
  - GIFs are strictly independent and never inherit `mediaClickAction`, `clickAudio`, `singleVideo`, `volumeMemory`, `holdFor2x`, `loopPolicy`, `videoScrollAway` (`mini`), or `streamQuality`.
- Unified click/audio controls (`mediaClickAction`: `'default' | 'inline' | 'open' | 'fullscreen'`; `clickAudio`: `'muted' | 'unmute'`):
  - **Strict click-target isolation**: only intercepts trusted primary clicks on the `<video>` surface or active embed preview/facade layer. Post titles, card links, NSFW gates, and native player controls (mute, volume slider, scrubber, captions, fullscreen, settings) stay native.
  - **`inline` + `unmute`**: 1st click on a playing muted video with audio unmutes in place without pausing (unmute-first priority); 2nd click passes through to native pause. Silent videos (`has-audio="false"`) skip unmute trapping and pass through cleanly.
  - **`open`**: opens the post permalink; uses seamless `moveBefore` continuation only when `videoOpenPost` is `'position'` or `'start'`. Falls back to `'inline'` on post detail and comment videos.
  - **`fullscreen`**: triggers Reddit's native fullscreen control (or `requestFullscreen()` / `iframe.requestFullscreen()`) inside the user gesture and applies `clickAudio`.

### Enhancements (7 Shipped; Hover-Scrubbing Deferred)
1. **Play one video at a time** (`singleVideo`, default `false`): opt-in exclusivity across native videos and controllable embeds (always excludes GIFs and held feed-to-post moves).
2. **Persistent volume memory** (`volumeMemory`, default `false`): records user-driven `volumechange` (ignoring previews and fade ramps) and restores via `rt-video-volume` (`volumeController.setVolume(Math.sqrt(v))`), `rt-embed-volume`, and direct embed `volume`.
3. **When scrolling past media** (`videoScrollAway`: `'default' | 'pause' | 'mini'`, default `'default'`): `'pause'` pauses and resumes post-detail media; `'mini'` (`Beta`) docks playing post-detail media into a fixed bottom-right mini-player via `beginDomReparent` + `moveBefore` with height-preserving slot, scroll-back, and close (`×`) dismissal (embeds without `moveBefore`, e.g. Firefox, gracefully fall back to `'pause'`).
4. **Timestamp continuity on post open** (`videoOpenPost`: `'default' | 'position' | 'start'`, default `'default'`): `'position'` moves playback seamlessly preserving timestamp; `'start'` resets to `0:00`.
5. **Hold-for-2x speed** (`holdFor2x`, default `false`): desktop 300 ms pointer hold or mobile 350 ms right-40% long-press on playing native/direct-embed videos displays a `2× ▶▶` pill, suppresses `contextmenu`, restores original speed on release, and swallows the trailing click.
6. **Looping policy** (`loopPolicy`: `'default' | 'always' | 'never' | 'short'`, default `'default'`): applies to native and direct-embed videos (`'short'` loops `< 30 s`, `'never'` blocks unsolicited post-`ended` restarts); excludes GIFs.
7. **Stream quality** (`streamQuality`: `'auto' | 'max' | 'saver'`, default `'auto'`, `Beta`): native Reddit `v.redd.it` videos only; when non-`'auto'`, `post-page-bridge.js` filters `HLSPlaylist.m3u8` / `DASHPlaylist.mpd` master manifests in `fetch`/`XHR` (`'max'` selects highest variant; `'saver'` caps ≤480p while preserving audio tracks).
- *Deferred*: Hover-scrubbing is intentionally omitted because Reddit feed cards do not expose storyboard VTT sprites, and raw HLS `currentTime` scrubbing causes network stalls and black frames.

## Post opened directly (2026-11-23)

User request: choose what a post's own video does when the post page is opened directly, by its link, in a new tab, or by a reload, rather than from a feed card. Choices: play muted, play with sound, or stay paused until Play is pressed.

### Measured (live, read-only, signed-in Chrome Dev 160 copy of the test profile, extension not loaded)

- Desktop 1440×900, direct load of a video post: Reddit's `shreddit-player[player-type="post_detail_screen"]` carries `autoplay`, `autoplay-pref`, `play-out-of-viewport` and `single-playback`. It appears at about 0.5 s, sets its volume at 1.21 s (muted, volume 0.25, `readyState` 0), and starts by itself **muted** at 1.30 s; frames arrive at 1.5 s. `navigator.userActivation.hasBeenActive` stays false.
- Phone 412×915 (touch, mobile UA): the same player with `is-mobile`, 412×412 at y=124; volume set at 1.26 s, started **muted** at 1.44 s.
- No Reddit volume is stored in `localStorage` or `sessionStorage` on a new tab, so Reddit's autoplay is muted (it keeps sound only when sound was chosen this session).
- Sound without a gesture, on the same direct load (no CDP user gesture, two profiles, media-engagement bypass on and off): unmuting the playing video fired `volumechange` then `pause`, so Chrome **paused** it; an unmuted `video.play()` was rejected with `NotAllowedError`; a muted `play()` then resolved. Chrome has no `navigator.getAutoplayPolicy` (Firefox does). Chrome does allow sound on a page whose site has high media engagement, or after a same-origin navigation that had a user gesture, so the outcome differs per browser and visit.
- Reddit's own `player.play()` re-applies its own volume state, so a direct `video.muted=false` before it is undone (it played muted again).

### Behaviour

Setting `videoDirectOpen` in the Videos & Embeds card (row *Post opened directly*, under *Click, Audio & Post Transition*):

| Choice (default first) | What the post's own video does on a direct open |
|---|---|
| **Reddit Default** (`default`) | Nothing changes: Reddit decides (muted autoplay when Reddit's autoplay is on). Other video options apply as before. |
| Play muted (`muted`) | Plays muted, even when Reddit's own autoplay is off, the feed start option is *Only when I press Play*, or Reddit would bring back sound chosen earlier in the tab. Reddit's mute button turns sound on as usual. |
| Play with sound (`sound`) | Plays with sound at the remembered volume (Persistent volume memory) or Reddit's volume. If the browser refuses sound before any interaction, it plays muted and the sound comes on at the first click, tap or key press on the page while the video is still playing and on screen. Pressing the video's own controls first leaves the sound to them. |
| Stay paused until I press Play (`paused`) | Reddit's player shows its first frame or poster and Play button; Reddit's own autoplay is stopped every time it tries, until the reader presses Play. |

- **Direct open** means the post is the page the tab first loaded (typed or pasted link, bookmark, new tab, reload, a link from another site), still on that post, with no feed-to-post handoff saved for it. It applies once per landing. A post reached in-app (feed card, search result, another post's link, Back/Forward inside Reddit) and a post that continues a feed video (Seamless post transition) are never affected, so posts opened from a feed keep their moment and sound.
- Applies to the post's own native Reddit video (`shreddit-player` or `shreddit-player-2` with `player-type="post_detail_screen"` and the post's id) and, since 2026-11-23, to the post's own embedded player (see *Media playback fixes* below). Not comment media, not GIF posts (they keep *GIFs start*).
- After the reader uses the video's controls (Play, pause, sound, seek) the extension stops managing it; scroll-away, loop, 2× and volume-memory options keep working as before.
- Changing the option in the popup applies to the next direct open (or a reload); a video already managed on the open tab is not restarted or paused again.
- Firefox: `navigator.getAutoplayPolicy('mediaelement')` answers before trying; `allowed-muted` goes straight to the muted fallback.

| | Transition | Desktop | Phone |
|---|---|---|---|
| D1 | Direct load, Reddit Default | Reddit's own muted autoplay, untouched | Same |
| D2 | Direct load, Play muted | Playing and muted within Reddit's start time (≈1.3 s); Reddit's controls show playing and muted | Same |
| D3 | Direct load, Play with sound, sound allowed | Playing with sound; Reddit's mute button shows sound on | Same |
| D4 | Direct load, Play with sound, sound refused | Playing muted (no pause visible), then sound fades in at the first click/tap/key outside the player | Same (first tap) |
| D5 | Direct load, Stay paused | Never plays by itself (checked for ≥5 s after load and after scrolling it away and back); Play starts it | Same |
| D6 | Reload of a direct post | Same as the first load (each load is a direct open) | Same |
| D7 | Feed card → post in-app (T2) | Unchanged: Reddit or Seamless post transition decides; same element, time and sound | Same |
| D8 | Direct post → feed → another video post in-app | The second post is not a direct open | Same |
| D9 | Popup option changed with the post open (T10) | Next direct open follows it; nothing restarts on the open tab; Reddit Default with every other option at default detaches everything | Same |

### Limits

- Whether sound is allowed without a gesture is the browser's decision, made per visit; the fallback is muted playback with sound at the first interaction, never a silent failure or a paused video.
- Sound that comes on is set through Reddit's own volume state, as its sound button does, so Reddit keeps sound for its later autoplays in that tab, as it would after the reader's own unmute.
- A video Reddit starts may play for a fraction of a second (muted) before *Stay paused* pauses it.
- GIF posts are not covered by this option. Embedded players follow it per provider (*Media playback fixes* below).

### Verification (2026-11-23, live, read-only, own copy of the signed-in Chrome Dev 160 profile, unpacked build of this branch)

| | Desktop 1440×900 | Phone 412×915 (touch, mobile UA) |
|---|---|---|
| D5 Stay paused | Reddit's autoplay at 1.17 s paused 21 ms later at 0.00 s; Reddit's retry after scrolling 2500 px away and back paused again (8.76 s); Reddit's controls show Play and 0:00 / 1:02; a real click on the player played it | Reddit's autoplay at 1.17 s paused within 1 ms; retry after scrolling paused; a real tap played it |
| D2 Play muted | Playing muted from 0.95 s | Playing muted from 2.30 s |
| D2 after sound was chosen in the same tab, then reload | Playing, muted | — |
| D4 Play with sound, refused (no prior interaction) | Unmuting at 1.11 s was paused by Chrome and resumed muted within 1 ms at 0.00 s; a click on blank page space faded sound in 0 → 0.25 over 206 ms | Same at 1.00 s; a tap faded the sound in |
| D3/D6 Play with sound after a reload (sticky activation) | Sound on at 1.19 s, no pause | Sound on by 1.26 s; Reddit's sound icon shows on |
| D7 Feed card → post in-app with Stay paused set | Reddit's own muted autoplay played on (not blocked); the navigation entry stayed the feed | Same |

Unit (`tests/video-control.test.cjs`, "Post opened directly: …"): Reddit Default passive; muted overrides the feed start option and re-applied volume; lazy player loader after 1.5 s; Stay paused until the reader's Play; sound allowed, refused (Chrome-style pause on unmute), Firefox `allowed-muted`, and the reader's controls first; feed continuations (same tab and full load) and in-app returns not managed; a changed choice does not restart the open tab; an out-of-view video waits until seen. Not verified live: the Firefox build.

## Media playback fixes (2026-11-23)

User report: (1) with Direct embed controls granted, the extension still puts its old placeholder over players it can control; (2) options that need that permission should stay visible but greyed out until it is granted, and say what to enable; (3) *Post opened directly* does nothing for embedded players, even with the permission; (4) the options do not work well across embeds, Reddit's own video and comment media.

### Measured (live, read-only, own copy of the signed-in Chrome Dev 160 profile, unpacked 0.59.0, permission not granted)

- Desktop 1440×900 and phone 412×915: the topmost element at the centre of a feed player is its `<video>` in the player's open shadow root (no overlay), so the click matrix and hold-for-2× see the video as the event target.
- Video post opened directly, every option at default: Reddit plays the post's own video muted (0 → 4.39 s in 6 s). With *Videos start: Autoplay, muted* the same post's video was paused at 0.84 s and stayed paused (`data-rt-autoplay-blocked`): Autoplay never picks a post's own video, it only picks feed and comment media.
- YouTube link post opened directly, every option at default: Reddit leaves `lite-youtube` unactivated (no iframe after 6 s).
- Feed with *Embedded players start: Autoplay*: the YouTube card in view was activated muted (`mute=1&autoplay=1`) under the click layer.

### Direct frames keep their own picture

A **direct frame** is a provider frame whose frame script has said `hello`. With Direct embed controls granted (`rt-embed-direct` answered true), a frame whose address is one of the supported player addresses is **expected direct** until it says hello, or until 3.5 s pass without one; meanwhile it is treated as direct.

| | Transition | Direct (or expected-direct) frame | Other frames (YouTube's lite player, unsupported providers, no permission) |
|---|---|---|---|
| M1 | Idle feed card, any start mode except Provider Default | Stays loaded. No parked still, no play-button cover, no unload while in view. The page answers its hello with `pause`, so a player that starts by itself is held on its first frame. Its own picture and controls show. | Unchanged: still, cover or placeholder |
| M2 | On Play, idle | As M1; its own Play starts it, and that start counts as the reader's (`play` carries `user:true` when input inside the frame came less than 1.5 s before) | Unchanged: parked behind the still |
| M3 | Rest (another video starts, a preview ends, a used player scrolls away) | Paused through the frame; nothing is put over it | Unchanged: transparent cover with play button, or unloaded |
| M4 | Unplayed and outside the viewport | May still be unloaded for data; once in view it reloads idle (the loading still has no play button and takes no clicks) instead of staying behind a still | Unchanged |
| M5 | Preview starts | No click layer. The page sends `{rtMedia:'preview',on:true}`; the frame script turns a trusted primary click on the video surface (anything that is not one of the player's buttons, sliders or links, nor its bottom 52 px control strip) into `{rtMedia:'tap'}` with its default prevented, and the page applies *Media click action* / *Video click audio* as the layer did. A click on the player's own controls (its sound button included) posts `{rtMedia:'take'}`: the preview becomes the reader's unchanged and the control does what it does. | Unchanged: transparent layer with a round sound button |
| M6 | Preview ends, is promoted, or is carried into its post | `{rtMedia:'preview',on:false}`; clicks reach the player again | Layer removed |
| M7 | Frame announces after a layer preview started | Layer removed; the preview continues as M5 | — |
| M8 | Every option at default | Nothing attaches (passive rule unchanged) | Same |

Limits: an Embedly wrapper whose provider is not on the supported list never says hello and, after 3.5 s, falls back to the right-hand column. Keyboard activation of a layerless preview is the player's own (Tab into the frame).

### Popup: options that need Direct embed controls

| Row | Permission not granted (API available) | After *Grant access* |
|---|---|---|
| Block embed links (fully dependent) | Visible, dimmed (`is-inactive`), control `aria-disabled="true"` but focusable, with the note **Needs Direct embed controls** (the name is a link-style button) named by the control's `aria-describedby` | Enabled in place, note removed, no reopen |
| Persistent volume memory, Looping policy, Hold for 2× speed (partly dependent: they work on Reddit's own video; volume also on YouTube) | Not dimmed; a one-line hint with the same link: *Embeds from Vimeo, Streamable, RedGIFs and Twitch need Direct embed controls* | Hint removed |
| Post opened directly (YouTube, Vimeo and answering Embedly players work without it) | Same, with *Embeds from RedGIFs, Streamable and Twitch need Direct embed controls* | Hint removed |

- A click or tap anywhere on a dimmed row (its control included), Enter or Space on its control, or the note's link does not open the menu: it scrolls to the Direct embed controls row, pulses an outline for about 1 s (none with `prefers-reduced-motion: reduce`) and focuses **Grant access**. One more click grants.
- Denied prompt: the status line says so, as before; rows stay dimmed. Revoke: rows dim again; stored values are kept but inactive and not counted.
- Where the permission API is unavailable (the Direct embed controls row stays hidden), fully dependent rows stay hidden and no hints show.

### Post opened directly: the post's own embed

Same *direct open* as for native video (`landingPost`: the document's own navigation entry is this post, it is still on screen, and no feed-to-post continuation, native or embed, was saved for it). Applies to the post's own `shreddit-embed` (not in a feed, not in a comment), until the reader uses that player (a gesture whose path includes the embed, or focus moving into its frame).

| Choice | YouTube (`lite-youtube`, page bridge) | Vimeo `lite-vimeo`; Vimeo, Embedly and YouTube iframes (their protocols) | Direct frames (frame script) | Self-starting provider without the permission |
|---|---|---|---|---|
| Play muted | Activated with `mute=1` through `rt-embed-continue` (from 0), plays muted | Activated muted (`autoplay=1&muted=1` for lite-vimeo); `mute` + `play` | `mute` + `play` | Already plays muted; nothing else |
| Play with sound, page has user activation (`navigator.userActivation.hasBeenActive`, e.g. a reload after interaction) | Activated with sound, faded in | `unmute` + `play` | `unmute` + `play` | Plays muted; its own sound control |
| Play with sound, no activation, or refused (the player reports a pause, or is not playing 1.5 s later) | Plays muted; the first click, tap or key press on the page sends `rt-embed-sound` | Plays muted; the first interaction sends `unmute` + `play` (frames with `allow="autoplay"` inherit the top page's activation) | Same, through the frame script | Same as above |
| Stay paused until I press Play | Reddit does not start it; a start the reader did not make is stopped (`rt-embed-stop`) | A reported start the reader did not make is paused | Its hello is answered `pause` (held on its first frame; the worker's `holdFeed` is also true with this choice, so it waits from document start) | Unloaded behind its still with a play button until tapped |

| | Transition | Expected |
|---|---|---|
| E1 | Direct load, Reddit Default | Nothing attaches for the embed |
| E2 | Direct load, Play muted | Playing muted once the player can take commands |
| E3 | Direct load, Play with sound, sound allowed | Playing with sound |
| E4 | Direct load, Play with sound, refused | Playing muted, then sound on at the first click, tap or key press outside the player while it still plays |
| E5 | Direct load, Stay paused | Never plays by itself; the reader's Play starts it and management ends |
| E6 | Feed card → post in-app, or an embed continuation | Not managed |
| E7 | Reader clicks into the player first | Management ends; the player's own controls decide |

Limits: whether sound is allowed is the browser's decision per visit. A self-starting provider without Direct embed controls cannot be unmuted or paused from the page.

### Option × surface audit (2026-11-23)

Evidence: L1 = unit test in `tests/video-control.test.cjs`, `tests/embed-player.test.cjs` or `tests/tweaks-popup.test.cjs`; L3 = live, read-only, own profile copy, desktop 1440×900 and phone 412×915 (logs in the ignored `artifacts/research/verify/media-fixes/`). Embeds other than YouTube could not be found on live feeds in this session, and Direct embed controls is not granted in the test profile, so every frame-script path is L1 only.

| Option | Feed/post embeds | Native video (feed, post) | Comment media |
|---|---|---|---|
| Videos start | n/a | **Fixed**: Autoplay/Preview paused the post's own video for good (L3 before: paused at 0.84 s; after: plays 0.02 → 4.54 s desktop, 0.06 → 4.58 s phone with Preview). Feed: pass (L1) | Pass (L1) |
| GIFs start | n/a | **Fixed**, same cause, for a GIF post's own GIF (L1) | Pass (L3: a visible comment GIF loops, t = 2.46 s; GIFs inside a collapsed thread stay paused by design) |
| Embedded players start | **Fixed** for direct frames: no still, cover or layer (L1); YouTube unchanged (L3: Autoplay activates the card muted) | n/a | n/a (no embeds in comments seen) |
| Media click action, Video click audio | Applies to previews (layer or frame tap, L1) and covers; with *Provider Default* start the provider's own click stays (limit, now in the option's description) | Pass (L3 post page: first click unmuted without pausing, second paused) | Pass (L1; *Open post* acts as *Play / Control in feed*) |
| Seamless post transition, Post card click audio | Pass (L1) | Pass (L1) | n/a |
| Post opened directly | **Fixed**: YouTube L3 (muted: plays muted; sound refused: muted from 2.08 s, a click turned it on at 5.87 s and it kept playing, desktop and phone; Reddit Default: never activated); frames and protocols L1 | Pass (verified earlier today) | n/a by design |
| Play one video at a time | Pass for YouTube, protocol and direct frames (L1); a self-starting provider without the permission cannot be paused | Pass (L1) | Pass (L1) |
| Persistent volume memory | YouTube and direct frames only; Vimeo and Embedly need the permission (hint). Volume changes inside an embed are not recorded (limit) | Pass (L1) | Pass for videos (L1) |
| When scrolling past media | Post embeds: YouTube, protocol and direct frames (L1) | Pass (L3: paused once away at 2.55 s, resumed at the top) | Pass (L1) |
| Hold for 2× speed | Direct frames only (hint) | Pass (L3: rate 2 with the pill while held, 1 after release, still playing) | Pass for videos (L1) |
| Looping policy | Direct frames only (hint) | Pass (L1; L3: the loop flag is applied in the feed) | Pass for videos (L1); GIFs excluded by design |
| Stream quality | n/a | Not re-verified live (unchanged; manifest filtering in the page bridge) | n/a |
| Block embed links | Direct frames only (now dimmed with a link until granted, L1) | n/a | n/a |

Not verified live: anything that needs Direct embed controls granted (the user's test), the Firefox build, and Streamable, Vimeo, Twitch and RedGIFs cards.

## First load (2026-11-23)

Report: previews sometimes ignored the start policy on first load until one video was played by hand. Four cold loads didn't reproduce it (native hover, native phone in-view, YouTube hover). The code had stuck states that match the report; they're fixed (`docs/feed-controls-ux-plan.md` §11):

| | Transition | Expected |
|---|---|---|
| V1 | Cold load with the pointer already resting on a feed video, Preview mode | The preview starts once settings are in and the player is ready, with no movement needed (`recheckPointer` after configure, attach, scroll end and tab shown) |
| V2 | Start chosen but impossible (no `<video>` yet, tab hidden, another video playing) | No player stays marked as hovered or in view. A missing video retries when the player attaches or reports metadata, and later hovers work |
| V3 | Preview never plays (no metadata) | Dropped after 4 s, so the next hover or in-view pick can try again |
| V4 | Phone: the in-view pick equals a player whose start failed | The pick runs again instead of returning early |
| V5 | Direct embed controls granted in the popup while a Reddit tab is open | Read again on settings changes and when the tab shows; no reload needed |

Verified: unit tests for V1–V3. Live: previews started on cold loads before and after the fix. The original failure wasn't reproduced live, so V1–V4 aren't verified against it.

## Direct embed controls for every provider (2026-11-23)

User request: with Direct embed controls granted, no overlay for any embed provider, and the player's own controls (sound, seek bar, settings) usable without counting as a tap on the video.

- **Providers:** the original players (RedGIFs, Vimeo, Streamable, Twitch, Embedly's wrapper) plus every other video provider Reddit embeds, directly or inside Embedly's wrapper: YouTube (including youtube-nocookie), Dailymotion, TikTok, Rumble, Kick, GIPHY, X, Facebook video, Instagram, Bilibili, Medal, Streamff, Streamja, Imgur albums and Gfycat. Only each provider's embed page counts (`RTEmbedHosts.playerOrigin`).
- **Grants:**
  - The original set stays one grant (`RTEmbedHosts.origins`), so a grant made before this change keeps working.
  - Other providers are checked host by host (`RTEmbedHosts.access`), and the frame scripts are registered, or updated, for exactly the granted hosts.
  - The worker answers `rt-embed-direct` with `{core, origins}`. The page expects a frame to say hello only when its provider is granted (`grantedFrame`), so an ungranted provider never waits 3.5 s without its cover.
- **Popup:**
  - Grant access asks for every provider in one prompt.
  - With only the original grant, the row reads "Granted for Vimeo, Streamable, RedGIFs and Twitch. YouTube, Dailymotion and N more need one more Grant access." The options that need the grant stay on, a Revoke access link shows, and partly dependent rows hint "Embeds from YouTube and other sites need Direct embed controls".
  - Revoke removes every provider.
- **Controls during a preview:** besides buttons and sliders, these hand the player over (`take`) instead of tapping:
  - ARIA menus, dialogs and listboxes.
  - The common players' chrome: YouTube's bars, menus, end screen and big play button; video.js; Plyr; JW Player.
  - The bottom 52 px strip of any player taller than 80 px.

  A click anywhere else on the video surface is the page's `tap`, which applies *Media click action*.

| | Transition | Expected |
|---|---|---|
| D1 | Original grant only, YouTube preview | Unchanged: the transparent layer with a sound button, and no 3.5 s wait for a hello |
| D2 | All providers granted, YouTube preview | No layer. The frame reports taps; YouTube's mute, seek bar and settings work in place and keep the player in the feed |
| D3 | Grant more in the popup while a Reddit tab is open | The page re-reads the grant when the tab shows again; frames load with the script after a reload, since Chrome injects into new documents only |
| D4 | Revoke | Every provider's scripts are unregistered; open tabs keep the old frames until refresh |
| D5 | A granted frame previews before its hello arrives | No layer while the hello is on its way; the hello turns tap reporting on |
| D6 | Reddit's own lite-youtube preview, YouTube granted | No layer. Its iframe is created on activation inside lite-youtube's shadow root, which the scan never registers, so its hello is matched by searching the embeds |

### Players that kept playing (2026-11-23)

User report: embed and Reddit videos kept their sound for a while, and some didn't stop when they should have.
- **Lost hello:** a frame that said hello before the page registered it (scans are debounced by 200 ms, and frames inside shadow roots don't trigger one) was never heard from again, because the page's first message stopped its retries. The page couldn't pause it ("one video at a time", scroll-away, opening another post), and any granted preview kept its click layer. The frame now announces again on the page's first message.
- **One at a time** also pauses Reddit players inserted since the last scan.
- **Route changes:** Reddit keeps the page it is leaving on screen until the destination renders (and may keep it for Back). After a route change, media that doesn't belong to the destination is paused, at 0, 500 and 1500 ms: on a post page anything outside that post and its comments; on a feed, a post page's detail player. A video carried into the post (continue on open) and the mini player are kept.
- Frames that never get a video (photo posts, albums) stop watching for one after 15 s; a press inside the frame checks again.

**Limits:**
- X, Instagram and Facebook embeds are post cards. A card with no `<video>` never says hello and falls back to its cover after 3.5 s.
- Players whose controls live in a closed shadow root or a nested frame of another site get the strip and ARIA rules only.
- Audio-only embeds (SoundCloud, Spotify) aren't covered.

**Verified:** unit tests (provider addresses, per-host registration and updates, partial-grant popup, page expectation gating, YouTube chrome as controls). **Not verified live:** granting is a browser permission prompt the user answers, and provider pages weren't opened.

### Play with sound when the browser refuses (2026-11-24)

User report: with "Post opened directly: Play with sound", videos (Reddit's own, embeds, YouTube) played but stayed muted.

Browsers allow sound only after the reader has interacted with the page. A post opened in a new tab, from a typed address or from a link on another site has had no click yet. Chrome's exception is sites with high media engagement. The extension can't grant that permission.

Already before this change, a refused start fell back to muted playback, and the first click or key press away from the player turned the sound on. Nothing on screen said so, though, and a click on the player itself counted as taking over, so it never brought the sound.

Now a refused start shows a **Turn on sound** button on the player, as YouTube does. Its click is the interaction that turns the sound on (it fades in), and any other click or key press away from the player still works. The button follows the player as you scroll. It goes away when the sound comes on, when you use the player's own controls, or when you leave the post. It never shows for "Play muted".

Live check: in the Playwright test browser the page counts as already interacted with, so sound starts directly and the refusal can't be reproduced there. The refused path is covered by unit tests that model Chrome's rule (unmuting without an interaction pauses the video).

## Reddit's Media search tab and posts opened from results (2026-11-24)

- Reddit's Media tab plays its tiles with `shreddit-player[player-type="search_results"]` (`autoplay`, `force-muted`) inside `[data-id="search-media-post-unit"]` (measured desktop and 412 px phone). Only `in_feed_player` counted as feed media, so with *Preview* or *Autoplay* the start was blocked and nothing previewed. Those players are now feed media for start choices, poster warming and previews (`feedPlayer` in `video-control.js`, the `rt-prepare-feed-preview` gate in `post-page-bridge.js`). Live, phone, *Preview the one I stop on*: one in-view tile played muted and the next stayed paused.
- A click on a search result tile (a Media tab tile or a Visual search tile) that opens a post is remembered until Reddit's route change and then treated as *Post opened directly*: a result has no playing moment to carry over. Other in-app opens are unchanged. Unit: "Post opened directly also covers a post opened from a search result tile", "Media search tab videos follow the start choice". Live: *Stay paused* held the opened video at 0:00, *Play muted* played it.
- Visual search hand-off (2026-11-24): `rt-visual-continue` `{id, time, source: media|title|viewer, muted}` creates the same saved continuation a feed preview would, only when *Seamless post transition* is on (From start uses 0). Sound: viewer keeps its own state, a media click follows `clickAudio`, a title click `cardClickAudio`. Live: handed 2.4 s, the post's video was at 7.5 s six seconds later.
- Embed stills now carry the Visual search play mark (24 px dark pill, top right), shown when the still has loaded and removed with it (`[data-rt-pre-mark]`). Live on r/videos with Embeds *Preview*: shown on every loaded YouTube still.

## Media tab hold preview and refused autoplay (2026-11-25)

- Touch, Reddit's Media search tab: pressing and holding a clip (300 ms without moving more than 10 px) previews it muted while held, under any start choice; lifting stops it unless it was already playing, and the click that ends a hold is swallowed. The long-press menu is suppressed while holding. A moving finger is a scroll and cancels the hold.
- A preview the browser refuses before the page has had any tap or key press (some phone browsers, Firefox for Android among them, block even muted autoplay until then) is tried again on the next tap or key press instead of waiting for a video to be played by hand. Chrome's phone emulation started first-visit Media tab previews muted with no refusals (11 `play()` calls, all muted, all resolved), so the refusal itself was not reproduced.
- Cause found for both "previews only start after something was played" and "sound leaks, then mutes": Reddit's own `syncVolumeToActivePlayers` applies the reader's saved Reddit volume (`@reddit/shreddit-player-media-volume`, here `{"volume":0.25,"muted":false}`) to active feed players while the feed scrolls. Measured with fast scrolling on a phone profile: one unmute per run with the extension off as well. On a muted preview, that unmute before any tap makes the browser pause the video ("Unmuting failed and the element was paused instead"); after a tap it plays aloud until the extension mutes it again.
- Fix: while a preview or automatic loop uses a player, the page bridge sets the player's `forceMuted` (Reddit's own switch, already on Media tab tiles), which keeps it out of that sync. It is handed back when the preview ends, when the reader takes it over, or on the reader's own press on that player; a `forceMuted` Reddit set itself is left alone. Measured: with `forceMuted` held, Reddit unmuted none of them (0 in 2 runs, against 1 per run without it); after the change, the only unmute seen hit a paused player no preview was using (Reddit's normal behaviour), and no "Unmuting failed" pause occurred.
