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
- When the slot is laid out, the video takes it at once, and its picture moves from where it was in the card to the slot over **220 ms** (ease-out): one uniform scale from picture to picture (no distortion, no clamp), clipped to the card's box at the start, on the compositor so Reddit rendering the post cannot stall it. Reddit's reparent window stays open until the move ends. Later layout shifts of the post page carry it with them. With reduced motion it takes the slot without moving.
- A video playing with sound keeps it in the post.
- Opening another page, Back before the post appears, a player control, or 12 s without a slot: the video returns to its card. Back after the move: the feed card has its own fresh player and the post player stops.

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
- **Opening the post** of a playing YouTube embed (preview, Play here, or the user's own play) keeps the same YouTube player: its iframe moves (with `moveBefore`, which keeps an iframe loaded; moving Reddit's `shreddit-embed` itself makes Reddit rebuild it) into a fixed stage at its card while the feed stays on screen, then into the post's own embed once Reddit has laid it out, with the 220 ms compositor move. The post's own embed stays hidden until the moved player lands (placement is tried every frame), and the emptied feed card is hidden during the hold, then reset to an unplayed embed for Back. The move scales YouTube's 16:9 picture uniformly with the same clip as videos. Sound follows the option; *Play opened previews from the start* seeks to 0. Back before the post is ready returns the iframe to its card. Where moving is unavailable, the post's embed starts at the same second instead (from 0 during an ad). The cached feed copy is never restarted.
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

In Chrome Dev's desktop device emulation, the same RedGIFs feed card allocated 408 × 329 CSS px while its iframe painted a 272 × 219 px player. The same crop appeared with the extension disabled. During a feed preview on an emulated device, Direct embed controls can report the viewport of that iframe. The extension compensates only for a uniform size difference, clips to the original slot, and drops the temporary sizing when the preview stops or moves into a post. A second live card measured 408 × 229 px both inside the frame and in Reddit's slot with the correction in place.

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
