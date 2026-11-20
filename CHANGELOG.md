# 0.53.5 preview

- **Mobile embed fit:** re-measure the provider viewport after its first frame and again after its controls settle, so a player covers the Reddit slot instead of leaving an L-shaped strip on the right and bottom. The preview sound control follows the painted video (including object-fit and object-position) instead of the empty part of the slot or the provider's control rail.
- **Version:** patch increment for the mobile embed sizing and control-placement correction.
- **Validation:** 2,100 tests passed. Unit tests cover the visible video rect for a portrait clip inside a landscape player and the sound control placement over a letterboxed video. In Chrome Dev, the compensated RedGIFs player measured 426 × 231 px inside a 427 × 231 px slot; the provider's own right-hand control rail remains its UI. The final re-measure was not rechecked on the live post after the extension reload, and this build has not yet been checked on a phone. Both packages passed ZIP integrity and byte-equality checks. Firefox lint reported zero errors, warnings and notices. Chromium SHA-256 `6cec6f72e414a1b01a1c19cd87c78aa2075f2ee10d437d10ffcae4cb7432c56f`. Firefox SHA-256 `4a9e1c786ead42929708382c894cf0574fc54849ed14ea4dbcc32dae0ed9da6d`.

# 0.53.4 preview

- **Embed previews:** load raw feed players when they enter view and keep the thumbnail filling the slot until the player is ready. Apply the emulated-viewport sizing correction before playback and keep it during a post handoff.
- **Playback and controls:** a sound tap keeps the current frame playing. A player that requires a reload for sound keeps its own sound control. Link blocking leaves playback buttons usable. Move the playing iframe into the post, or resume at the last known position for supported players when the browser replaces it. Keep detail pause and resume active while feed preview timers run.
- **Direct embed controls:** restore the registered scripts after an extension reload when supported-host access was already granted.
- **Version:** patch increment for the media regressions.
- **Validation:** 2,098 tests passed. Chrome Dev measured the RedGIFs feed preview filling a 408 × 408 px slot while its still was still present. On the live detail post, the video filled 440 × 238 px, its own sound button responded with link blocking enabled, and scrolling away and back paused and resumed it in place. The native Reddit detail player changed pause state in both directions during a scripted check, but remained at time zero while buffering. Feed sound promotion and navigation handoff have regression coverage. Both packages passed ZIP integrity and byte-equality checks. Firefox lint reported zero errors, warnings and notices. Chromium SHA-256 `0da949397953cb1154d9ab4bc61398c836cafa631d82c83b0300b75ed72327e2`. Firefox SHA-256 `0d6002cbaa18fcf59af16e21ad7664eafa14a8742c52725c2355319e61c78d35`.

# 0.53.3 preview

- **Mobile archived posts:** hide the Back arrow and start the credit row with the avatar, as on the native mobile post. Fit tall media to the full-width frame, match the native action and comment spacing, and use Reddit’s mobile comment controls.
- **Version:** patch increment for the mobile archive layout correction.
- **Validation:** 2,085 tests passed. Compared the archived TotalKalesh and native IdiotsNearTrain tabs in regular Chrome at 393 CSS px. The archive rendered a 393 × 393 px image frame, 48 px action row, 42 px Share buttons, 24 px comment avatars, and 16 px comment spacing. A separate Chrome breakpoint check of the final package confirmed Back is hidden at 393 px and visible at 900 px. The final Back change was not reloaded in the live tabs. Both ZIPs passed integrity and byte-equality checks. Firefox lint reported zero errors, warnings and notices. Chromium SHA-256 `1bb070c4f829f9e669f2bf6ebebaae67a01d028f55850c454545e9cb07e9df21`. Firefox SHA-256 `9e95d26ed688214398ca6958c32c5e974d5bf2037471405532886721a43b8f4f`.

# 0.53.2 preview

- **Mobile post overlay:** hide Reddit’s separate inline app promotion over media already present on the opened post. The NSFW reveal setting still controls the media blur.
- **Mobile archived posts:** show a circular Back button in the 44 px credit row. Keep the name and avatar on one line and match the native post’s title and flair spacing. Back returns to the preceding Reddit entry when available.
- **Version:** patch increment for the mobile post fixes.
- **Validation:** 2,083 tests passed. Regular Chrome’s installed extension hid the inline app promotion while retaining the player on r/IdiotsNearTrain. At 393 px, the archived r/TotalKalesh post matched the reference credit row, title and flair positions, and the 32 px Back button was visible and received pointer input. Both packages passed ZIP and byte-equality checks. Firefox lint reported zero errors, warnings and notices. Chromium SHA-256 `1c77db0d92cd519e4748d673050ad1a9a91174c8d532fc30c9e66e269a0f6837`. Firefox SHA-256 `aeee8ad3ead0c13263e2d2bb7176d72da7ecc661c3fcc4743032d2e7b51aeb0d`.

# 0.53.1 preview

- **Mobile overlays:** read both switches through the extension worker and keep processing Reddit’s overlays when links update during startup. When Reddit reapplies the NSFW blur while loading a post, use the replacement reveal button.
- **Version:** patch increment for the installed mobile overlay fix.
- **Validation:** 2,080 tests passed. With both switches enabled in the installed extension, regular Chrome’s mobile emulation loaded the linked r/IdiotsNearTrain post with its media revealed and r/totalkalesh without the blocking app promotion. Both browser packages passed archive and byte-equality checks. Firefox lint reported zero errors, warnings and notices. Chromium SHA-256 `aa15cae95e201c198d4fd6cfa58a2f4e93d5e767980de7c8b11ac1990d8a4dc5`. Firefox SHA-256 `99234fe91767bf65dbf0c33f12923268f6d36c63c7cfde1b88e3769e13f8fa48`.

# 0.53.0 preview

- **Mobile Mature Content overlay:** Settings → Browsing now has a switch for removing the app-only overlay. It starts on to preserve the existing behavior. Refresh Reddit after turning it off.
- **NSFW media on mobile posts:** a separate opt-in switch automatically uses the reveal button on the opened post.
- **Archived posts on mobile:** the header, credit row, title, flair, and comments follow the measured mobile post spacing. Media retains the full post width.
- **Version:** minor increment for the new post media preference.
- **Validation:** 2,077 tests passed. The two overlay actions were verified on the linked mobile post in regular Chrome using temporary settings. Archive spacing was measured against the native post. In Chrome Dev with Reddit Tweaks disabled, a 408 × 408 RedGIFs slot contained a playing 302 × 302 video. The enabled preview did not start on the follow-up reload, so the previously verified sizing correction could not be rechecked end to end on that card. Firefox lint reported zero errors, warnings, and notices. Chromium SHA-256 `3cf3c396c12d9793f82bb7a58a8b35013530ee7ef339fe913138768271e71ae0`. Firefox SHA-256 `c836783da19a60a18c3f9ed9af0f1ac65827abc3d832ee4ea8d3216890230a08`.

# 0.52.1 preview

- **Mobile app promotion:** remove Reddit's app-only **Mature Content** promotion from the existing mobile feed. Ordinary app prompts continue through Reddit's browser action when available.
- **Embed previews in Chrome device emulation:** when a player reports a viewport smaller than its iframe, the preview corrects the scale and clips the player to the original Reddit slot. This uses the existing optional Direct embed controls access.
- **Version:** patch increment for corrections to the 0.52.0 preview.
- **Validation:** 2,073 tests passed. In Chrome Dev, a playing RedGIFs frame measured 408 × 229 px inside a 408 × 229 px card after correction. Playback was explicitly started for that measurement. The comparison with the extension disabled reproduced the smaller viewport under the same emulation. Mobile app promotion removal passed tests based on the regular Chrome markup. A fresh regular Chrome connection did not complete for the live removal check. Chromium SHA-256 `5f40eeac12a69f2b729f91e7e0869682a2a4ae2f45eaee223873be690cbaf754`. Firefox SHA-256 `6bffa3fdb88b18b6c85d41dd19b691b3c04e41bf78242f7885adb442b3a19f88`.

# 0.52.0 preview

- **Mobile post navigation:** short changes in scroll direction keep the navbar in its current state. A deliberate upward scroll shows it, and a larger downward reversal hides it.
- **Android:** recognized Reddit app promotions use the native browser continuation and keep the current Reddit page open.
- **Smooth scrolling:** touch devices leave Reddit in charge of drawing cards and skip the extension's scan for offscreen items. Layout measurement caching follows the current area's setting.
- **External videos:** feed previews fit the existing media slot. Still images fall back to other available artwork when the first choice fails. **Shows controls, stays muted** unlocks the playing preview in place. The sound option for opening a post applies separately.
- **Version:** minor increment for the Android app prompt handling and muted preview interaction.
- **Live validation:** Chrome Dev measured the 48 px navbar fully open and hidden, a fitted 440 × 440 RedGIFs iframe, and decoded RedGIFs and Vimeo stills. Four cached-feed scroll passes recorded a 16.7 ms median frame interval with Smooth scrolling caches on and off. Cold card drawing and live sound transitions remain unverified. Regular Chrome returned the Android **Mature Content** screen, which offers **View In App** and **Go Home**. Browser continuation was tested on a fixture that offers that action.
- **Package validation:** 2,069 tests passed in UTC with test concurrency of four. Firefox lint reported zero errors, warnings and notices. All 80 Chromium and 81 Firefox assets match the source, unpacked folders and ZIPs. Chromium SHA-256 `a487a8ac408454695b7047384fa2a42778761c0b393ec38d8676da155e99de6d`. Firefox SHA-256 `c4a2d5cb88784eb8c1262cec4900b5ddab60e9d658bdfe0d2d619705a18be4dc`.

# 0.51.4 preview

- **Direct embed controls:** turning sound on or off presses the player's own sound button, so its sound state and icon follow, instead of changing the video underneath it. While embed links are blocked, the player also can't open its own site from script. If you enabled Direct embed controls before this version, the extension adds the new helper itself when it updates.
- **Version:** patch increment for these fixes.
- **Validation:** 2,046 tests passed in UTC. Firefox lint reported zero errors and warnings. All 79 Chromium and 80 Firefox assets match the source, unpacked folders and ZIPs. Not checked live on a player. Chromium SHA-256 `263aead96780aefaff7ef8b5788f6db602dde9a212d5e2b29df3083faf1f7c0e`. Firefox SHA-256 `b847862244c3033442206d237d50f3531923ed12a69a2d9a0fa19c666d847399`.

# 0.51.3 preview

- **Embed stills with the post:** a card's still is looked up as soon as Reddit delivers the post, nearest the screen first, two at a time, and each shows as soon as it's found. Until Reddit inserts and draws a card's player, the card shows its still instead of a black box.
- **Paused players:** a player paused after scrolling past stays on its own frame where it stopped, with no image or black box over it.
- **Firefox:** Reddit data reads for stills go through the page's own fetch.
- **Version:** patch increment for these fixes.
- **Validation:** 2,045 tests passed in UTC. Firefox lint reported zero errors and warnings. All 78 Chromium and 79 Firefox assets match the source, unpacked folders and ZIPs. Not checked on a phone with this build. Chromium SHA-256 `c0747057deb4da3f24a1f00ae890d0d9af69dc6b9380ca6f67885db57387c3de`. Firefox SHA-256 `3a84c6011824ab29cc06b3535e2db59972fd0375e1241dabd90f6a92a58264c4`.

# 0.51.2 preview

- **Embed stills ahead of scrolling:** idle embed cards already show their still when they scroll into view, instead of a black box that fills in. Stills for every provider are found and decoded up to 5 screens ahead, including cards whose player Reddit has not inserted yet. Every queued card is looked up; before, only the first 4 of each batch of 8 were.
- **Version:** patch increment for this fix.
- **Validation:** 2,043 tests passed in UTC. Firefox lint reported zero errors, notices and warnings. All 78 Chromium and 79 Firefox assets match the source, unpacked folders and ZIPs. Not checked by scrolling on a phone with this build. Chromium SHA-256 `49fa5fac11fd70161ae3a27d4630ad720852d3595b0569db9ff77571fe98800e`. Firefox SHA-256 `be3d2429b8542111f24c9e3c67657281799b859fb0caa1a371591a6649fc17e5`.

# 0.51.1 preview

- **Embed stills:** idle cards from an embed provider whose stills need a request without a referrer show their still again instead of only a placeholder. Stills are now drawn as images that send no referrer. Cards whose markup has no still read it from their own post's Reddit data, one post at a time, only near the screen, with a 5-minute pause after Reddit refuses. Reddit's batched post lookup returns 403.
- **Version:** patch increment for this fix to 0.51.0's idle embeds.
- **Validation:** 2,042 tests passed in UTC. Firefox lint reported zero errors, notices and warnings. All 78 Chromium and 79 Firefox assets match the source, unpacked folders and ZIPs. Live in Chrome: the provider's stills loaded only without a referrer, and a single post's Reddit data answered while the batched lookups returned 403. A full card on live Reddit with this build was not checked. Chromium SHA-256 `557801c3c0c1ab8c8b4d1faaf12b1eb9cd345d40a659dad1821c65aff0a79300`. Firefox SHA-256 `3ac0d9b90e1889138e22f148e6602af011512ab031ad42b7e8498b476327ea95`.

# 0.51.0 preview

- **Embed controls:** tapping a muted feed preview opens its Reddit post even when the card only links out. The sound button unmutes in place. A player that moves into its post keeps its position and gets its sound request again once placed.
- **Block embed links:** new Videos option (Off, In feeds, In posts, Feeds and posts) stops taps on a provider's video surface from opening the provider's site. With the new **Direct embed controls** (optional access to RedGIFs, Vimeo, Streamable, Twitch and Embedly players, granted from the popup), those taps play or pause in place, and the player's own controls keep working.
- **Idle embeds:** a thumbnail is no longer required.
  - A still is used only once it loads at 160×90 or larger, and it's fitted like the player rather than cropped.
  - Without one, a player with controls loads idle and shows its own first frame or poster.
  - With Direct embed controls, a player that starts by itself (RedGIFs) waits on its own first frame until it's chosen. Otherwise it shows a plain placeholder with the provider's name.
  - On Play keeps players unloaded behind Reddit's still when there is one, including on phones.
  - Missing stills come from the provider's public page with that optional access, never from Reddit's post-data request.
- **Mobile custom feeds:** filter controls and chips moved out of Reddit's Feed/About row. In Chrome phone emulation both tabs measured 40 px, down from 120 px with the Video filter applied.
- **Version:** minor increment for the Block embed links and Direct embed controls options.
- **Validation:** 2,041 tests passed in UTC. Firefox lint reported zero errors, notices and warnings. All 78 Chromium and 79 Firefox assets match the source, unpacked folders and ZIPs. Live checks: the RedGIFs player markup and thumbnail metadata were confirmed. The full playback flow, the first-frame hold, link blocking and sound on live Reddit were not verified on this build. Chromium SHA-256 `2633af4ecd950d7eff170ea45e955fefab7380eb09f88b1ba4b6b1b0d3a35566`. Firefox SHA-256 `5e304c632965f28b37ff059464935510e863f7acac94be88f2444c8974528a65`.

# 0.50.0 preview

- **Profile switching:** keep the current activity visible until the destination's initial batch is ready. Back restores the feed and reading position even if Reddit rebuilds the page.
- **Community filters:** Top opens Reddit's time ranges before changing the sort. Flair uses the community's colors and emoji in the picker, applied chip and menu summary. NSFW is an independent filter and preserves the current Safe Search setting.
- **Custom feeds:** use the subreddit filter controls on custom feeds and their results. Pressing Enter in an empty scoped search opens Reddit's native custom-feed results.
- **Mobile:** scrolling up on Home reveals a compact navigation row with Reddit's existing Search and account actions. The Accounts sheet stays within the viewport and returns focus to the drawer when dismissed.
- **Embedded media:** send the audio request on the tap and after a controllable player arrives in the post. Scrolling past a preview unmuted in the feed restores its Play overlay. Controllable players pause in place. RedGIFs and non-interactive Twitch clips use their own audio controls and start a new loop after being stopped offscreen. Feed preview images warm ahead of scrolling.
- **Deleted authors:** retain exact Arctic Shift author matches through Reddit's credit-line updates and recover them on native cards in a filtered subreddit feed. Following a restored name shows Reddit's deletion label on the outgoing view.
- **Version:** minor increment for mobile Home navigation and the NSFW filter.
- **Validation:** 2,027 tests passed in UTC. Firefox lint reported zero errors, notices and warnings. All 75 Chromium and 76 Firefox assets match the source, unpacked folders and ZIPs. Live Chrome verified the linked custom feed and empty scoped search. Audio on live provider embeds and the full profile Back replay on this build remain unverified. Chromium SHA-256 `54e28bf3585da126a219f942bd991aef981e24c9d316d15b0c76671bcd81421d`. Firefox SHA-256 `8e8ee927b9d251f1c1d49e1c4b9f7aa1b31a5355b7427e05ab228a4e4d824689`.

# 0.49.0 preview

- **Media settings:** separate start choices for Reddit videos, GIFs and embedded players on desktop and touch. Embeds inherit the existing video choice until configured. GIFs default to Autoplay, and their silent loops can run alongside other playback.
- **Preview sound and continuation:** a YouTube tap can unmute the held player during the gesture. The sound request survives a late player connection or a fresh video in the post. Generic embeds continue to use their provider's controls where available. Players that can change sound only by reloading retain their position on a post handoff.
- **Media in posts and comments:** use the same preview settings for native comment GIFs and videos. Closing a thread stops its media. Post playback can keep going off screen or pause and resume when it is visible again. Provider embeds without playback state may require manual resume.
- **Filtered subreddit feeds:** explain when Reddit's native pager ends, and offer New or Top where available while retaining applied filters. Chrome CDP found 500 loaded cards and no pager at the end of the reported GeminiAI Videos feed.
- **Profile switching:** keep discovery cards visible when a floating-chat link opens a different profile. Live Chrome CDP confirmed all 15 outgoing cards stayed visible until Reddit mounted the destination.
- **Phone Feed options:** profile options open short drill-in pages with current values. Profile and subreddit sheets share grouped, multi-select Post type rows. Playing media retains its rounded corners during placement in a post.
- **Version:** minor increment for per-media settings and comment media. Live Chrome CDP confirmed Reddit's native feed and comment markup, its detail visibility behavior and the reported feed ending. The packaged sheet was exercised with emulated touch in Chrome. Physical phone behavior, audible provider taps and the terminal network response remain unverified.

- **Validation:** 1,988 tests passed in UTC. Firefox lint reported zero errors, notices and warnings. All 74 Chromium and 75 Firefox assets match the source, unpacked folders and ZIPs. Chromium SHA-256 `061277cac4dd9f53672f66e830d9c5fbf3737177bf099fcbfc940b6c0f9618cd`. Firefox SHA-256 `b78f819b843bb7b193883feecd6943752e1405cc704af5ebcd0e6f4aeb7e3af4`.

# 0.48.1 preview

- **Videos card:** options say only what they do, without referring to Reddit's own setting: our choices replace Reddit's autoplay on every layout. Feed videos start with **Autoplay, muted** (default), a muted preview on hover (computers) or on the video you stop scrolling on (phones), or **Only when I press Play**. On touch screens the menus are wider, with 44 px rows.
- **Playing into the post:** a playing video keeps playing when you open its post again by default, for Reddit's own videos and embeds alike; 0.48.0 had made this opt-in.
- **Embedded players:** Vimeo inside Reddit's lite-vimeo now starts and pauses with the other players, and Embedly players that never answer its messages fall back to autoplay and mute flags. Players with no controls (RedGIFs) stand behind the post's own preview image with a play button, as Reddit does for YouTube and Vimeo, so they never load or play unseen; Autoplay, a preview or a tap loads them, and leaving or another video starting brings the image back. A RedGIF restarts from the beginning rather than resuming.
- **Version:** patch increment for restoring play-into-post and the embedded-player reliability fixes. Phone behaviour of Vimeo, Twitch and RedGIFs embeds and the preview-image placeholder on live Reddit remain unverified.
- **Validation:** 1,967 tests passed locally and in UTC. Firefox lint reported zero errors, notices and warnings. All 74 Chromium and 75 Firefox assets match source and their unpacked folders and ZIPs. Chromium SHA-256 `68fd59b9fa7ef915ef4f458f13dc7d5118b689914df807d4a99ff759b9dd0174`. Firefox SHA-256 `7ba7c7c1f191644ed4d76ba032c88dd39f90b1d4d9e49653216e300e09a92c81`.

# 0.48.0 preview

- **Popup:** read settings once at startup and wait until a tab opens to load its account or cache data. Account verification for the removal-history button no longer loads the entire history. On phones, skip the desktop panel fade measurements and allow the actual popup tab to read chat totals and use the confirmed clear actions.
- **Accounts:** wait for Reddit to report the signed-in account on slower pages. The popup can recover when that report arrives, and account actions on phones use the originating window's session.
- **Videos:** the Videos card says what each option does, and every default is Reddit's own behaviour: feed videos autoplay per the Autoplay media setting (also on Reddit's phone layout, which ignores it), opening a post starts the post's own player, and a post's video keeps playing off screen. Opt-ins: muted previews on hover or on the video you stop scrolling on, keep playing into the post, and pausing a post's video when scrolled past (resuming at the same time). Preview options appear only while a preview start is chosen. Only the old opt-ins carry over from 0.47. One video plays at a time, embedded players included, and previews start through Reddit's own player so its play icon clears.
- **Embeds:** from Reddit's stored embed code (no video played), Reddit embeds YouTube (its own player with the iframe API, or Embedly), Vimeo, Streamable and Twitch (Embedly's wrapper) and RedGIFs; the other listed providers are link posts. Previews, pausing and play-here use each player's own protocol (Embedly's player.js, YouTube's iframe API, Vimeo's messages), and those players report starting so only one plays; RedGIFs and unknown players fall back to autoplay and mute flags. A playing embed's player moves into its post without reloading. Vimeo inside Reddit's lite-vimeo and TikTok keep Reddit's handling.
- **Scrolling and settings:** apply changes to open tabs after the background worker wakes, reduce repeated layout reads and profile checks while scrolling, and bound the size of filtered feeds. Chat search image and GIF thumbnails load when their result appears, with one retry. Measured with the user flicking a phone-emulated Videos feed: skipping off-screen posts left 37.8 % of moving frames at least half blank against 1.4 % without it, so touch screens no longer skip; caching Reddit's window-size reads took the feed from 2.1 to 3.2 frames per second. Reddit's own analytics and ad trackers still dominate the main thread on phones.
- **Version:** minor increment for the new video choices and embed control. Physical phone performance, chat thumbnails on a physical phone and the provider embeds on live Reddit remain unverified.
- **Validation:** 1,963 tests passed in UTC. Chrome CDP at 390 × 844 with 4× renderer CPU throttling confirmed that Home makes one settings read and Data alone loads chat totals, including with 100,000 synthetic messages; the popup's scripts ran 76 ms across 16 s of tab switching, scrolling and toggling. Firefox lint reported zero errors, notices and warnings. All 74 Chromium and 75 Firefox assets match source and their unpacked folders and ZIPs. Chromium SHA-256 `34f48566fe018ce4f1a244d1e4b96fdb764fbaa0a64e245ebb7980742cd4d76b`. Firefox SHA-256 `46330b3ca328ce3aef02a17da2b3688ac3d7502bcab3c71859cdd9221368d395`.

# 0.47.0 preview

- **Video previews, YouTube style:** a preview is muted and stays playing while the pointer moves within its post card (title, flair, votes); leaving the card pauses it after 250 ms. Clicking a preview opens its post and the video carries on there, instead of only turning its sound on; **Clicking a preview plays it here** keeps it in the feed. Reddit's sound button still acts in place. New options in a separate **Videos** section of the popup: preview while in view on phones (off by default, so Reddit's autoplay setting still holds), play here on click, play opened previews from the start, and sound when opening (fades in over 200 ms).
- **Phone previews:** with the phone option on, the video you stop scrolling on (600 ms) previews muted, as on YouTube; a playing preview continues until it is half off screen.
- **Opening a playing video's post:** the feed stays on screen instead of blanking, the same video waits at its card while Reddit builds the post, then moves into the post's slot in 220 ms on the compositor, without a clamp or distortion, and keeps its sound through Reddit's own volume state. Reddit's play icon no longer stays over an opened preview.
- **Post page scrolling:** a post's own video now pauses only when it is fully out of view and resumes at the same second when it is half back. Feed videos still pause when half off screen.
- **YouTube embeds:** hover (or the phone option) previews them muted, a click follows the same choice as videos with a sound button that unmutes in place, and opening the post moves the same YouTube player into the post's embed without a reload, hiding Reddit's thumbnail and play button until it lands. Embed thumbnails no longer reload repeatedly on type-filtered feeds: Reddit rebuilt each embed whenever its virtualizer returned a batch, which a filter made frequent, so those feeds now keep their cards mounted.
- **Filtered subreddit Back navigation:** keep the outgoing feed hidden with its filter applied while opening a post, except while a playing video or YouTube player moves into that post. Returning to that history entry restores the selected card's viewport offset after the filters are applied. In Brave, a paginated video returned to its original offset after a deliberate 180 px scroll shift during restoration. Fresh documents use Reddit's native scroll restoration.
- **Subreddit feeds:** the toolbar button and phone sheet are named **Feed options**, like profiles. Active filter chips fit beside Reddit's native View button; in Brave, both Card and Compact rendered in their selected layouts with Videos still applied.
- **Account pictures:** use the profile picture Reddit renders in its signed-in header or account menu. Saved accounts can pick up their photo when they are active on a Reddit page. Unavailable pictures fall back to an initial. Switching accounts is covered by a test that leaves Reddit's device cookies (layout, sort, chat view, codecs) untouched.
- **Smoothness:** smooth scrolling now covers lists the extension renders itself (profile search, archive cards), and chat discovery no longer runs on every feed change (the extension's scrolling work on a subreddit fell by about two thirds in a live profile).
- **Limits:** Vimeo, TikTok and other embeds get no previews or carry-over (their players offer no API on Reddit's page); YouTube may show its own ad and title bar in a preview. Reddit's Hot feed ends after a limited depth, so a type filter cannot load past it; use New or Top. The embed thumbnail fix, the hidden YouTube UI during its move and the visible filtered feed during a move were verified by unit tests only.
- **Version:** minor increment for the new preview, phone and YouTube behaviour in this bundle.
- **Validation:** 1,938 tests passed in UTC. Firefox lint reported zero errors, notices and warnings. All 74 Chromium assets and 75 Firefox assets match their unpacked folders and ZIPs. Chromium SHA-256 `a3418767b5d6aa82d34329edbc15c6ff96a4343af08d0749be2f56c4f8cb85e8`. Firefox SHA-256 `f7f31c0a7bf74e5468416e8aa3dcd1be370a950844c8c29c02e832e5455b1b11`.

# 0.46.0 preview

- **Muted hover previews:** hover over a paused native feed video to start playback with sound off. Move away to pause at the current position. Click Play, click the video, or open the post to continue from there. The separate **Turn on sound when playing a preview** setting is on by default. Reddit's mute and other media controls retain their own actions.
- **Smoother video transition:** keep the active video visible until the detail player has a layout, then ease the same player into place. Reduced motion skips the animation. In live Brave, hover playback was muted, clicking enabled sound without seeking, and opening the post continued the same video through the placement animation.
- **Version:** minor increment for hover playback and its sound setting. Touch-only feeds retain their native Play controls. Live checks covered desktop Brave.
- **Validation:** 1,904 tests passed. Firefox lint reported zero errors, notices and warnings. All 74 Chromium assets and 75 Firefox assets match their unpacked folders and ZIPs. Chromium SHA-256 `7ff46278f9aae4024a58d35f35ab744c6fba54684babb834b32d649fa60c2fd1`. Firefox SHA-256 `56b2fe0bb1b5ee4c70a15fb4b1acc9849540894f738b3496a2fa879a0c5a489d`.

# 0.45.2 preview

- **Video post navigation:** keep playing after the post finishes loading. Start visibility tracking again after the detail player paints so an old feed reading cannot pause it. Hide the outgoing feed while the video moves, then restore its visibility for Back navigation.
- **Live Brave check:** the feed stayed hidden during navigation. The original video advanced from 0.77 seconds in the feed to 4.38 seconds after the post settled, with no pause event.
- **Version:** patch increment for the playback and visual transition fixes.
- **Validation:** 1,898 tests passed. Firefox lint reported zero errors, notices and warnings. All 74 Chromium assets and 75 Firefox assets match their unpacked folders and ZIPs. Chromium SHA-256 `56162f9cbbdd6b59065da03cf7a62e8c90ead7d05fbc292c41dc9d7770222d4e`. Firefox SHA-256 `09199981b5e7b574f01954715131c0659fc6ecbe9fe6bc3749892c37612a8993`.

# 0.45.1 preview

- **Uninterrupted feed video:** retain the same native playing video through Reddit's in-app post navigation and move it into the full post. The saved-position fallback still covers full page loads. In live Chromium, the video advanced through a 0.86-second transition with zero pause, seek or buffering events.
- **Subreddit Sort:** hide the native Sort and Top time controls from the first frame while Feed options takes over. Reddit's View control stays visible. The standalone sorts stay available when the extension cannot replace them. On a live Chromium subreddit load, the first toolbar frame showed Feed options and View with zero visible frames of native Sort.
- **Version:** patch increment for both transition fixes. Live validation used desktop Chromium. Physical phones and live Firefox playback remain unverified.
- **Validation:** 1,897 tests passed. Firefox lint reported zero errors, notices and warnings. All 74 Chromium assets and 75 Firefox assets match their unpacked folders and ZIPs. Chromium SHA-256 `bba34831ab5b333cc8e6a9214f0c6ad504381d97c30a87d10cb327e0c12f95db`. Firefox SHA-256 `862f4c61746f938e60ec271b7282db310a77cb2d228719a07d202f5bcb8fb214`.

# 0.45.0 preview

- **Continue feed videos:** open the post for a native Reddit video you started in the feed and resume from the latest position with the same volume, mute setting and speed. The feed player can keep playing while the post loads. **Keep playing when opening a post** is on by default in the extension settings. Silent previews no longer have a badge.
- **Live verification:** Brave desktop handed off a playing video at 14.40 seconds with 1.25× speed and sound preserved. Reddit can remove the old player before the new one is ready, so there may be a brief gap. Physical phones and live Firefox playback remain unverified.
- **Version:** minor increment for feed-to-post playback continuation. No new extension permissions.
- **Validation:** 1,893 tests passed. Firefox lint reported zero errors, notices and warnings. All 74 Chromium assets and 75 Firefox assets match their unpacked folders and ZIPs. Chromium SHA-256 `6369fa0227d2e5d4ce620a08f8b1f989cd6aa72cedd07500a0d94f14b55f450c`. Firefox SHA-256 `6e5abee7513eb931dd314597347dd33f62562b0793149e28706f030b7d98adbb`.

# 0.44.0 preview

- **Live subreddit Feed options:** sort, post type and flair share one menu. Sort includes Reddit’s Top time ranges when available. View and pagination continue to use Reddit’s controls. The local type filter follows newly loaded cards and pauses automatic loading after two consecutive empty continuations. Load more resumes the native pager.
- **Search a subreddit without keywords:** press Enter in Reddit’s existing scoped search field while it’s empty. Reddit supplies the Posts, Comments and Media results, with sort, date and flair controls. Enforce the selected period on dated Posts and Comments cards when Reddit’s sort ignores it. On the Media tab, combine Photos, Videos, GIFs and Galleries. Media cards use Reddit’s date handling, and thumbnails without a type marker are grouped with Photos.
- **Filter appearance:** desktop feeds use Feed options rows with current values and drill-in menus. Phones keep the feed sheet. Subreddit search uses inline filters and per-filter menus, matching profile search. Live Brave checks covered native flair, empty Enter, later feed pages, date filtering and the desktop and emulated phone layouts. Physical phone behavior and live Firefox UI remain unverified.
- **Version:** minor bump for the live subreddit filter and search features, including the unreleased 0.43.0 changes below.
- **Validation:** 1,888 tests passed. Firefox lint reported zero errors, notices or warnings. The 74 Chromium assets and 75 Firefox assets match the committed source and their unpacked folders. Live Brave checks covered changing Top’s time range on desktop and choosing New in a 390px phone sheet. Chromium SHA-256 `8def4ad3c625fc5912da5947905bc70d0c68d9ac21b28bfd6c9327fbf66f3034`. Firefox SHA-256 `0526b28dc2b91b06506ae0407777619877876ce3eb3806441caec15fcb108904`.

# 0.43.0 preview

- **Account switching:** switch saved Reddit accounts from the native account menu or popup; Add account uses Reddit’s sign-in. Exactly five session cookies are stored in worker-only extension storage, never exposed to pages or the popup. Removing an account deletes its snapshot. Reddit’s Log Out is never called. Add account sign-in was confirmed working by the user.
- **Switch accounts submenu:** Reddit's account menu (desktop and phone) has one Switch accounts row after View Profile (after Log In when signed out with accounts saved); it opens a panel in place with the saved accounts, **Anonymous browsing** and Add account (both ask once more). Back, Escape and reopening the menu restore Reddit's own view. On phones it opens an **Accounts** sheet shaped like Reddit's app instead (accounts with the current one checked and Reddit's Log Out icon to sign out here, Anonymous browsing, Add account), which also fixes the in-menu panel not loading in Reddit's phone sheet. The row uses a stacked-portrait icon; the popup also offers Anonymous browsing. Accounts are saved as soon as a signed-in page reports them, so switching works right away.
- **Private windows:** switching, adding and signing out act on the cookie store of the asking tab or popup window; accounts first saved in a private window live in session storage only and never overwrite a normal-window record. Reported issue fixed: from a private window Switch refused with "open the account menu".
- **Phone taps:** a touch tap on an account row acts on pointerup when Reddit's bottom sheet swallows the click. Not verified on a physical phone (synthetic touch is unavailable in Chrome on Linux).
- **Feed options on phones:** below 768 px the profile Feed options opens one sheet shaped like Reddit's app: title and round close button, sort rows listed directly (Top opens Reddit's time list, Old from the archive), View chips, and a Filter section with Activity, Date and Post type chips, a Community picker page and Refresh activity. Built from the live menu; desktop unchanged. New sort now uses Reddit's own icon (icon-name "new") everywhere instead of the extension's sparkle. Measured live at 390×844: sheet flush to the bottom edge, rows 52 px.
- **Smooth scrolling everywhere:** "Smooth long feeds" becomes "Smooth scrolling" for the whole site with sub-options (Home, Popular & All; Subreddits; Profiles; Search results; Long comment threads, off by default). Posts, ads, search results and top-level comments more than two screens away skip layout and paint at their measured height. Reddit itself applies no content-visibility anywhere (measured).
- **Videos:** Reddit's "Autoplay media" off is enforced (its phone layout ignored it; read once per session from Reddit's settings page), with **Silent previews** (muted 10 s loop that never advances; tap to watch from the start with sound), and a playing video pauses once less than half of it is on screen. Not verified on a physical phone.
- **Popup on phones:** account switching and removal history work when the popup opens as a tab (Firefox for Android, Kiwi); pinned tabs and 40 px touch targets.
- **Chat startup:** keep the newest native cache page at 20 and read later pages 100 at a time (previous live measurement: 6.4s → 4.6s for 1,008 conversations). Hold the first visible list until names/order/avatars settle, with a 4.5s cap and avatar grace; later updates never rehold. The search toolbar stays 52px high with a 40px field.
- **Chat scrolling:** defer ordinary discovery until a native scroll pause, bounded to 1.2s; navigation remains immediate. Matched foreground list captures reduced scheduled callback time from 268.91ms to 72.80ms and heartbeat time from 45.31ms to 0.15ms. A remaining callback reached 19.26ms; this does not establish that all jank is resolved.
- **Profile loading in Brave:** reserve native scrollbar space while extension-sourced cards load. The empty interval previously removed Brave’s 15px scrollbar, shifting the centered column right by 7.5px and back. Live testing on the requested profile kept main/feed/card x at 112.5px across loading and 12 attached posts. This presentation correction keeps the unpublished 0.43.0 preview version.
- **Collapsed profile navigation:** seed each incoming native sidebar once from Reddit’s saved UI preference, preventing its server-rendered expanded default from temporarily moving the content right. Preserve native spacing and later sidebar toggles. The user confirmed the reported shift is fixed.
- **Profile transitions:** restore Removed in the native mutation checkpoint, preventing the measured 42.32px tab-strip contraction while switching native profile tabs. The Feed options inset remains consistent. Removed and List controls stay restricted to your own profile; cached account identity is bound to the account that supplied it.
- **Other fixes:** phone-friendly menus and card headers, menu stacking, and raffle UI cleanup.
- **Version:** minor increment for account switching and the startup presentation feature. The account switcher adds the user-approved cookies permission; the startup/scroll fixes add no permission or storage schema.
- **Validation:** all 1,860 tests pass; Firefox lint reports 0 errors, 0 notices and 0 warnings. Chromium's 71 assets and Firefox's 72 match their unpacked folders and ZIPs. SHA-256 Chromium `518cb543f009203c706dbf2e1ad1780c2154225ba7025666d8a9b4f203a96033`, Firefox `8aeb7f6cc7fb8225803f30c1de595115051609b555dc7441c4134a643c8435c8`.

# 0.42.0 preview

- **Smooth long feeds (new setting, on by default):** on profiles the extension manages, loaded posts stay in the page and those more than two screens away skip layout and painting (`content-visibility`) at their measured height, so fast flicks no longer reach empty placeholders that must be rebuilt first. Posts near the screen are drawn normally, so menus and pop-ups work. Posts are still swapped out beyond 40 screens to bound memory. Turn it off under Profile search & hidden activity for the previous behaviour.
- **Scrolling without blank screens:** measured with phone emulation and 4× CPU while scrolling a long profile, the page's main thread was blocked 48.7 s of 90 s, about 23 s of it forced layout from extension code, and a fast flick up showed a fully blank screen for ~0.9 s. The feed bridge no longer measures every post on every scroll frame: placeholders come back through an IntersectionObserver within four screens, and the full measure-and-tidy pass runs after scrolling pauses. Feed re-ordering and card publishing also wait while you scroll away from the feed end.
- **Version:** minor increment for the new setting. No new permissions or storage schema changes; the setting is one optional preference key.
- **Validation:** all 1,795 tests pass; Firefox lint reports 0 errors, 0 notices and 0 warnings. Chromium’s 65 assets and Firefox’s 66 match source, unpacked folders and ZIPs. SHA-256 Chromium `d059edea39d8bca9efece7be45bdcba5f8c12157baaa7886623521b10063c05f`, Firefox `85aa3d227c978da72cbe7914c3fec5b36b733205cce5c7cce731fa314768e303`.
- **Limits:** the improvement applies to profile feeds the extension manages; other Reddit feeds keep Reddit's own behaviour. Very slow devices can still drop frames while Reddit's post components draw; the aim is no blank screens, not a fixed frame rate. Not yet confirmed on a physical phone.

# 0.41.0 preview

- **Back to profile search:** restore the same loaded results before Reddit’s temporary no-results/skeleton content paints, including empty-query searches. Filters, row identity, cursors and scroll retain the existing bounded in-memory cache; no repeated initial provider read for a valid retained search.
- **Compact History picker:** equal-height single-line choices, with 20 labeled like the other numbers. The menu sits outside the Settings panel’s fade mask and stays within the popup viewport, scrolling internally when necessary.
- **Firefox builds:** separate Firefox 140+ desktop / 142+ Android manifest metadata, a static event-background bundle and an AMO-uploadable unsigned ZIP/XPI from the same source. GitHub builds and tag releases include both browser variants and their unpacked files. Firefox requires Mozilla signing for normal installation; the unsigned export can be uploaded for validation/signing or loaded temporarily. Reddit live UI parity on Firefox is not yet verified.
- **Firefox limits:** the existing signed-out reader requires credentialless iframes and fails closed when the browser lacks them; this build does not add a replacement transport. Data-transmission declarations cover provider requests; saved chat/history stays local. All 13 dynamic-HTML warning sites have been replaced by safe DOM construction.
- **New icon:** circular orange badge with transparent exterior and a cohesive lower torso, exported at toolbar, manager, popup and listing sizes. The pasted JPEG and retired SVG branding are no longer shipped.
- **Version:** minor increment for the additional Firefox build target; no Chromium permission or storage schema changes. The Firefox ID is reddit-tweaks@kryptobolt07.
- **Safe DOM rendering:** native custom-element names are validated and parsed inertly; SVGs are rebuilt from allowed shapes/attributes, rejecting scripts, events and URL paints. The calendar uses direct path nodes. CI treats Firefox warnings as failures.
- **Validation:** all 1,787 tests pass in UTC; Firefox lint now reports 0 errors, 0 notices and 0 warnings. Chromium’s 65 assets and Firefox’s 66 generated/shared assets match the unpacked folders and ZIPs; XPI/source integrity and reproducible source rebuild pass. Internal DOM-rendering corrections keep this unpublished 0.41.0 upload version. Chromium SHA-256 `517f0ed917f40157419a58f59a3f9da195c98f2c1605d58ea490cd7fc9bd6968`; Firefox SHA-256 `40e21d0e88d9b395befaa51d8b8b34cfa718a1229d83f49c54688df1a1cd26c5`.

# 0.40.1 preview

- **Preserve existing recent History:** opening extended History now saves the recent entries Reddit already provides, including when enabling it on the native History tab. Missing rows are added without replacing newer recorded visits. Visits Reddit no longer lists remain unrecoverable.
- **New visits appear without reloading:** record hydrated post pages promptly and before link navigation; revisiting History refreshes its completed cached feed. Re-enabling on the same post and switching accounts record correctly. Failed writes retry at most three times; unavailable recorded History is reported as incomplete while recent native rows remain visible.
- **History menu:** replace the platform select with a themed, keyboard-accessible radio menu using the popup’s light/dark colors. Failed saves retain the previous selection. Counts now describe available items separately from the configured saving capacity.
- **Compact archive header:** the large Banned · Archived posts pill is replaced by the existing removal glyph beside r/name; private communities use their existing hidden glyph. State and archive attribution remain in the accessible label and tooltip.
- **GitHub build:** fix an existing chat-time test’s assumption that the runner is in India; it now formats the fixture’s absolute timestamps in the current timezone. Runtime date formatting is unchanged.
- **Version:** patch increment for History recording, preservation and refresh reliability. No new permissions, endpoints or storage schema changes; seeded rows have an optional marker and internal ordering key, not a claimed exact view time.
- **Validation:** all 1,774 tests pass in UTC; 52 shipped JavaScript files parse; ZIP integrity passes and all 66 assets match source/archive/stable unpacked output. History/popup checks: 57 pass; archive-header checks: 69 pass. SHA-256 `ba27b0a043ccf6a87f5d3a5a84445a512a01bb08b6b904ceec690e3924e614f4`.
- **Review:** no new browser/CDP or real History-clearing checks; synthetic regressions cover the reported flows. Reload the extension and refresh Reddit to install the corrected scripts. GitHub publishing remains tag-triggered and no release tag is pushed by this update.

# 0.40.0 preview

- **Longer viewed-post History:** choose Reddit’s usual recent views (default), 100, 500, 1,000, 5,000 or No limit in Settings → Profile search & hidden activity → History length. When raised, posts you open in this browser are recorded locally per signed-in account. The profile History tab and List → History search combine Reddit’s recent views with recorded ones, without repeats; the tab draws Reddit’s own cards 25 at a time as you scroll.
- **History limits and recovery:** recording starts only after raising the limit; earlier visits and other browsers/devices cannot be recovered. Counts are snapshots from the visit. Returning to Reddit’s default deletes recorded history and restores the native tab. Adds `unlimitedStorage` and account-scoped IndexedDB storage; lowering a custom limit trims recorded history. Reload the existing extension installation and refresh Reddit to enable the new scripts while keeping other saved data.
- **GitHub pipelines:** pushes/PRs build and test the extension and upload a checked ZIP/checksum plus an unpacked artifact. A matching `v<manifest version>` tag runs the same validated build and creates a GitHub release (a prerelease for previews). No automatic store submission or replacement of existing release assets.
- **Version:** minor increment for the new History feature. Includes the intervening Removed archive-pooling improvements already documented under 0.39.3. Current source is exported to the stable unpacked folder; generated bundles remain uncommitted.
- **Validation:** all 1,759 tests pass; 52 shipped JavaScript files parse; both workflows pass actionlint 1.7.12; ZIP integrity passes and all 66 shipped files match source/ZIP/stable unpacked output. SHA-256 `cb6987e32d7e0f1743c632c5f2e024f97d48badd5c358f39b67022d14b3a40d9`. Stabilized one existing test’s initial pending-state assertion by removing an unnecessary delay; runtime restoration is unchanged.
- **Review:** no new browser/CDP checks in this release task; History’s earlier read-only verification is recorded in `docs/viewed-history-spec.md`. GitHub tag-triggered publishing has not been run as part of this update.

# 0.39.3 preview

- **Search reads to the end:** profile search no longer stops after ten pages with "Searched back to…", "Search older" or "Search and archive coverage may be incomplete". It keeps loading as you scroll until Reddit and the archive both have nothing left. Errors still pause with Retry. Subreddit archive search is unchanged.
- **Reddit's own no-results page:** an empty profile search (plain, Removed, Saved, History and the other lists) shows Reddit's own view: Snoo, "Hm...we couldn’t find any results for "…"", the hint and Adjust your search. 0.39.2 looked for markup Reddit doesn't serve (`#empty-search-results`); the live view is `search-error-message`. Only the view is reused, never Reddit's telemetry wrapper.
- **No invented zero counts:** Removed results saved before 0.39.2 had no vote or comment counts and showed "0 votes · 0 comments" until the fresh check finished. They now show no count line until real counts arrive. One complete check re-saves the list with counts.
- **Removed comments and media:** comment rows now show their post title and time, and media tiles their time. Reddit's time element stays empty on pages where Reddit doesn't load its script; it now falls back to the same `<time>` markup. Thread vote/comment counts stay absent, as in Deleted comments: Reddit's profile cards don't carry them.
- **Lighter on Arctic Shift:** the archive is a free, community-run service, so Removed now asks it far less for the same results. A fresh open went from 212 requests to 36 after the first complete read: the full archive history is re-read only once a week (in between, only newer history), post titles are looked up only for removed comments, and ID lookups carry up to 100 items instead of 25 and are pooled across profile pages (comment verdicts that need the archive appear up to about 8 seconds later).
- **Popup:** the "Your removed content" summary, Open removed content and Recent changes are gone; Removed on your profile is the place to review removals, and opening it clears the toolbar count. Clear this account’s checks moved into the Your removed content settings.
- **Reddit's spacing:** the first search result and the no-results view now sit where Reddit puts them (8px under "Show results from…"), instead of 28-46px lower. The "Some matches filtered locally" banner is gone from search; the note stays in the screen-reader status.
- **Version:** patch increment for search reliability and layout fixes. No new permissions, endpoints or storage changes.
- **Validation:** all 1,736 tests pass; 49 JavaScript files parse; ZIP integrity passes; all 63 shipped assets match source, archive and the stable unpacked folder. SHA-256 `85ed62ff5fecd2289ac8a4f48039f411f17d540dacc9e78678bba18dd63f242c`.
- **Live check (read-only, separate tab):** plain search paged to the end of both sources (back to Sep 2024) with no note or button; an unmatched query showed Reddit's view at the same 204/220/364px positions as a native no-results page; the first result moved from 232px to 204px in plain and Removed search; Removed search showed stored counts at once. Removing the Removed filter kept r/LaptopDealsIndia and the other filters.
- **Limitation:** Removed's no-results view was seen live with Reddit's title and button on the pre-layout build, but on 0.39.3 Arctic Shift refused the deleted-items read twice, so Removed correctly showed the archive error instead of an empty result. Its position uses the same feed and spacing rules as plain search (measured at 204px) but wasn't measured live.

# 0.39.2 preview

- **Removed search facts:** previews, votes and comment counts now travel from native cards through saved Removed results into search rows. Existing saved entries gain missing facts on their next fresh check.
- **Independent, stable filters:** removing the Removed chip preserves the query, Posts/Comments/Media scope, native time/sort/Safe Search and other filters. The inline filter controls stay in place through native navigation and menu replacement.
- **Time-bounded Removed search:** Today/Past hour and custom date windows stop profile/archive walks once they pass the selected range, check only relevant items and retain the complete saved account list. Native and custom dates intersect. Changing dates cancels the previous walk.
- **Reddit’s actual empty view:** completed empty Removed searches use Reddit’s served empty-search component, artwork and Adjust your search button, with Removed-specific wording. Existing native markup is reused; otherwise one normal same-origin HTML search supplies it and is cached for five minutes. A missing/blocked template shows an error and is retried only on explicit refresh.
- **Version:** patch increment for search reliability, performance and missing result facts. No new permissions, deprecated Reddit endpoints or storage schema changes; saved rows gain optional bounded facts and a safe preview URL.
- **Validation:** all 1,723 tests pass (542 focused regressions); 49 JavaScript files parse; ZIP integrity passes; all 63 shipped assets match source, archive and the stable unpacked folder. SHA-256 `bcf418640c9a398cbc4b07aa4730eaebd6563724fba094533a6ea18545e4a324`.
- **Review:** no browser/CDP or account writes in this increment. Installed native layout and loading transitions await extension reload, Reddit tab refresh and user review. A first uncached check still depends on Reddit and archive response times; date bounds avoid unrelated historical work.

# 0.39.1 preview

- **Smooth scrolling in Removed:** scrolling down and back up no longer leaves blank spaces that fill in late, and the page no longer shifts when you stop. Reddit's feed swaps off-screen cards for placeholders; Removed's updates were pulling those cards back in beside the placeholders. Updates now work with whatever is holding each card's place and move nothing that's already in place. Cards that came from your saved list are updated in place when fresh results arrive, instead of being rebuilt.
- **Version:** patch increment for a scrolling fix. No new permissions, endpoints or storage changes.
- **Validation:** all 1,707 tests pass; 49 JavaScript files parse; ZIP integrity passes; all 63 shipped assets match source, archive and the stable unpacked folder. SHA-256 `b550c5f9b13c945359b28d35ea08cb7f412e11c5375a10079e71f92c23bec19d`.
- **Live check:** read-only Chrome CDP in a separate tab on the signed-in account, scrolling with real wheel events during the background check. Over three down-and-up cycles: no movement after scrolling stopped, no blank spaces in view, and no card moves besides Reddit's own placeholder swaps.

# 0.39.0 preview

- **Removed opens instantly:** each complete check saves your removed items for your account: their date, community, link, the verdict, and their own title and text so search can match them. Opening Removed or searching it shows that list at once, while a fresh check confirms or updates it in the background. Saved entries that the fresh check no longer finds are dropped. Signed-out results for items older than a week now last 7 days; recent items are still rechecked after 12 hours.
- **Looks like Reddit's lists:** removed comments now appear, drawn as Reddit's own cards. A removal is one red ban icon right after the time, with the wording in its tooltip, here and wherever Reddit Tweaks marks your removed posts and comments. The refresh button and the extra space above the first item are gone, so the list starts where Reddit's History does. Archive cards show community icons, and the tab strip scrolls so "Removed" isn't hidden under Reddit's arrow.
- **More removals found, fewer wrong ones:** items Arctic Shift saw removed (including Reddit's "[ Removed by moderator ]" retitle) that are no longer on your profile now show as "no longer on your profile", even when the archive never recorded a deletion. Archive items no longer flash up before your profile check reaches their date.
- **Fixes:** clicking a blurred NSFW or spoiler area no longer opens the post. A busy moment no longer fails the check with "Please wait for the current Reddit request".
- **Version:** minor increment for the saved-results feature. New storage: one saved Removed list per account, cleared together with removal history. No new permissions or endpoints.
- **Validation:** all 1,704 tests pass; 49 JavaScript files parse; ZIP integrity passes; all 63 shipped assets match source, archive and the stable unpacked folder. SHA-256 `7e095ec990f53265e981dce3e3d7e09c22eafd94337b31d8b8fce42dad465958`.
- **Live check:** read-only Chrome CDP in a separate tab on the signed-in account. Saved results appeared at 2-4 s; the background check completed without error. 69 removals were found, 13 of them archive-only. The first card sits at Reddit's own History offset, and each removal shows one icon.
- **Limits:** the NSFW reveal fix wasn't verified live, because no blurred item was in the list; a synthetic test covers it. A first uncached check of items in communities hidden from your signed-out profile still takes about one second each.

# 0.38.9 preview

- **Removed reads everything:** your own profile has no 1,000-item limit, and the limits were ours. Removed now reads your profile until Reddit has nothing left (2,094 items back to 2020 on the test account), compares it with the signed-out view to its end, and reads your Arctic Shift history to its end. Live results decide every item Reddit still lists; Arctic Shift adds removed items you later deleted. Very high safety stops only end a runaway walk, and say so if ever reached. Saved, History, Hidden, Upvoted and Downvoted keep Reddit's real 1,000-item limit.
- **A feed cut short is caught:** Reddit once ended the profile early with no error. A page that claims to be the last is read once more before the walk stops, and your Posts tab is always read afterwards so posts are covered either way.
- **Version:** patch increment for a coverage fix. No new permissions, endpoints or storage changes.
- **Validation:** all 1,686 tests pass; 49 JavaScript files parse; ZIP integrity passes; all 63 shipped assets match source, archive and the stable unpacked folder. SHA-256 `637a03d327db6545f49f05dfb1d5f11d310adac755efc5c4333ef9f496ce7d6a`.
- **Live check:** read-only Chrome CDP in a separate tab on the signed-in account. All 2,094 profile items were checked by about 130 s with cached signed-out results, finding 58 removals (up from 47). 8,245 archive records were read to the end by about 280 s, with no coverage warnings.
- **Limits:** a first, uncached load still checks items in communities hidden from your signed-out profile one at a time, about one a second. While the archive history is still being read, "Loading…" stays shown after the profile results are complete.

# 0.38.8 preview

- **List search matches profile search:** Saved, History, Hidden, Upvoted, Downvoted and Removed search now use Reddit's own Posts / Comments / Media row, so spacing matches profile search and the first result is no longer cut off under the filter row. Choosing a sort (New, Old, Relevance, Top) or Safe Search in Reddit's menus keeps you in the list search, with its type and filters; New and Old order the list by date.
- **Older removed posts are found:** Removed used to stop at your newest 1,000 profile items (posts and comments mixed), so older moderator removals still on your profile were never checked. After that window it now walks your Posts tab, compared with what a signed-out visitor sees, the same way.
- **Faster Removed view:** each page is checked while the next one loads, and Arctic Shift recovery of removed-then-deleted items starts immediately, so those appear in the first seconds. Your item lookups go ahead of history pages in the shared, paced archive queue.
- **Archive recovery is steadier:** a history page Arctic Shift refuses (HTTP 422 on heavy author queries) is retried, and no longer pauses your other archive reads for a minute. If a post the archive flagged as "removed, then deleted" is still live and visible, the live result wins, so stale archive flags aren't shown as removals.
- **Version:** patch increment for user-visible fixes to search navigation, Removed coverage and speed. No new permissions or storage changes; the new reads are Reddit's own Posts tab pages (signed in and signed out), and no retiring Reddit API is used.
- **Validation:** all 1,682 tests pass; 49 JavaScript files parse; ZIP integrity passes; all 63 shipped assets match source, archive and the stable unpacked folder. SHA-256 `6e533a5fca324c4ebf4f75a2fe00a5cf4bbdbdff76885d7cd17837ea55b19097`.
- **Live check:** read-only Chrome CDP in separate tabs on the signed-in account. Removed search has Reddit's tab row, with the first comment fully visible, and choosing New keeps Removed. In the Removed view, archive items appear at 6 s and 1to396r is found as removed by moderators. With a warm cache all checks finish by about 85 s, and archive history ends by about 2 minutes.
- **Limits:** comments older than the newest 1,000 profile items are covered only by archive history. A first, uncached load still checks items in communities hidden from your signed-out profile one at a time, about one a second. Later loads reuse those results.

# 0.38.7 preview

- **Removed tab highlight:** selecting Removed now highlights Removed instead of Hidden. Removed opens on your Hidden list's address, where Reddit draws Hidden's highlight as an inline style and never repaints it. Removed now takes that highlight, and the original styling is restored exactly when you leave or turn the feature off. If Reddit resets its tab count, which stopped Removed being drawn, the count is written again. A later native repaint of the tab strip can't move the highlight back to Hidden.
- **Version:** patch increment for a visible navigation fix to 0.38.6. No new permissions, endpoints or storage changes.
- **Validation:** all 1,666 tests pass; 49 JavaScript files parse; ZIP integrity passes; all 63 shipped assets match source, archive and the stable unpacked folder. SHA-256 `0e6b5b1137be59f6f2e11fda49b1e9f153ffe8586301e033c2a535e87efa0728`.
- **Live check:** read-only Chrome CDP in a separate tab on the signed-in account. Clicking Removed, loading its address directly, and going to Hidden and back each highlight exactly one tab, with all nine tabs drawn.

# 0.38.6 preview

- **Removed opens like History or Upvoted:** the Removed tab in your profile tab bar now opens through Reddit's own list shell (`/user/<you>/hidden/?rt_view=removed`) as one newest-first feed of posts and comments. It has no feed filters, sort or content sub-tabs, and the Overview composer and feed controls are hidden reversibly. Turning the feature off restores Reddit's own empty-list notice and controls.
- **Search keeps its filters:** pressing Enter in the scoped search bar opens Removed search with Posts / Comments / Media and the usual filter ribbon.
- **Deleted removals recovered from Arctic Shift:** items removed and then deleted aren't on your profile or in Reddit search. Recovery now walks your archived author history the same way an archived profile is paged, for both posts and comments. It no longer stops at the oldest item still on your profile, runs even when the profile is empty, and goes up to 50 pages (5,000 records) per kind. Stalled cursors and the page limit are reported as incomplete coverage. Recovered items are merged into the feed by date and show their archived text.
- **Version:** patch increment for user-visible reliability fixes. No new permissions, endpoints or storage changes. The existing six-hour history cache and the one-second shared archive pacing still apply.
- **Validation:** all 1,664 tests pass; 49 JavaScript files parse; ZIP integrity passes; all 63 shipped assets match source, archive and the stable unpacked folder. SHA-256 `f2a18053833fafb9a8ecf61f388cda564a12f256d68d6b287a399790209db63d`.
- **Verification limits:** synthetic fixtures and existing captured native markup only; no live browser check in this release. Installed review needs an extension reload and a Reddit refresh.

# 0.38.5 preview

- **Unified Removed profile feed:** selecting Removed in your horizontal profile tabs shows posts and comments together, like the other profile lists. It has no search content-type sub-tabs. Old profile URLs carrying Posts/Comments/Media now open that same unified feed and share its navigation cache; layout controls drop the obsolete scope parameter.
- **Search matches Reddit:** every own-list search has exactly Posts / Comments / Media. All has been removed. Missing, invalid and legacy `type=all` search parameters default to Posts. Searching from the unified Removed profile opens Removed search at Posts; existing Comments/Media searches retain their selected type, query and filters.
- **Version:** patch increment correcting the profile/search distinction; no new permissions, endpoints, archive policy or storage changes. Native cards, layout controls, cached removal evidence and request pacing remain in use.
- **Validation:** all 1,651 tests pass; 49 JavaScript files parse; ZIP integrity passes; all 63 shipped assets match source, archive and the stable unpacked folder. SHA-256 `49f51b444dd9797b525d42600b46c2ddc48a85d14799c55a94caf1243af67fbf`.
- **Verification limits:** synthetic fixtures and existing captured native markup; no browser/CDP, constructed preview or live account actions. Installed review follows extension reload and Reddit refresh.

# 0.38.4 preview

- **Saved and Removed search tabs:** list search now has its own native-styled All / Posts / Comments / Media row above the inline filters, whether Reddit supplies a tab bar or not. Native observed attributes configure the row immediately and after component upgrade; it no longer waits for page-world definitions or changes Reddit's linked result-panel pagination.
- **Content separation:** Posts, Comments and Media retain their own scope, query and filters, including removals followed by author deletion. All remains the combined view. Existing removal evidence, scan limits, archive cache windows and request pacing are unchanged.
- **Hydration and cleanup:** a removed tab row is restored without refetching loaded items; reattaching the result feed retains the original native visibility state. Leaving list search or disabling discovery restores Reddit's original tabs untouched. The Removed profile entry also configures its pagination through shared DOM attributes.
- **Version:** patch increment for a visible search-navigation reliability fix; no new permissions, endpoints or storage changes.
- **Validation:** all 1,640 tests pass (428 focused); 49 JavaScript files parse; ZIP integrity passes; all 63 shipped assets match source, archive and the stable unpacked folder. SHA-256 `2eafd2e9ef63c2563f121ebb348d3f6e8eacf7d8d274fb07ea7d257f9d7164ab`.
- **Verification limits:** regression fixtures and existing native component/markup captures plus user screenshots; no CDP, constructed preview or live account writes. Installed appearance and navigation await user review after reloading the extension and refreshing Reddit.

# 0.38.3 preview

- **Removed profile section:** Removed stays beside Saved, History, Hidden, Upvoted and Downvoted on your own profile. It opens a normal profile feed with native post/comment cards, card/compact layouts and All/Posts/Comments/Media scopes. Removal labels retain their existing evidence and confidence. The separate Removed search view remains available through the scoped header.
- **Profile search Enter:** empty Enter opens a person's profile search again, including with Arctic Shift off and Reddit's current scope-chip markup. Removed/list searches retain their scope and content type. Modified/composing Enter and ordinary typed native searches keep their existing behavior.
- **Navigation:** loaded Removed cards survive hydration and Back without rescanning; native feed visibility, tab selection and controls restore on opt-out or sign-out. Linked native pagination keeps the profile's real panel visible. This changes presentation/navigation only; existing detection, cache windows and archive pacing remain in use.
- **Version:** patch increment to repair the existing Removed section and restore profile search behavior; no new permissions, retiring Reddit endpoints or storage migration.
- **Validation:** all 1,627 tests pass; 49 JavaScript files parse; ZIP integrity passes; all 63 shipped assets match source, archive and the stable unpacked folder. SHA-256 `be8c86c0a1ee2b32f178c80546c9bef2a23d623db0d7d3c11cfa2df7a1cdd0db`.
- **Verification limits:** synthetic regressions and existing captured native markup/component contracts; no Chrome CDP, preview browser or live account writes. Installed appearance and navigation await user review after reloading the extension.

# 0.38.2 preview

- **Fewer archive reads:** Removed resolves signed-out visibility before archive ID enrichment, skipping items confirmed visible, self-deleted, private/quarantined or already carrying an explicit removal cause. Generic/unknown removals retain historical evidence and cause inference. Hidden-community candidates still receive direct checks without prefetching the archive solely to rank them.
- **Shared archive cache:** own-removal ID hits are reused for 24 hours, successful misses for one hour and author-history pages for six hours. Per-ID keys reuse records across overlapping batches, tabs and passive monitoring; empty history pages are cached too. The trusted browser-session cache survives worker sleep and is bounded to 512 entries / 2 MiB; responses are held in browser memory, not local/sync storage or disk, and cleared on archive opt-out. Native account checks and preference-generation guards reject stale work.
- **Request pacing:** new own-removal ID/history reads share one queue, at least one second apart. Transient HTTP/network/invalid-response failures pause new attempts for a minute without caching false absence. Existing service cooldowns and maintenance pauses remain in effect.
- **Version and limits:** patch increment for request-volume and reliability improvements; no new permissions or persistent storage migration. Archive snapshots can lag ingestion during their cache windows. Refresh reuses unexpired historical results; restarting the browser clears this temporary cache. Other archive features retain their existing policies.
- **Validation:** all 1,611 tests pass; 49 JavaScript files parse; ZIP integrity passes; all 63 shipped assets match source, archive and the stable unpacked folder. SHA-256 `9d4535581220d9463771f1352687ec354e1cc6e356e3398c042909309d1041c4`.
- **Verification limits:** synthetic request-count, expiry, worker-restart, overlapping-batch, ownership, opt-out, failure and ordering tests; no live CDP, preview browser or account writes. Final installed review is left to the user.

# 0.38.1 preview

- **List tabs:** Removed (and other own lists) showed Reddit's Posts tab highlighted while listing posts and comments; the All tab was in the page but never drawn. All is now drawn first and the highlight follows what is listed.
- **Cached checks:** reopening Removed reused nothing. Signed-out results are now kept per account (status and time only, no text): visible for 12 hours, removed or deleted for 24 hours. Only new or expired items are checked again. Works with monitoring off.
- **Version:** patch increment for the tab-state fix and the caching performance improvement; no new permissions. Storage gains one per-account key for these results.
- **Validation:** all 1,600 tests pass; 48 JavaScript files parse; ZIP integrity passes; all 62 shipped assets match source, archive and the stable unpacked folder. SHA-256 `3505b252d2641786a6ec5a29a939a4dea114932a44e4511a916175f3566f2f4a`.
- **Verification limits:** synthetic tests, with the tab-group behaviour taken from live measurements; not re-checked live after these changes. Refresh reuses cached results within their time limits.

# 0.38.0 preview

- **Removed works on real profiles:** it found the signed-in account only on pages showing your own posts (Reddit names the account with a userName key), and stopped after the first profile page (later pages carry Reddit's modal widgets). Both fixed; the whole profile is walked.
- **Signed-in vs signed-out comparison:** the view compares your profile with how a signed-out visitor sees it, page by page, through the existing anonymous session. Items a visitor sees are confirmed visible in bulk instead of one request each (one-per-item made Reddit refuse after ~200). Only the rest get a single signed-out check, about one a second, real differences first; a refusal stops the rest and is reported. Signed-out removed comments (a bare "[removed]" block) are now recognised as removed. Communities a visitor never sees on your profile are treated as hidden by your profile settings, not removed. A removal recorded by the archive no longer wins over a current signed-out "visible".
- **Removed, then deleted by you:** with the archive on, items you deleted after a moderator, Reddit or AutoModerator removal are listed from Arctic Shift; self-deleted items are not.
- **Removed tab:** your own profile's tab bar gets Removed after Downvoted, replacing the Feed options → Activity → Removed row.
- **Clearer view:** counts follow the selected tab and filters; the Subreddit menu offers only communities with removals; the notice is one short line with the reasons in its tooltip.
- **Version:** minor increment for the comparison, removed-then-deleted items and the profile tab; no new permissions or storage changes. Only Reddit's website pages and native fragments plus Arctic Shift are used; no Reddit .json, /api/info or OAuth endpoints.
- **Validation:** all 1,596 tests pass; 48 JavaScript files parse; ZIP integrity passes; all 62 shipped assets match source, archive and the stable unpacked folder. SHA-256 `53bccb8dd33e995a340811f66785c5da1bf6db6e41e10fa369a3dae53b8b03f2`.
- **Verification:** live, read-only on the user's account: 32 removals found (previously 0–1), about 80% of items confirmed in bulk; the restored GTA6 post is visible to a signed-out direct check. The tab's rendered size and the paced, uncapped checks were not re-checked live after the final changes.

# 0.37.2 preview

- **Removed from your profile:** Feed options → Activity → Removed is now available on your own Overview, Posts and Comments tabs. It opens the existing verified-removal view with All, Posts or Comments selected to match. Moderator, AutoModerator and Reddit/filter removals are included; self-deleted items are excluded.
- **Account and scope:** the entry requires current native account ownership and rechecks it when activated. Late identity and replaced menus reconcile without duplicates. Opening the menu starts no scan. Scoped list navigation also retains the selected content type when submitting a search or switching lists.
- **Version:** patch increment to expose the existing removal feature on the expected profile tabs and retain scope; no new detector, permissions or storage changes.
- **Validation:** all 1,583 tests pass; 48 JavaScript files parse; ZIP integrity passes; all 62 shipped assets match source, archive and the stable unpacked folder. SHA-256 `80ae6b798c1a51bafcb1f33ac43f301fae46486f5921ca9577d99cf8b6d03a0a`.
- **Verification limits:** synthetic tests cover menu visibility, ownership changes, stale activation, native host replacement, keyboard activation and scoped navigation, alongside the existing removal classifier. No live CDP or preview browser was used for this addition; final installed review is left to the user. Existing signed-out transport and archive limits still apply.

# 0.37.1 preview

- **Signed-out removal checks:** monitoring and the Removed view reuse the independent browser session already used by unsigned profile search. Exact native comment/post fragments establish visibility without new legacy JSON/API calls, permissions or an authenticated fallback. Missing search results never establish removal.
- **Evidence and interface:** unreadable, gated or blocked responses remain unchecked without an inline “Couldn’t verify” badge on every item. The popup and Removed summary report readable/unchecked coverage. Fresh public visibility supersedes stale archive-only evidence; a readable direct link alone does not erase an explicit community removal. AutoModerator and archive timing attribution remain distinct.
- **Reuse and lifecycle:** successful proofs cache for ten minutes, unavailable proofs for one minute. Account, body/metadata and route guards prevent stale results; new cards resume after active checks. Item-specific refusals preserve the healthy search session, and shared rate limits remain respected. Cached metadata-only records are rechecked without generating upgrade-related approval alerts. No credentials or item bodies are persisted.
- **Version:** patch increment for the public-visibility correction; no storage migration.
- **Validation:** all 1,578 tests pass; 48 JavaScript files parse; ZIP integrity passes; all 62 shipped assets match source, archive and the stable unpacked folder. SHA-256 `4339a2e35541e560ef9c099a8a6b265fc9833a51e51a454813fe22300aca6e92`.
- **Live evidence and limits:** the existing signed-out transport returned HTTP 200 with exact native comment and post fragments while the parent stayed signed in. Installed end-to-end verification of 0.37.1 is left to the user, who declined the final CDP check. Known removals, AutoModerator transitions and cancellation are covered by synthetic tests; no live writes were performed. Account-wide visibility, complete history and closed-tab monitoring are not claimed. Native fragment routes are Reddit implementation details and can change.

# 0.37.0 preview

- **Your removed content:** opt-in badges on your own native posts and comments, with evidence tooltips. Native automatic-removal evidence and likely archive-based automatic removals are distinguished from moderator, Reddit/filter and unknown causes. Author-visible text alone never proves public visibility.
- **Native-first discovery:** the Removed view uses native account identity, overview HTML and validated continuations instead of `/api/me.json` and `overview.json`. New monitoring makes no legacy Reddit API requests; other features retain the dependencies documented in the access audit.
- **Recent changes:** account-scoped metadata and change history in the popup, with an optional toolbar count. Initial observations form a baseline; failures, stale reports and duplicate hosts cannot create approvals or duplicate alerts. Clear affects only the current account.
- **Efficiency and privacy:** checks reuse visible native markup and ten-minute verdicts, with optional archive reads batched through the existing bounded transport. Account changes invalidate pending work; hidden tabs pause enrichment; disabling monitoring disconnects observers. Stored data is capped at 5,000 metadata records and 50 changes per account, without item bodies or credentials. No new permissions.
- **Limits:** monitoring observes loaded native cards while browsing, with no independent crawler, closed-tab checks, system notifications or guaranteed public-view/account verification. Archive snapshots can show historical removals but cannot prove current public visibility. Unknown visibility stays unchecked. Native Removed discovery stops at a local 1,000-item safety budget and reports incomplete coverage.
- **Version:** minor increment for the new opt-in monitoring, change history and toolbar controls. Existing chat storage is unchanged.
- **Validation:** all 1,556 tests pass; 48 JavaScript files parse; ZIP integrity passes; all 62 shipped assets match source, archive and the stable unpacked folder. SHA-256 `874bec4a8d5bfb2f480b109200a3275f5671543d1278e346bf3490c1672abbb3`.
- **Live verification:** installed 0.37.0 native-profile sample returned HTTP 200 with 8 readable items and no skipped records. Three visible own-item badges matched native metadata at 12 px / 16 px, with no overflow at 1280 px or 380 px and no monitoring-script errors. Preferences were unchanged; the temporary tab, relay and tokens were cleaned up. Actual removed/AutoModerator transitions, notifications, profile-post/action-row compatibility and account switches are covered by synthetic tests, not live writes. Closed-tab checks and complete public visibility are not claimed.

# 0.36.0 preview

- **Raffle menu item:** the original wording ("View raffle results / Drawn on Reddit Raffler · verified" or "Run a raffle") with Reddit's shimmer skeleton over both lines until the status is known, so it no longer flashes the wrong label or changes height. The status is fetched as ⋯ is hovered or focused, so it is usually ready before the menu opens.
- **Raffle rules:** the post moves into a compact header above an 18/24 title; rules have outline section symbols; Comment must include matches the redaction fields; account requirements are always shown; the dialog opens at the top and scrolls instead of clipping. The public and private cards are the same height with one short line each, and Reddit Raffler's status is one line beneath them.
- **Exclude users:** a compact menu of the post's commenters (search, avatars, comment counts, exact usernames), built like the redaction community menu. Commenters already on the page appear at once with their pictures; other pictures load only for rows scrolled into view; the rest come from comments already read or one thread read that a later private draw reuses.
- **Winners:** public and private results share one compact layout with each winner's account age, comment karma and post karma (from Reddit Raffler, or one account read per winner). Accounts under 30 days are flagged, and copied results include the facts. Public rows fill in place as comments arrive. The winners screen has a trophy header, medal ranks, larger names, fact chips and full-contrast comments; View proof uses Reddit Raffler's own logo mark with even padding. Both dialogs share the redaction hover, pressed and focus states, and Reddit's edge fade that blurred the last rows (winners, Download a copy) is off. The redaction spinner is centred.
- **Redaction:** the confirmation step's action uses the same styled menu as step 1; the header shows the step with a progress bar; both dialogs have tighter spacing.
- **Popup:** three tabs instead of one page of switches. Home has a short Redaction card with a Start redaction button, a Raffles card that explains the ⋯ menu entry and can turn raffles on, and a features-on summary with Manage. Settings groups the switches into Browsing, Tools and Arctic Shift archive with live counts. Data holds the saved chat history and search tips. Every tab has the same measured height (Home and Data fill it without empty space); Settings scrolls inside it with an edge fade instead of a scrollbar, so the popup never resizes. The last tab is remembered; touch screens get a fluid width and 44 px targets.
- **Redaction entry:** Start redaction opens the dialog on the current Reddit tab by message instead of changing the tab's address, which made Reddit redraw parts of the page such as the right sidebar. The address route remains only for a tab whose scripts aren't connected.
- **Comment search rows:** clicking a comment's text opens the comment again (the text block sat above its link), and the fade over a comment shows only when it is actually cut off, in profile search and archived community search.
- **Deleted accounts:** comments and posts whose account was deleted (text kept, author shown as [deleted]) now get their author back from Arctic Shift, in the same batched request; their text is never touched and no deletion cue is added.
- **Left navigation on deleted profiles and communities:** the page keeps your collapsed or expanded navigation from the start and shows skeleton rows while Reddit's navigation loads, instead of a blank column that later collapses.
- **Raffle comment text:** public results show each winner's comment again. Reddit now refuses the batched comment lookup (/api/info.json, HTTP 403), so comments are read from their permalinks, one small request per winner. Account facts are compact chips on the name line (for example 7mo, 1.2K), and Message winners has a chat icon.
- **Suspended accounts:** in Reddit's user hover card, a suspended account's name and picture now link to its profile like a live account's.
- **Dialogs on phones:** two footer buttons share one line, and scrolling past a dialog's end no longer scrolls the page.
- **Header search chips:** multiple profile and filter chips compact to the available width, keeping the search text usable instead of squeezing it out of the header.
- **Calendar:** quick ranges are one sideways strip without a scrollbar (wheel, arrow keys, edge fades, position kept), the popover is smaller, range days are separate faded boxes, and the range previews as you hover its end.
- **Validation:** all 1,512 tests pass; 44 JavaScript files parse; ZIP integrity passes; all 58 shipped assets match source, archive and the stable unpacked folder. SHA-256 `ed4cbc9144c5c4e533a729dc79985b1e84656f949c473f9f2c0693a5f7952f23`.
- **Version:** minor increment for exclude-user suggestions, winner account facts and the reorganised popup; no storage migration.
- **Verification limits:** synthetic unit tests only, as requested: no screenshots, live raffles, messages or redaction runs. Reload the extension and refresh Reddit to see the new UI.

# 0.35.2 preview

- **Redaction confirmation actions:** the final step can switch between Overwrite text, Delete, and Overwrite, then delete without going back. Overwrite-only drops selected items without editable text; delete keeps the reviewed selection and hides the message editor. The typed phrase, count, summary and message edits follow the chosen action.
- **Existing public raffles:** a post that already has a public raffle stays on the rules screen instead of loading its results. The main action is View public results and loads winners only when clicked. If the raffle is unverified and the signed-in Reddit user is the post's author, the dialog offers Raffler sign-in as that author and then Run it yourself; Raffler may still refuse because a post allows one official raffle.
- **Verification limits:** synthetic tests cover the changed flows. No live redaction or raffle creation was performed; reload the extension and refresh Reddit to see the updated UI.
- **Version:** patch increment for the confirmation action switch and on-demand public results; no storage migration.

# 0.35.1 preview

- **Editable confirmation message:** the final step now contains a real replacement-message textbox. Edits persist when going back and update the message used by the run, while preserving item selection and clearing the typed confirmation. Empty or oversized messages block execution; the editor locks during writes. Delete-only continues to omit the message.
- **Review sections:** Posts and Comments have separate labelled lists and selected counts. Global selection still spans both, each list loads more on scroll, and rows remain attached. Every row uses the shared community icon with lazy loading and cached-image/fallback behavior. Observer cleanup prevents stale reviews from rendering into later ones.
- **Deferred private raffle scan:** opening the dialog, selecting a mode or editing rules does not scan entrants. Draw privately begins comment retrieval and qualification. An unavailable winner count shows the available range on the rules screen instead of producing a partial draw. Loaded comments and successful account facts are reused; failed account lookups can retry. Incomplete comment reads still require acknowledgement. Public results enrich only known winners’ comments and never scan the entrant pool.
- **Version:** patch increment for editable confirmation and unnecessary pre-draw scans, with review presentation refinements; no storage migration.
- **Verification limits:** synthetic tests cover the changed flows. No live redaction, raffle creation or messages were performed. Updated installed UI review awaits the user’s reload; no constructed preview was used.

# 0.35.0 preview

- **Redaction actions:** choose Overwrite text, Delete, or Overwrite, then delete. Overwrite-only excludes items without editable text and never deletes; delete-only never overwrites. Review, typed confirmation, time estimates and results reflect the selected action. The replacement message is editable and now defaults to “This comment has been redacted by Reddit Tweaks.” It is hidden for delete-only without losing edits.
- **Review:** Read full text expands the existing excerpt in place, with Read less to collapse it. More rows appear as the list scrolls, without a Show next button. Offscreen selections are retained and published rows remain attached.
- **Community suggestions:** reuse authored native-profile activity, existing profile counts and optional Arctic Shift subreddit aggregates. Debounced native Reddit community search supplements those suggestions while typing; exact names remain available. Stale responses are ignored, Clear restores activity suggestions, and include/exclude selections remain independent. Native caches are bounded, account-scoped and memory-only; archive requests obey the existing opt-in.
- **Run recovery:** refresh native profile data on a subsequent scan after a write. Closing a run stops subsequent steps after its current request on browsers without AbortSignal.any.
- **Validation:** all 1,460 tests pass; 44 JavaScript files parse; ZIP integrity passes; all 58 shipped assets match source, archive and the stable unpacked folder.
- **Version:** minor increment for selectable redaction actions and community suggestions; no storage migration.
- **Live evidence and limits:** a read-only live Reddit check verified native typeahead returning HTTP 200 with community matches, using recentSearchesCount=0. No redaction, dry run or account write was performed. Updated installed UI review awaits the user’s reload; no constructed preview was used.

# 0.34.2 preview

- **Profile-post discovery:** support own-profile post links (`/user/<you>/comments/…`) alongside community links. This fixes “A native profile item is incomplete” when the Overview feed contains pinned profile posts. Unreadable individual cards are excluded from the write allow-list and counted as incomplete; they no longer discard valid matches from the same page.
- **Compact filters:** reduce community popovers to 256px wide with compact 40px rows and a 160px scrolling list, and remove the oversized help footer. Reset Reddit’s inherited 16px/8px input and textarea margins, shorten labels, and explicitly fill text-field rows so controls align without an empty column. Empty status text no longer reserves space.
- **Votes:** use votes in the filter and item rows. “Minimum votes to keep” protects items at or above the entered value; its example is concise and occupies a full row.
- **Validation:** all 1,450 tests pass; 44 JavaScript files parse; ZIP integrity passes; all 58 shipped assets match source, archive and the stable unpacked folder.
- **Version:** patch increment for the native profile-post parsing failure; no storage migration.
- **Live evidence and limits:** read-only live inspection identified pinned own-profile posts as the failure, and measured the inherited input/textarea margins and 320px community menu. No live discovery run, redaction or other account write was performed. Updated installed UI review awaits the user’s extension reload; no constructed preview was used.

# 0.34.1 preview

- **Redaction controls:** reuse the existing searchable community selector for include/exclude filters, native-style icon menu rows for content type and the shared calendar. Content type, date and community buttons now match the other controls’ 40px height. Only one popover opens at a time; menus support keyboard navigation, Escape, focus restoration and outside dismissal. The calendar opens in the modal’s top layer without expanding the form. The score filter now explains that entering 10 protects items with at least 10 net Reddit points; blank ignores score.
- **Recent-range discovery:** read the signed-in native profile (reuse the loaded own-profile page when suitable, otherwise read profile HTML), then follow Reddit’s actual continuation. Date ranges only scan the relevant newest-first feed and stop when the start boundary is passed. They never run top/controversial scans. Older pinned items do not prematurely stop discovery. No navigation or background scrolling.
- **Partial failures:** retain found items when a later page or deeper source fails, including legacy HTTP 404 responses; review and confirmation explicitly identify incomplete discovery. Preserve long text so keep-word filters also protect words beyond the previous 4,000-character truncation.
- **Validation:** all 1,448 tests pass, all 44 JavaScript files parse, ZIP integrity passes, and all 58 shipped assets match source, archive and stable unpacked folder.
- **Version:** patch increment for discovery reliability and the existing controls’ consistency; no storage migration.
- **Live evidence and limits:** a read-only check on live Reddit confirmed native Comments metadata and an HTTP 200 continuation containing 25 readable comments. No live redaction, dry run or other write was performed. Updated installed UI review remains with the user after reloading the unpacked extension; no constructed preview was used.

# 0.34.0 preview

- **Redaction review:** a dedicated popup section opens on the active Reddit page (own-profile fallback outside Reddit). Grouped filters use the existing calendar. Finding switches to a scrollable selection screen with all matches accessible, select/deselect all, full text and Reddit links. A separate confirmation screen shows the selected counts and replacement text, then requires `delete N`. Back preserves the selection; changing filters invalidates it. The default text is “This comment has been redacted or anonymized by Reddit Tweaks.”
- **Discovery:** capture the chosen rules for each scan, skip irrelevant content lists, stop newest-first pagination after the start date, and report reached page limits. Score-sorted lists continue because their dates are not chronological. Fresh discovery does not reuse stale matches from prior runs.
- **Raffles:** coalesce identical in-flight reads, retry transient network/502/503/504 failures once within the original deadline, and stop caching failed menu checks. Public creation is never retried automatically. Guests get a “Sign in with Reddit” link from Raffler’s form, with its authorize endpoint and callback validated. Returning checks session status without drawing. Winner account lookups prefer native comment icons or safe Snoovatar headshots.
- **Profile Comments:** hide the standalone refresh action and collapse its empty toolbar while native Feed options loads or is replaced; retain the action behind the menu.
- **Validation:** all 1,439 tests pass; all 44 JavaScript files pass syntax checks; all 58 shipped assets match between source, ZIP and the stable unpacked folder; ZIP integrity passes.
- **Version:** minor increment for the new interactive redaction selection and confirmation workflow; no storage migration.
- **Verification limits:** the reported Raffler outage did not reproduce during read-only live baseline checks; both existing results and a guest dialog loaded. No public raffle, sign-in, messages or live redaction was performed. Installed post-change UI review awaits the user reloading the unpacked extension. Synthetic regression checks cover the changed flows; no constructed preview was used.

# 0.33.0 preview

- **Removed list** (docs/own-removal-detection-spec.md, U2): "Removed" in your own profile's List menu, next to Saved and History, shows your posts and comments others can't see, each with one state pill ("Removed by moderators", "Removed automatically", "Removed by Reddit"…) whose tooltip gives the evidence. Posts are classified from the removal category Reddit gives the author. Comments count as removed only when the Arctic Shift archive captured the removal ("Use the archive" on), because Reddit blocks every logged-out check from the extension. The summary says how many comments couldn't be checked, and that the account-level check is unavailable.
- **Not yet approved filter** (docs/unmoderated-filter-spec.md): in communities you moderate, a "Not yet approved" button next to the feed's sort control swaps the feed for the community's Unmoderated queue in Reddit's search rows, with "Show more". Read-only; off restores Reddit's feed. Popup setting, on by default.
- **Raffles** (docs/raffle-spec.md): "Run a raffle" in every post's ⋯ menu (Reddit's own action slot, measured identical to its items, on every route to a post). Choose a **Public draw** on Reddit Raffler (redditraffler.com) or a **Private draw**. A public draw is created through the endpoints Raffler's own site uses, using your Raffler sign-in if you have one (verified when you're the post's author) or as a guest, and gives a permanent proof page; it needs a second click, and a post that already has one opens on its results. Our results screen shows the winners as Reddit-style comment rows (picture, name, time, comment text) with View proof and Copy; a post's ⋯ menu shows "View raffle results" when it already has a public raffle. A private draw reads every comment the way Reddit's client does, draws with crypto-random fairness, and can be redone (with confirmation). **Message winners** sends a congratulation through Reddit chat (separate chats or one group chat) after a confirmation; winners can be left out and added back with a click. On phones the dialog is Reddit's bottom sheet. The dialog was revised after two passes of an independent review. Popup setting, on by default.
- **Redaction** (docs/redaction-spec.md): "Redact my posts and comments…" in the popup opens a dialog on Reddit. Filter by type, age, dates, communities, score, text and items to keep. A required dry run previews the exact set (with "Download a copy"); typing `delete N` runs it, oldest first: overwrite the text, then delete, one write per 1.1 s, with 429 back-off and a stop after three failures. The page bridge keeps Reddit's modhash in the page world and writes only to items it read from your own lists on that page.
- New host permission `https://www.redditraffler.com/*` (public raffles) and a header rule that gives Raffler's create request the same-site `Referer` its CSRF check needs; Raffler receives the post ID, the rules and ignored usernames. No storage migration. Two new settings (`modUnapprovedFilter`, `raffles`) default on.
- Profile comment search no longer reports "Reddit's comment format changed" when Reddit links authors with absolute profile URLs; a page of only other people's comments now says so instead.

Version choice: MINOR to 0.33.0 for four new user-facing features.

Validation: all 1,427 tests pass (new: removed-list, unapproved-filter, raffle, redaction). ZIP integrity and source/ZIP/stable-folder byte equality pass for all 58 shipped files; all 43 JavaScript files parse. SHA-256: `5f3ff6f2d9cb2284044adaad8e7911181c1583e6cd8384931756ddcef1a52217`.
Live (signed-in Chrome, read-only): Reddit's post ⋯ menu, modal card, comment row and comment-loading requests were measured before building. On the packaged build, a raffle opened from a feed card on an 8,269-comment thread read all 1,174 top-level comments through Reddit's own chain in 41 s and drew three winners with profile pictures and comment links; the phone bottom sheet was checked at 380 px. The raffle item was present on every route checked (direct load, feed, search, home and profile to post, Back, Forward, comment permalink, cold worker). Public draws were never created live (each post can have only one, and it's public); the Raffler endpoints were read from its source and checked read-only on the live site, and the dialog was reviewed on a synthetic fixture (demo/raffle/). Messaging was opened but **never sent live** (it sends from your account); its Reddit chat calls were read from Reddit's chat bundle and its preloaded client checked read-only. The Removed list, the moderator filter and the redaction dry run were not run live for this build.

Limitations: the Removed list has no in-place badges, notifications or account check (Reddit blocks the logged-out views they need). The moderator filter lists posts only and has no approve/remove buttons. Raffles on very large threads take a while (~90 top-level comments per request). **Redaction was not run against a real account** (by the user's instruction): whether www.reddit.com still accepts `/api/editusertext` and `/api/del` with cookie plus modhash is unverified; follow the test steps in docs/redaction-spec.md §8, starting with a dry run.

# 0.32.2 preview

- Refused logged-out profile searches retry in an invisible credentialless Reddit frame. Reddit's own browser scripts can initialize its anonymous session, and native search runs inside that session. No tab, window, focus change or visible scrolling is introduced.
- The frame must show Reddit's Log In control without signed-in account markers before and after reading. Owner cookies/tokens are never copied. Existing author-scoped parsers and public pagination remain in use; incomplete coverage stays explicit.
- Limit the fallback to explicit HTTP 403 responses, one active read and one queued read per page, a three-megabyte response bound, cancellation and failure cooldowns. HTTP 429 never triggers alternate transport. Remove idle frames after 60 seconds and keep chat capture out of anonymous frames.
- Let Reddit's own automatic verification form submit normally, and send a real origin-only referrer on anonymous homepage initialization. This fixes the fresh-session JS-only landing page seen in the initial local build.
- Reuse browser-managed anonymous cookies and healthy frame state across requests, pagination, refresh, rate limits and transient failures. Cookies never leave their anonymous browser partition, and no result cache is added. Explicit activity refresh may retry a blocked check, while numeric/date Retry-After deadlines remain enforced.
- Wait for the document and Reddit's native app to finish initializing before the first public read. Once that session succeeds, use it directly for later reads instead of repeating the refused cookie-free request.
- No new permissions or storage migration. Reddit's framing headers rule out an extension-origin offscreen document; the frame lives invisibly within the existing Reddit page and respects those headers.

Version choice: PATCH to 0.32.2 for recovering the existing signed-out search supplement without changing its interface.

Validation: all 1,358 tests pass. On live Reddit in Brave, the helper returned ten public comment results and five continuation results while the parent remained signed in. Its URL, focus, scroll position and page width stayed unchanged; automatic idle removal was observed. Fresh-document checks confirmed the origin-only referrer and successful native automatic verification form submission. The user confirmed the installed readiness fix was working. Temporary probes were removed after testing. No preview website was used. The final direct-reuse optimization has regression coverage; the Reddit tabs were closed before an additional automatic-load repeat.

Package validation: all 38 JavaScript files parse; ZIP integrity and source/ZIP/stable-folder equality pass for all 51 shipped files. SHA-256: `2bc8a6354b81b422e48b9828185b3bcdb4fde11f7b2d432bfbc5494177b3a658`.

Limitations: canonical `www.reddit.com` profile search only. Reddit can still require an interactive CAPTCHA or refuse access; those failures remain incomplete checks. Credentialless frames isolate cookie/storage state but share their Reddit parent's origin. Cookies are reused for the lifetime of the top document; a full page reload creates a new anonymous partition. This adds no individual-comment removal verification. Reload the unpacked extension to activate the final bundle.

# 0.32.1 preview

- Logged-out native searches now send `Referer: https://www.google.com/` through a declarative request-header rule. Only credential-free extension searches carry the rule's marker, including public comment continuations and blocked-profile post searches. Signed-in searches, page navigation and other requests are excluded.
- Added `declarativeNetRequestWithHostAccess` and explicit HTTPS Reddit host access for the header rule. The rule does not make requests to Google and credentials remain omitted from logged-out searches.
- Packaging now includes manifest-declared request rules in the stable unpacked testing folder.

Version choice: PATCH to 0.32.1 for a targeted logged-out search transport correction. No storage schema migration.

Validation: all 1,332 tests pass, including header-rule scope, credential-free pagination, signed-in exclusions and ruleset packaging. ZIP integrity and exact source/ZIP/stable-folder byte equality pass for all 50 files. Archive SHA-256: `4c6ed2b92d13c74281c1aa8cc965e783dcd0ccf919d6fa5cbd2179c9592e1a39`.

Limitation: this changes request headers; Reddit can still deny logged-out search. Live Reddit acceptance has not been verified for this build. Reload the unpacked extension and refresh Reddit tabs; the browser may ask to approve the added Reddit host access.

# 0.32.0 preview

- **Search tips** open with **Ctrl+/** (⌘/ on Mac) in any search box that uses the query language, as a compact card limited to that box's fields. The buttons and menu entries are gone.
- Header search with many filters stays usable: when the filter pills would crowd the field, they fold into one **N filters** pill. Its card lists each filter as a removable pill, with Clear all.
- Search Comments on archived posts is rebuilt from Reddit's own comment search, using measured sizes and Reddit's search box. The button opens the box with Cancel. Enter searches, the result cards and "All Comments" match Reddit's, and no matches shows Reddit's no-results box. The toolbar now appears with the post instead of before it. Opening a result shows that comment's thread first, highlighted as Reddit does, with the toolbar just under the header.
- Archived comments use Reddit's comment geometry: a full-width column, a 36 px author row and Reddit's body spacing. Archived post pages use Reddit's post-page box.
- Archived video and GIF posts keep the preview inside the media box while loading. When the archive can't play the file, they say the original video isn't available, without a play button.
- Chat: choosing a conversation no longer collapses the opened list search. Applied filter chips in chat use the same Reddit pill as the header and feed filters.
- Profile and list searches no longer rebuild or reload their list about a second after opening.

Version choice: MINOR to 0.32.0 for the Ctrl+/ tips and the folded header filters, bundled with fixes. No new permissions or storage schema migration.

Validation: all 1,320 automated tests pass; ZIP integrity (sha256 cb1cd2a8…532eb0) and source/stable-folder byte equality checked.
Live comparison on Reddit (signed-in Chrome, read-only) covered:
- Search Comments sizes, states and result cards against a live post (sort 109x32, button 178x40, box 542 + Cancel 70, card 620x193).
- The permalink highlight and scroll position.
- Load order: the toolbar now appears with the post.
- The folded "3 filters" pill and its card.

The chat changes were checked in the chat demo in a headless browser, not on live Reddit. Archive pages use Reddit's older colour palette there, so field and card greys differ slightly from live communities; sizes match. The archive header search bar comparison (spec I4) is not done.

# 0.31.0 preview

- Your own profile's search has a **List** filter: All activity, Saved, History, Hidden, Upvoted or Downvoted, keeping your query and filters. List searches can switch lists the same way.
- One query language in every search box: words, "phrases", OR, -word/NOT, ( ) and fields such as u/, r/, title:, site:. Search Comments on archived posts now supports it too.
- **Search tips** in each search box (Feed options and the filter row on profile and list search, a button beside archive searches) list the syntax with examples that fill the box. docs/search-syntax.md documents it all, and the popup points to it.
- Floating chat: switching conversations no longer makes the search bar collapse and re-expand.
- List and filter pills no longer blink on a direct visit to a list or filtered search.

Version choice: MINOR to 0.31.0 for the List filter and Search tips, bundled with fixes. No new permissions or storage schema migration.

Validation: all 1,314 automated tests pass; ZIP integrity and source/stable-folder byte equality checked. The chat fix was reproduced and checked in the chat demo in a headless browser. Not checked on live Reddit (no browser access to Reddit in this session): the pill blink fix, the List filter and the Search tips placement. Archive search bar and comment search parity with live communities (spec items I4 and I5) are not done yet.

# 0.30.3 preview

- Opening a result from a profile or list search keeps the results and the Saved/History pill on screen until Reddit shows the post, instead of a blank page; going Back shows them again at once, pill included.
- A fresh list search no longer restarts from the first page when Reddit swaps its page during start-up.
- The Subreddit menu's community list uses compact rows on desktop.

Version choice: PATCH to 0.30.3 for display and performance fixes. No new permissions or storage schema migration.

Validation: all 1,308 automated tests pass; ZIP integrity and source/stable-folder byte equality checked. Live Chrome check (read-only) on a Saved search: results and pill stayed until the post appeared (0.8 s), came back together 0.13 s after Back, and the Subreddit menu rows measured 36 px.

# 0.30.2 preview

- Going Back to your own Saved, History, Hidden, Upvoted or Downvoted search puts the loaded results back at once instead of reading the whole list again; a list that was still loading continues where it stopped.

Version choice: PATCH to 0.30.2 for a performance fix. No new permissions or storage schema migration.

Validation: all 1,307 automated tests pass; ZIP integrity and source/stable-folder byte equality checked. Live Chrome check (read-only) on a Saved search for "termux": a result opened and Back pressed; all six results were back within 0.15 s with no list request (only the signed-in account check).

# 0.30.1 preview

- Going Back to a profile or list search from one of its results puts the loaded results back at once, at the same scroll position, instead of searching Reddit and the archive again from the first page. The last three searches are kept for 15 minutes.

Version choice: PATCH to 0.30.1 for a performance fix. No new permissions or storage schema migration.

Validation: all 1,305 automated tests pass; ZIP integrity and source/stable-folder byte equality checked. Live Chrome check (read-only): a filtered search scrolled through three pages, a result opened and Back pressed; results were back within 0.15 s, the scroll position by 0.4 s, with no new Reddit search or archive requests.

# 0.30.0 preview

- The popup groups its options: **On Reddit** (profile search and clean shared links, using Reddit only) and **Arctic Shift archive** (optional, third party: one switch, with restore and banned/private communities under it). Options that need a switch that's off fold away, and a dimmed option names the switch it needs.
- Your Saved, History, Hidden, Upvoted and Downvoted searches keep their list pill (now Reddit's own scope pill style with the list's icon) after searching, instead of losing it when Reddit re-renders the header.
- Filter pills (date, post type, subreddit, Oldest first) use Reddit's own search scope pill everywhere. On desktop profile search they sit in the header search next to u/name, several communities share one pill, and a new query typed there keeps them.
- Profile search and Saved/History/Hidden/Upvoted/Downvoted searches show results as Reddit's own search rows (community · time, title, votes · comments, thumbnail; comments in Reddit's grey comment box with Go To Thread), with Reddit's "Show results from all of Reddit" line, instead of full feed cards with an "Open post on Reddit" link. Reddit's own results no longer load a full card each; archive results still check their current Reddit status in the background.
- Opening a result from a filtered or list search no longer flashes Reddit's unfiltered results while the post loads.
- Community icons in the Subreddit menu appear sooner: icons that came with search results are used at once, more load in parallel, and found icons are remembered for the browser session.

Version choice: MINOR to 0.30.0 for Reddit-style search rows on profile and list search, filter pills in the header search, and the regrouped popup, bundled with fixes (pill creation error on community pages, flashes of Reddit's unfiltered results, faster community icons). Setting keys and their meaning are unchanged. No new permissions or storage schema migration.

Validation: all 1,304 automated tests pass; ZIP integrity and source/stable-folder byte equality checked. Live Chrome checks (read-only) compare profile search posts and comments with Reddit's own profile search, cover a Saved search and opening one of its results with no visible Reddit results during the transition, header pills on a profile search, and Subreddit menu icon timing. The popup was checked in a headless browser in light and dark.

# 0.29.0 preview

- Profile search filters (Date, Post type, Subreddit and the rest) are each Reddit's own dropdown style, with clear labels, and close on a second click. Old is added to Reddit's own sort menu instead of a duplicate Sort button. On mobile they open as Reddit's bottom sheets.
- Profile search loads with Reddit's own skeleton and no longer shows "Reddit's post search format changed" on direct visits; Reddit's newer result cards are read.
- The Subreddit menu shows community icons, keeps every community listed after a pick, and supports picking several.
- Changing a filter reloads results once, not twice: Reddit treated our unchanged-address write as a page reload.
- Clicking a result card's body opens the post. Filter buttons are spaced like Reddit's, and filter pills keep their size on direct visits instead of starting large.
- NSFW and spoiler text in profile cards and on archived post pages is blurred behind Reddit's View NSFW content / View spoiler pill instead of a "NSFW or spoiler snapshot" note.
- Banned and deleted profiles show Reddit's grey suspended snoo in the header; their posts, and suspended or deleted authors in archived threads, use Reddit's small snoo-back avatar.

Version choice: MINOR to 0.29.0 for the Reddit-style filter dropdowns, mobile bottom sheets and search skeleton, bundled with profile search fixes. No new permissions or storage schema migration.

Validation: all 1,298 automated tests pass; ZIP integrity and source/stable-folder byte equality checked. Live Chrome checks (read-only) cover one feed rebuild and no Reddit page refetch per subreddit pick (first and second pick), 26px pills from the first frame on a direct visit with three subreddits, and on a deleted profile the grey snoo header (64px, contained) with no NSFW snapshot note.

# 0.28.1 preview

- Fast scrolling into an archive feed's loader no longer jumps past newly loaded posts.
- On profile feeds, waiting at the loading halo no longer pulls the page back up after a moment; the halo keeps its space while paused.
- Filter chips load each community's own icon again (fetched when not cached), in a fixed slot that doesn't shift the label.

Version choice: PATCH to 0.28.1 for scrolling and icon fixes. No new permissions or storage schema migration.

Validation: all 1,294 automated tests pass; ZIP integrity and source/stable-folder byte equality checked. These fixes were not checked live at the user's request.

# 0.28.0 preview

- Archived threads have Reddit's comment toolbar between the post and the comments: **Sort by** (Best, Top, New, Old over loaded archive comments) and **Search Comments** over loaded comments.
- Profile search shows the Feed options filters inline in Reddit's sort row, styled like Relevance / All time / Safe Search.
- The subreddit archive shows users' real profile pictures (the poster's on post pages) and Reddit's grey silhouette for deleted accounts, with square, centred avatars.
- Archived NSFW and spoiler posts look like Reddit's: the NSFW tag (Reddit's icon and colour) above the title, the flair pill below it, and media blurred on black under a scrim with a View NSFW content pill. A click anywhere on the blur reveals it instead of opening the post.
- Images pasted into archived text posts (preview.redd.it links) render inline, blurred when restricted, and reserve their size before loading.
- Archive scrolling stays steady while posts, comments, loaders and images load: positions are kept relative to the page, so the reader's own scrolling is never corrected. The feed position is restored after visiting a post (including after reloading it); reloading the feed itself starts fresh.
- Archive timeouts retry automatically before showing a compact Retry pill. Profile post and comment searches retry quick and temporary (HTTP 403/429) failures quietly; notes appear only for long waits or repeated failures.
- Following a link out of an archived community no longer flashes Reddit's banned notice. Posts opened from extension-drawn profile cards start at the top. Community icons in filter chips are centred, and stacked toolbar notices share one left edge.

Version choice: MINOR to 0.28.0 for the new comment toolbar, inline profile-search filters and real profile pictures, bundled with archive display, scrolling and retry fixes. No new permissions or storage schema migration.

Validation: all 1,294 automated tests pass. Live Chrome checks (read-only) cover the inline post image, NSFW tag, flair, blur and click-to-reveal on an archived post, and wheel scrolling through loads on two archived threads and a feed with no visible jumps. ZIP integrity and source/stable-folder byte equality pass for all 48 packaged files.

Limitations: the profile-card scroll fix and the quiet profile retries are covered by automated tests only. Reddit's own "error loading the next page" message on profile feeds was not reproduced and is unchanged. Comment sorting and search apply to loaded archive comments, not the full thread.

# 0.27.0 preview

- Added separate opt-ins for browsing unavailable communities and opening their archives automatically. Both require Arctic Shift and profile discovery; automatic mode holds the matching banned/private notice before paint. Disabling the preferences restores Reddit's notice. Existing users must enable the new community preference.
- Archive layouts initialize with Reddit's persisted collapsed/expanded navigation state. The native sidebar controller receives that state before connection, waits for its renderer during startup, and no longer remains hidden while loading.
- Loaded feed cards stay attached during scrolling rather than becoming empty placeholders. Comment updates preserve connected siblings, Reddit-assigned nested slots and collapsed state; later archive pages append without reshuffling comments already being read.
- Top-level comments continue on scroll with the Reddit halo instead of Load more comments/View more comments buttons. Reply controls use the circle-plus and small native-style spinner. Repeated cursors stop paging; empty advancing pages pause after three reads with an explicit Retry.
- Added **Clean shared links**, an independent opt-in for normal post/comment permalinks without sharing identifiers. Native clipboard/share feedback remains in place; opaque Reddit share paths use the clicked source permalink without resolver requests.
- Moved archive-thread attribution and read-only/partial-coverage information into the right sidebar. Archive comments are excluded from early restoration skeletons. Restored the halo component's native layout and added visible fallback artwork during component startup.

Version choice: MINOR to 0.27.0 for the new community archive and clean-share preferences, bundled with loading and continuity fixes. No new permissions or storage schema migration.

Validation: all 1,279 automated tests pass. Live Brave checks cover direct archive loading, collapsed navigation, feed/comment continuation, reverse scrolling, two reply expansions, sticky sidebar geometry, and canonical copied post/comment URLs. ZIP integrity and source/stable-folder byte equality pass for all 48 packaged files. See [validation details](docs/subreddit-archive-loading-validation.md).

Limitations: retaining revealed cards uses more page memory on very long feeds. Reply counts and ranking describe loaded archive records; archive exhaustion never proves complete history. Private-community handling remains covered by synthetic tests. Opaque share links without a matching active source are preserved rather than redirected to an invented target. A live archive timeout recovered through Retry; provider failures remain explicit.

# 0.26.0 preview

- Archived subreddit feeds use Reddit's own subreddit card: author avatar and name, archive badge and a disabled overflow menu, flair, and media by real post type (full-width images, galleries and videos; link thumbnails with a domain line; no borrowed previews on self posts). Votes are marked unavailable and deleted images show an "Image no longer available" notice.
- Archived post pages have a Back button, the community and author header, a read-only action row (score, comment count, Share copies the link) without duplicating Reddit's own, native comment avatars, and focused-comment links that scroll to the comment. Posts opened from the feed render immediately.
- Archived comments follow Reddit's comment view (approximated): best-first, 20 top-level comments then "View more comments", "N more replies" per comment, a seven-level depth limit, and Reddit's small loading icon. Thread restore no longer runs inside the archive, so no skeleton lines appear there.
- Feed loading uses Reddit's Snoo halo, reveals 25 posts at a time, drops stale results when filters change, shows explicit scanning and empty states, and unmounts far off-screen cards. Collapsed comments hide their replies.
- The masthead, notice button and sort, date and type controls match Reddit's sizes and icons; menus have no visible scrollbar and the custom date presets wrap. The right sidebar shows an archive card, coverage among loaded posts, most active posters and Reddit's footer links.
- Archive search: truthful sort label ("New" where the archive can't rank), a Media tile grid, relative times without author, native thumbnails, comment avatars, and continued scanning until about 25 results.
- Developer tooling: configurable relay port, headless fixture browser, probe tools, and the verify-loop and council skills.

Version choice: MINOR to 0.26.0 for new archive features (sidebar cards, Media tiles, paged loading) plus fixes. No new permissions or storage schema migration.

Limitations (not yet verified live): left-nav "Home" highlight removal, archive title colour token, search sort relabel inside Reddit's control, Media tile sizing, scroll stability while off-screen cards are swapped, comment thresholds approximate Reddit's "Best" view. The sidebar's content is still under discussion.

Validation:
- All 1258 tests pass.
- Package integrity and source/stable-folder byte equality verified.

# 0.25.0 preview

- Archived banned/private community post links open a thread reader with nested comments, focused-comment links, bounded pagination and explicit partial-coverage status.
- Community pages reuse Reddit's native left navigation. Snapshot card links remain usable while voting and other snapshot actions are blocked.
- Comment feeds and thread comments use page-level Arctic Shift attribution instead of repeated archive badges. Thread comments retain native author, avatar, body and action-row styling.
- Archive reader comments are excluded from live deletion detection.

Version choice: MINOR to 0.25.0 for archived community thread browsing. No new permissions or storage schema migration.

Validation:
- All 1216 tests pass, including scoped thread reads, focused comments, stalled pagination, native navigation, snapshot action guards and comment attribution.
- Package integrity and source/stable-folder/archive byte equality verified.

Limitations:
- This continuation has automated coverage only; the final interface and installed-extension clicks have not been rechecked live in Chrome.
- Archive coverage remains partial. Missing parent comments cannot be reconstructed, and voting/posting are unavailable in the reader.

# 0.24.0 preview

- Search: shared `AND`, `OR`, `NOT`, grouping, phrases and supported field queries across chat, profile and archived-community searches. Invalid queries explain the problem; archive pushdown uses supported fields and checks residual expressions locally. Profile and profile-search filters share outline icons.
- Your own profile: header search can search Saved, History, Hidden, Upvoted and Downvoted lists. Private list contents stay out of Arctic Shift requests. History is limited to Reddit's recent-view records; other lists retain Reddit's own limits.
- Archived communities: replace the duplicate search bar and feed tabs with Reddit's header search and native search-page controls. The feed uses community masthead geometry, an overlapping avatar, sidebar and sort/date/type dropdowns. One native `shreddit-feed-page-loading` community Snoo halo replaces grey skeleton cards in both feed and search.
- Banned-community search tabs left empty by Reddit are initialized through the native paging API and restored on exit. Comment results can include parent thread titles. Link-only cards display their destination domain instead of a missing-text warning; genuinely uncaptured removed text remains explicit.

Version choice: MINOR to 0.24.0 for the shared query language and own-list search features already integrated in this bundle. Archive presentation corrections are included in the same release. No new permissions or storage schema migration.

Validation:
- All 1207 tests pass, including native search restoration, query matching, paging, errors, opt-in title enrichment and both loading paths.
- Chrome remote debugging: compared the installed archive masthead against a normal subreddit; verified archived feed cards on r/greatawakening, one real native Snoo halo in a controlled pending state, and a 390px mobile layout without horizontal overflow.
- Live header search for `control` opened Reddit's scoped search page and returned archived post rows without a second search field. Native Comments navigation returned archived comments with parent titles. Verified visible Posts/Comments/Media tabs in the final 0.24.0 build.
- JavaScript syntax, archive integrity, and source/unpacked/archive byte equality verified.

Limitations:
- Archive coverage and metadata may be missing. Missing banner/avatar artwork uses a neutral banner and generic community icon; no original artwork is invented.
- The archive cannot rank by Reddit relevance. Relevance/Hot use newest first; Top and Most commented rank only loaded records. Keyword timeouts and locally filtered scans may return partial results; failures remain retryable.
- Private-community handling has synthetic coverage; this live pass used a banned community.
- This continuation's live validation focused on archived communities. Earlier own-list testing reported a status/result mismatch; that separate issue remains to be rechecked. Chat and own-list flows were not newly validated end to end here.

# 0.23.1 preview

- Profile search: clicking the native search field on a profile and pressing Enter with no text now opens that author's search results. Both the server-rendered input and Reddit's hydrated shadow-root textarea are supported. Nonempty queries, other fields, removed author scopes, composition and modified Enter retain Reddit's handling. The action requires public activity and archive discovery to be enabled.

Version choice: PATCH for a user-visible navigation bug fix. No new permissions or storage schema changes.

Validation:
- All 1067 tests pass, including empty Enter navigation, search-feed mounting and negative controls for both field structures.
- Reproduced before the fix in signed-in Chrome with the installed extension: empty Enter on u/spez left the profile URL unchanged.
- Reloaded the rebuilt extension and repeated the same real mouse/keyboard path: it opened `/user/spez/search/`, displayed native Posts/Comments/Media tabs and visible result cards (100 result nodes loaded).
- Direct signed-in fetch of `/user/spez/search/` with no query parameters returned HTTP 200, native search tabs and 4 native post units before extension processing.
- Package integrity and source/unpacked/archive byte equality verified.

Limitations:
- This fixes empty profile-search navigation. It does not fix the separately observed Reddit response-format error for nonempty post queries.
- Live validation used Chrome debugging; Brave was not separately tested.

# 0.23.0 preview

- Chat: deleted and banned accounts are now actually saved as such. Since the first release, `directory-model.js` was listed for both the page world and the extension world at the same injection time. Chrome injected it only into the page world, so every answer reached storage as "no answer" and the markers fell back to "Unavailable account". The classifier also starts as soon as Reddit's chat client attaches.
- Chat search: avatars that are already loaded appear immediately instead of starting as a letter and popping in.
- Profiles: comments their author deleted are marked "Deleted on Reddit" instead of "Arctic Shift snapshot · Current Reddit status unknown". Reddit's legacy info endpoint now refuses these checks (403), and Reddit answers a deleted comment exactly like one that never existed. Archive comments that Reddit still serves are marked available. Reddit's "New" sort no longer flashes on the Comments tab before Feed options replaces it.
- Profiles of unavailable accounts say plainly, in Reddit's own words, that the account was deleted or suspended, and show Reddit's own artwork (snoo-404 or the suspended snoo) instead of a default avatar.
- Post pages: a restored comment author opens Reddit's own profile card (karma, cake day, Follow, Start chat) like any other author. Restored authors with a custom avatar show it: the hover card offers only the full-body Snoovatar, and the extension now uses its published headshot. On a deleted comment's permalink, Reddit's "This comment no longer exists" toast says "Deleted comment retrieved from Arctic Shift" once the text is restored. Otherwise it plays unchanged.
- Docs: `docs/ghostddit-feature-gaps.md` lists 22 features from a live review of Ghostddit, with how we could build each.

Version choice: MINOR to 0.23.0 for the new profile card, account-state line and toast wording, plus PATCH-level fixes. No new permissions and no storage schema change.

Validation:
- All 918 tests pass.
- Checked live in Chrome:
  - Pulse8279 is saved and shown as deleted after a reload.
  - u/TheMLguy07's restored comments show the custom avatar and open Reddit's card.
  - The deleted comment on u/TheMLguy07's profile shows the trash icon.
  - The permalink toast shows the new wording.
  - The Comments-tab sort never becomes visible.
  - A deleted account's profile shows the new line and artwork.
  - Chat search avatars are complete when inserted.

Limitations:
- A comment removed by its author can't be told apart from one hidden because the subreddit was banned or made private; both show as deleted.
- The filter-pill × problem reported for chat search could not be reproduced. Sort, sender, typed-date and chat-list status pills all clear with a real mouse click.
- Result rows are still rebuilt twice as results refresh; their avatars no longer flash.

# 0.22.0 preview

- Chat: unavailable accounts are now told apart. Reddit's chat data only says "deleted" for both deleted and banned accounts; the extension asks Reddit's small public hover card (about 2-3 KB, works signed out) once per person who is actually on screen and has a known username, then remembers the answer. Deleted accounts show a trash icon, banned accounts a circle-slash, and ones not yet known the person-x icon, labelled "Deleted account", "Banned account" or "Unavailable account" (plus "Retained username"). Requests run one at a time, at least 2.5 s apart, pause on rate limits, and failures retry after about ten minutes without being saved.
- Chat: the marker now also appears in Reddit's own chat list (right side of the preview line) and inline next to the name in the room header, intro and message authors; in search results it always sits at the right edge, also on rows without a preview. Searching "banned" or "suspended" finds banned accounts.
- Phone layout: the chat search field is 40 px high, matching Reddit's mobile controls.
- Profiles: in compact view the status cue sits inline in the subreddit row instead of on its own line; the Comments tab shows the same Feed options button and grouped Sort / Activity menu as Overview and Posts.
- Archived-author avatars no longer use /user/<name>/about.json (unavailable signed out); they come from Reddit's hover card headshot.

Version choice: MINOR to 0.22.0 for the new deleted/banned distinction and the chat-list markers; no new permissions; the saved directory gains an accountStates map (older data stays readable).

Validation: all 911 tests pass; hover-card behaviour verified live for live, deleted and suspended accounts; chat markers verified live in Reddit's chat list, header and messages, and placement in the demo in full, floating and phone widths. Limitation: the end-to-end live check that a classification is saved and shown after reload, done after the fix in this release, is still pending (it was found and fixed from live evidence; the fix is covered by a regression test).

# 0.21.1 preview

- Calendar: compact again (264 px wide, 320 px tall for a five-week month; 240 px in floating chat), smaller than the pre-0.21 calendar, with Reddit's accents back: brand underline on the active On/Before/After/Between tab, today in the brand colour, brand selection and Apply. Days are rounded squares, presets stay on one row with short labels ("7 days"), and the status reads "Pick a day".
- Deleted chat accounts: names and avatars now also come from the deleted account's membership record in chats Reddit has already loaded, so they show in a browser where the extension never saw the person before. The "…" placeholder lasts at most 6 s instead of the whole chat-list load.

Version choice: PATCH to 0.21.1 for presentation and reliability corrections to 0.21.0.

Validation: all 890 tests pass. Live Chrome: calendar measured 264x320 in the room search, checked in light and dark with a selected range; the deleted account's chat shows the retained name everywhere (no "[deleted]" left on the page). Limitation: the new membership-record path was verified with tests and by confirming the record keeps the name in Chrome; it is not yet checked in the second browser.

# 0.21.0 preview

Work from the full review in docs/improvement-plan-2026-10.md (Phases 1, 2 and parts of 3, 4 and 6), done as five parallel workstreams.

- Chat search calendar redesigned: one header row (On/Before/After/Between, one preset row, month-year heading), 32 px circular days with a continuous range band, today ring and saved-messages dot together, fixed six-row height, 12-14 px text, visible focus on every control, proper dark mode, no clipping in floating chat, ARIA grid semantics and Shift+PageUp/Down for years. Global search no longer offers future days; the Quick ranges sub-view became preset chips.
- Deleted chat partners now show the username and avatar the extension saved while their account still existed, instead of "[deleted]" and the default avatar.
- Post pages: one malformed archived comment no longer stops restoration of the others; spoilers in restored comments stay hidden until revealed (and are keyboard-accessible); restored text survives Reddit re-rendering a comment; Reddit's own notices are never shown as "restored text"; pending placeholders give way after about 5 s; cues say "Removed on Reddit" and only say "by its author" when Reddit does; badges are keyboard-focusable.
- Profiles: the Hidden filter no longer labels items Reddit simply has not loaded yet; archive recovery retries quietly after transient failures (including Arctic Shift maintenance) instead of a permanent error; Refresh clears stale removed/deleted cues; settings changes apply once; archive-only items with unknown status use the archive icon. Discovery is several times faster on long profiles (jsdom: 400 cards 41.5 s -> 3.0 s).
- Chat reliability and privacy: a huge server cooldown can no longer block chat directory loading indefinitely; missing history metadata counts as incomplete and global search shows "Partial history"; pages without chat no longer scan the page every 1.5 s; each tab reads only the signed-in account's saved directory; Clear saved messages also removes recent searches.
- Popup: Clear actions ask for confirmation and say they apply to every Reddit account on this device; better contrast, forced-colors support and screen-reader links; unreadable settings show as unavailable.
- Archive requests: server cooldowns capped at one hour and the Arctic Shift backoff survives service-worker restarts.
- Tooling: deterministic, allowlisted packaging; minimum Chrome 111; hardened local dev relay and preview server.

Version choice: MINOR to 0.21.0 for the redesigned calendar and the new confirm-before-clear behavior alongside many fixes; no new permissions, and no storage schema change.

Validation: all 889 tests pass on a clean tree; jsdom timing for profile discovery as above; calendar and popup rendered in headless Chrome (light, dark, floating, narrow). Limitations: not yet re-checked live in Chrome for this release; deleted-account names can only be shown for people the extension saw before they deleted their account; plan items 3.1/3.2/3.4 (further discovery memoization), 3.8/3.10/3.11 (chat storage layout) and 5.2-5.4 (state split, module split) remain.

# 0.20.12 preview

- Leaving a profile while it is still loading and pressing Back now picks up where it stopped: unfinished searches restart, cards that were waiting to render finish, scheduled retries (including the Arctic Shift maintenance wait) keep their note and timing, and Refresh activity stays usable. Previously cards could stay as loading placeholders and the status could read "Activity checked" although loading had been cut off.

Version choice: PATCH to 0.20.12 for a reliability fix to 0.20.10's profile parking.

Validation: all 820 tests pass, including new cases for leaving mid-load, queued renders, scheduled retries and stale in-flight flags. ZIP integrity and source/stable-folder/archive byte equality pass. Not re-checked live in Chrome for this release; the scenarios were reproduced and verified in jsdom.

# 0.20.11 preview

- Feed options no longer changes under the reader: Reddit's original rows stay invisible from the moment Reddit renders the menu until discovery has grouped it into Sort, View and Activity, instead of being visible for about half a second first. If discovery ever fails to take over, the rows reveal themselves after 2.5 s. Discovery also starts slightly sooner by reusing the settings read made at page start.

Version choice: PATCH to 0.20.11 for a user-visible presentation fix; no new permissions or storage.

Validation: all 816 tests pass. Live Chrome on a profile load: native rows hidden from 352 ms (menu rendered) until the grouped menu at 941 ms; the opened menu shows Sort · New, View · Card, Activity · All. ZIP integrity and source/stable-folder/archive byte equality pass.

# 0.20.10 preview

- Back returns to the same place after any navigation away from a profile, not only after opening a post: subreddit, home feed and another user's profile too. Reddit keeps the profile's feed element and restores it with its own scroll offset; discovery now parks its state with that feed instead of removing its cards and re-inserting copies, and resumes when the feed comes back. Up to four profile views are kept; older ones, and all of them when discovery is turned off or the account changes, are cleaned up properly.
- Simpler internals: the saved-copy restore path, card cloning and the post-Back scroll correction are gone.

Version choice: PATCH to 0.20.10 for a user-visible reliability fix; no new permissions, requests or storage.

Validation: all 814 tests pass. Live Chrome on u/chuggingdeemer: Back from a post, a subreddit, the home feed and another profile returned the reading card to its exact offset, up to 15,000 px deep, with one discovery header and the discovered cards in place. ZIP integrity and source/stable-folder/archive byte equality pass.

# 0.20.9 preview

- Arctic Shift maintenance is recognized: its 503 "Under maintenance" (and other 502/503/504 outages) pauses all archive requests for a minute, doubling up to ten, instead of retrying every few seconds. The feed shows one quiet note, "Arctic Shift is down for maintenance. Retrying in about 1 min.", with Retry now sending a single probe. The next successful response lifts the pause.

Version choice: PATCH to 0.20.9 for a reliability fix; no new permissions or storage.

Validation: all 815 tests pass. Live during an actual Arctic Shift maintenance window: a single maintenance note with the one-minute retry. ZIP integrity and source/stable-folder/archive byte equality pass.

# 0.20.8 preview

- No more blank space while scrolling profile results, especially upward. Discovery's inserted cards broke assumptions in Reddit's feed virtualizer (placeholders in one top block, in stack order), leaving out-of-order, duplicate and detached entries that Reddit stopped at. While discovery owns a profile feed, the page bridge now drives that same controller from the document: it restores any placeholder within ~1.5 viewports wherever its entry sits, drops stale entries, and only virtualizes cards far above the viewport, in Reddit's own entry shape. Other feeds keep native virtualization; a released feed is fully restored first. This replaces the 0.20.7 restore helper.
- Back from a post or comment returns to the same place. Reddit keeps the profile feed while a post is open and restores its own scroll offset on Back, but discovery removed its cards on leaving and re-inserted them after return, so that offset was wrong by thousands of pixels. Opening a post now pauses discovery and leaves its cards in Reddit's retained feed; Reddit's restore then lands exactly. Other navigation still tears down and uses the remember/restore fallback.

Version choice: PATCH to 0.20.8 for two user-visible reliability fixes; no new permissions, requests or storage changes.

Validation: all 812 tests pass. Live Chrome on u/chuggingdeemer: 0 blank frames across ~5,700 wheel-scroll frames down and up plus fast flings, with no lost or duplicated cards; Back returned the reading card to its exact offset at 1,200 and 16,285 px. ZIP integrity and source/stable-folder/archive byte equality pass. Limitation: other kinds of navigation (for example profile → subreddit → Back) still use the older fallback and may not land exactly.

# 0.20.7 preview

- Restore already-loaded profile cards before their virtual placeholders enter the viewport. Use actual placeholder positions instead of repeating Reddit's cached-height calculation, which can drift after filtering or duplicate removal. Ask Reddit's own synchronous devirtualization method to reconnect its retained original nodes without waiting for feed hydration or another scroll event.
- Apply one viewport of overscan in both scroll directions. Large jumps continue in bounded chunks only while the native controller makes progress. Traverse Reddit's zero-height loader entries without inventing heights or changing its stack. Cancel stale work after navigation, feed/controller replacement or disabling discovery; unsupported contracts keep Reddit's normal behavior. No additional search/card requests are introduced.

Version choice: PATCH to 0.20.7 for a user-visible scrolling reliability fix. No permissions or storage/schema changes.

Validation: all 813 tests pass, including 78 bridge checks. All 34 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 38 assets. Live Brave inspection on chuggingdeemer's Comments profile confirmed the native controller retains original nodes and zero-height loaders, and that cached placeholder heights differed from the displayed layout. A temporary current-code patch reduced four visible blank placeholders to zero before the next paint on a large reverse jump; five subsequent forward/reverse checks also found zero visible blank placeholders. The complete installed bundle still requires an extension reload and Reddit refresh. This repair depends on the inspected internal native controller contract; it safely does nothing when that contract is unavailable. An extreme run of more than 8,192 zero-height stack entries retains native fallback behavior. The stable local export includes the user's pre-existing uncommitted profile verification scheduling change, preserved outside these commits.

# 0.20.6 preview

- Restore the existing comment avatar strategy: reuse a matching native headshot, then identity-checked `about.json` `icon_img`, with the hover-card fallback. Keep the stronger skeleton contrast; alternative profile metadata remains research only.
- Reapply recovered text, titles and media when returning to a profile, including retained native cards, native replacements and virtualized cards. Repeated reconciliation does not remount unchanged media. Restore the visible native or discovered card's viewport offset after Reddit reconnects the combined list; cancel the correction if the reader intervenes.
- Retain Arctic Shift's image previews, gallery metadata, video posters/streams and comment attachments, which the former text-only field projection discarded. Normalize a bounded media list and validate Reddit HTTPS hosts and stream identities. Put compact profile previews in Reddit's actual thumbnail grid cell, use Reddit's HLS player on opened posts, and display body-referenced comment images inline. Preserve signed URLs and existing restrictions; no media files or profile bodies are persisted.
- Keep the native selected-comment background painted while its author and content are loading, so the cream highlight covers the full skeleton instead of cutting off at the metadata row.

Version choice: PATCH to 0.20.6 for restoration, return-position and media reliability corrections. No new permissions or storage/schema changes.

Validation: all 811 tests pass. All 34 extension/demo JavaScript files parse; ZIP integrity, aliases and source/stable-folder/archive byte equality pass for 38 assets. Live Brave checks using temporary current-code patches confirmed retained recovered comments on Back with the same visible card and offset, a decoded 960×1482 inline comment image, a decoded native-sized profile thumbnail, and the uninterrupted native cream loading highlight. The complete installed bundle still requires an extension reload and Reddit refresh. Unprojected archive activity responses are larger but retain existing transport/record bounds; parent context requests stay projected. Archive availability remains incomplete, and expired signed video streams cannot be reconstructed. Opened archived galleries currently use ordered native image frames rather than Reddit's unverified carousel contract; image-bearing comments use the lightweight Markdown renderer, which may render complex formatting less faithfully than archive HTML. The stable local export includes the user's pre-existing uncommitted profile verification scheduling change; it remains preserved outside these commits.

# 0.20.5 preview

- Give archive restoration skeletons an opaque, theme-aware base instead of Reddit's nearly transparent shimmer token. Body, title and pending author/avatar placeholders remain visible in light and dark themes; native shimmer and reduced-motion support are retained.
- Replace the comment avatar `about.json` lookup with the native profile HTML fragment's identity-matched `reddit-page-data.profile.icon`. Reuse matching metadata or comment headshots already on the page before fetching. Preserve exact signed headshot URLs, image-host validation, bounded reads, cache and server cooldowns, with the hover-card fallback. Restored usernames still come from the archive snapshot.

Version choice: PATCH to 0.20.5 for avatar lookup reliability and restoration presentation corrections. No new permissions or storage/schema changes.

Validation: all 795 tests pass, including 99 focused native-bridge/restoration checks. All 34 extension/demo JavaScript files parse; ZIP integrity, aliases and source/stable-folder/archive byte equality pass for 38 assets. Live Brave inspection confirmed that the reported account's native profile fragment provides its signed headshot, while its hover card only provides full-body artwork. A temporary comparison using Reddit's actual shimmer component confirmed clearer skeletons in both themes and was removed after capture. The complete installed bundle still requires an extension reload and Reddit refresh. Native profile HTML is an internal client contract, not a guaranteed public API, and is larger than the old JSON response; bounded reads and caching remain. Reddit's public Data API migration announcement does not specify a removal date for the signed-in website's particular about.json route. The stable local export includes the user's pre-existing uncommitted profile verification scheduling change; it remains preserved outside these commits.

# 0.20.4 preview

- Restore comment avatars using the author's native comment headshot, preserving signed preview URLs when present, or Reddit's matching profile `icon_img`. Reject the full-body `snoovatar_img` artwork and use Reddit's SVG headshot clipping. Keep cached, bounded lookups, host validation and page-world credentials.
- Prepare deleted/removed comment notices in the document-start mutation guard after restoration preferences are known, before the delayed restorer scan. Mask the comment's own deleted avatar/name with placeholders while showing the body skeleton; normal replies remain visible. Keep the skeleton through bounded archive backoff and retain an avatar placeholder until its lookup settles. Empty archives and terminal failures restore Reddit's notice honestly.
- Enable Reddit's native Share menu for deleted/removed comments by restoring its comment ID and permalink, without enabling voting or replying. Reapply sharing when Reddit replaces an already processed comment, without another archive read. Opt-out restores the original attributes and controls. Include an in-progress profile retry check that preserves published cards under one continuation loader.

Version choice: PATCH to 0.20.4 for comment avatar, restoration presentation and native sharing corrections. No new permissions or storage/schema changes.

Validation: all 793 tests pass, including 300 discovery/native-bridge/thread checks. All 34 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 38 assets. Live Brave inspection confirmed the reported full-body hover-card image, the distinct profile headshot field, Reddit's signed native headshot markup and the deleted Share component's empty identity fields. Applying the Share identity repair in a temporary test tab opened the native Copy link / Share as post / Embed menu; votes and replies remained disabled. Initial pointer clicks were covered by the native chat overlay; the native control worked after uncovering it. The complete installed 0.20.4 bundle, cold-load paint sequence and final avatar appearance still require an extension reload and Reddit refresh. The stable local export includes the user's pre-existing, uncommitted profile verification scheduling change; that source edit is preserved and was not included in these commits.

# 0.20.3 preview

- Popup settings share one left edge instead of indenting further on each level; dependent settings stay dimmed until the setting they need is on, with a small connector stub.
- "About saved chat history" opens as an overlay instead of expanding in place, and status lines reserve their space, so the popup never grows a scrollbar or shifts. Default, overlay, long status and error states all measure 579 px in headless Chrome.

Version choice: PATCH to 0.20.3 for popup layout corrections.

Validation: all 784 tests pass; ZIP integrity and source/stable-folder/archive byte equality pass. Popup states rendered and measured in headless Chrome (light and dark); not yet checked on Windows fonts, where the headroom is about 20 px.

# 0.20.2 preview

- Deleted and removed posts always show their status cue on the post page, even when the Arctic Shift snapshot adds no text (it was captured after deletion) or the post is not archived; the tooltip says which. A deleted post's [deleted] author is replaced by the archived username in Reddit's author style, and comments whose snapshot text is [deleted]/[removed] still gain their archived author and cue while keeping Reddit's notice. Reported case: r/LenovoLOQ 1xark12.
- Tell author deletions from moderator removals by the wording of Reddit's banner (both use the same banner slot), so author-deleted posts show the trash cue instead of the ban cue.
- New detailed mascot icon (antenna-topped tinkerer with glasses, gear antenna and screwdriver among settings tiles), with a simplified head-and-glasses variant for 16/32 px and the popup header. Icons are rendered from the SVG sources with headless Chrome.

Version choice: PATCH to 0.20.2 for restoration and status corrections plus the icon artwork; no new permissions or storage changes.

Validation: all 784 tests pass. Live Chrome check on r/LenovoLOQ 1xark12: trash cue, archived author TheBrokenChad in Reddit's author style, tooltip noting the snapshot adds nothing more. ZIP integrity and source/stable-folder/archive byte equality pass.

# 0.20.1 preview

- Show restored images exactly like Reddit's image posts: the same rounded frame and hairline border, an aspect-ratio box at the image's own proportions (minimum 220 px, capped to the viewport), a blurred dimmed backdrop and the contained image on black. Live check: a restored removed post renders in the same 620×319 box as a native image post. Applies on post pages and in profile cards.
- Give restore skeletons the same design as the chat search skeletons: Reddit's pill shimmer with the same rhythm and line widths, and the same sweeping-highlight fallback, shown where the body or comment text will appear.
- Redesign the popup: grouped cards with icon tiles, Reddit-style switches, a nested hierarchy that dims dependent settings until the setting they need is on, a version chip, a compact chat row and light/dark themes. It fits Chrome's 600 px popup without scrolling.
- Replace the extension icon with an original tinkerer mascot (gear antenna, goggles, wrench) on Reddit orange, legible at 16 px. It is not Reddit's Snoo, which is Reddit's trademark.

Version choice: PATCH to 0.20.1 for presentation corrections and the redesigned popup and icon; no new behavior, permissions or storage changes.

Validation: all 781 tests pass, including the media builder structure and URL validation, skeleton fallbacks and popup behavior. All extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass. The image layout, skeleton, popup (light and dark, 600 px) and icon sizes were checked live in Chrome.

# 0.20.0 preview

- Restore deleted and removed content on post pages. Comments Reddit shows as "Comment deleted by user" or "Comment removed by moderator" get their archived text, the original author's name and Reddit profile picture (in Reddit's own comment and avatar markup), and a status cue; restored comments open so the text is visible. Removed or deleted posts get their archived title, body and, for image posts, the Reddit-hosted image inside Reddit's post element. A Reddit-style shimmer replaces the notice while the archive is asked, and every path settles back to Reddit's notice when nothing is archived.
- Fix removed posts not recovering when opened from a profile. After Reddit's in-page navigation the archive worker still saw the content script's first page (the profile) and refused the lookup; requests now carry the current page. Post pages are handled by a URL-driven thread module, so recovery works however a post is opened.
- Recognize Reddit's current deletion markup (notices, "[ Removed by moderator ]" titles, removal banners) everywhere, which also makes recovered text appear in profile Deleted cards, including link-post bodies and removed image posts' images.
- Render archived text through Arctic Shift's server-side markdown, rebuilt from a strict allowlist (no scripts, media, frames, styles or unsafe links), with a local renderer as fallback.
- Group Reddit's Feed options into Top-style Sort, View and Activity submenu entries that show the current choice; the menu stays inside the viewport. Use Reddit's own icons throughout, and show each item's real status: trash for deleted, ban for removed by moderators, eye-slash for hidden. Fix the Comments feed menu painting under the feed.
- Back to a profile reuses the rendered cards instead of re-rendering copies; separators return on fully hidden profiles; animations play only for cards inserted between Reddit's own; the tail card no longer jumps when results load; rate limits and timeouts retry with backoff behind a quiet note; Deleted no longer stalls or pauses on unrelated search errors; blocked profiles use credential-free search because Reddit refuses the legacy JSON route.
- Performance: the page-wide observer ignores feed changes the feed observer already handles, scroll virtualization swaps skip reconciliation, loader updates skip layout work when unchanged, All activity no longer pre-checks archive status that rendering proves (about half the Reddit requests for archive items), status checks batch through info.json when allowed, thread comments are only re-examined when new ones load, and Arctic Shift pages hold 100 records.

Version choice: MINOR to 0.20.0 for new user-facing features (post-page restoration with authors and images, grouped Feed options). No new permissions; archive data and avatars are not persisted; chat sync is unchanged.

Validation: all 779 tests pass, including new regressions for in-page-navigation authorization, post and comment restoration, skeleton settling, native author markup, menu grouping and teardown order, card reuse on Back, separators, status icons and the performance paths. All 33 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 34 assets. Live Chrome checks: profile -> removed post now restores title, image and cue (the reported r/TwentiesIndia case); Back returns all tagged cards as the same rendered elements with scroll kept; a deleted thread comment shows its archived text, author and avatar matching native neighbours; the grouped menu measures 157 px on Posts and Comments; separators appear on a hidden profile. Not done: inserting comments Reddit dropped entirely (planned), and Reddit's info.json is refused in the tested session, so status checks there use per-card reads. Archive coverage remains incomplete, and a snapshot never proves current deletion.

# 0.19.1 preview

- Name the search that failed in Reddit request errors. The previous "Reddit could not load public posts (HTTP n)" also appeared for comment searches.
- Treat an HTTP 403 from the cookie-free comment search as a pause, not a failure. That supplement is skipped for about ten minutes behind a muted note ("Some comments may be missing · Reddit is blocking logged-out search"), and its tooltip explains the cause. Signed-in search, the native feed and the archive continue, and coverage stays incomplete. Other failures remain explicit and retryable.
- Show errors and notes as Reddit's secondary text with a small icon (only the error icon is red) instead of plain red text.

Version choice: PATCH to 0.19.1 for a user-visible reliability and presentation correction. No permissions or persistent storage/schema changes.

Validation: all 747 tests pass, including new checks that a 403 from the logged-out stream becomes a note and pauses for the session, and that other logged-out failures remain errors. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. No live browser verification was performed.

# 0.19.0 preview

- Merge Arctic Shift records into profile New views automatically whenever the archive preference is on, alongside Reddit search; Deleted uses the archive in every sort. The separate archive button is gone. **Refresh activity** moves into Reddit's **Feed options** menu, and the toolbar above the feed collapses unless an error or paused-loading Retry needs to show.
- Load Reddit search and the archive independently. Continuation advances every provider at the shared frontier, and one provider's request no longer blocks the other. Repeat requests join the in-flight page.
- Bound the merge waits. Cards Reddit has already painted are never hidden again. Later native pages wait at most about 1.2 s for discovery coverage. A source unanswered after 2.5 s stops holding back the others, and its late results are still placed by date.
- Fetch 100 archive records per page instead of 25 (a live probe measured about the same latency). Fill archived comment post titles through a batched, cached archive lookup, show snapshot dates in cues, and honor `X-RateLimit-Reset-At`.
- Check archive candidates through one queue. The page bridge asks Reddit's info endpoint once per batch of up to 25 items (own 4 s deadline) and falls back to native card fragments, which remain the authority. Any info failure suspends the fast path for ten minutes. Deleted keeps up to one page of unchecked candidates ahead instead of waiting for every check.
- When Reddit no longer serves a deleted item and an archive snapshot exists for that item and author, show the snapshot in Reddit's own card layout, attributed in the cue, instead of a bare link with a Recovered text box. Items without archive text keep a Retry row built from Reddit's button and text classes.

Version choice: MINOR to 0.19.0 for the new automatic archive merge and the Feed options Refresh entry, a substantial compatible expansion of profile discovery. No new permissions or persistent storage/schema changes; archive data is still not persisted, and chat sync is unchanged.

Validation: all 745 tests pass. New regressions cover painted-card visibility, bounded native and source waits, automatic and Refresh archive starts (off without opt-in and outside New/Deleted), independent provider continuation, 25-item status batches, Deleted look-ahead, archive-card fallbacks, the Refresh menu row, 100-record archive pages, title fill and its failure modes, snapshot dates, the info fast path with its 403/timeout/foreign-author fallbacks, and Reset-At cooldowns. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Per the requested scope, there was no live browser verification. In particular, whether Reddit's info endpoint answers a signed-in session (otherwise the fragment fallback applies), how deleted comment fragments render, and the timing of the new wait budgets are unverified on real profiles. Reload Reddit Tweaks and refresh Reddit to activate the bundle. Search-index and archive coverage remain incomplete, and an archive snapshot never proves current deletion.

# 0.18.17 preview

- Retry an unrecognized profile-search continuation response once at the same cursor before showing a pause. Keep strict response validation, cancellation, server cooldowns and explicit repeated failures; an unknown response never counts as exhausted history.
- Retry loading resumes only failed Reddit search sources at their retained cursors instead of restarting healthy sources from the newest page. Preserve existing cards and Hot ranking. Refresh activity retains its explicit refresh behavior.

Version choice: PATCH to 0.18.17 for profile continuation recovery and retry reliability. No permissions, persistent storage/schema or chat sync changes.

Validation: all 718 tests pass, including 241 discovery/native-bridge checks. Five new regressions cover transient recovery, bounded repeated failure, cursor-specific manual retry, Hot ordering, first-page recovery and cancellation/rate-limit exclusions; four recovery regressions fail against 0.18.16. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspection found the reported profile paused on an unrecognized cookie-free comment-search response after the other sources ended. Re-reading the same cursor succeeded. Resuming that source in the existing 0.18.16 tab advanced from 28 to 33 source pages, preserved existing card objects and cleared the pause and source errors. The original failing response body was unavailable, so its precise HTML cause is unconfirmed. The complete 0.18.17 bundle still needs an extension reload and Reddit refresh; live recovery used the existing continuation path, while new retry behavior was validated with synthetic tests. Search coverage and server responses remain external limitations.

# 0.18.16 preview

- Preserve native card-bearing continuation wrappers while merge gating is active, and collapse orphaned native separator runs inside known nested feed batches and pager wrappers. Keep visible card boundaries and leave rules inside card and media content untouched. Nested virtualization retains original native cards and restores presentation on opt-out.
- Live inspection of 0.18.15 showed 30 rules in a 25-card batch; eight approximately 0.555-pixel rules stacked between seven zero-height load-more observers. Each observer contained a native card, but merge-waiting styling hid the wrapper. The corrected installed bundle has not been verified in the browser.

Version choice: PATCH to 0.18.16 for the profile-feed separator and card visibility reliability correction. No permissions or persistent storage/schema changes.

Validation: all 713 tests pass, including nested separator, card-bearing wrapper and virtualization regressions. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live inspection confirmed the 0.18.15 cause, but browser access ended before the corrected CSS or complete installed bundle could be checked. A partial JavaScript diagnostic was applied to the existing tab; reload the extension and refresh Reddit to replace it and check the final appearance.

# 0.18.15 preview

- Collapse orphaned runs of standalone native profile-feed separator rules when extension filtering or merge gating hides intervening cards. Keep one boundary between visible cards, preserve normal native boundaries and unrelated rules, and restore rules on opt-out. Original and virtualized nodes remain in place; the extension does not generate separators.
- The supplied computed styles identify a one-pixel native rule with no margin. Synthetic fixtures reproduce stacking when hidden cards are skipped, but the number of rules in the live report and the final installed appearance remain unverified.

Version choice: PATCH to 0.18.15 for the profile-feed separator reliability correction. No permissions or persistent storage/schema changes.

Validation: all 711 tests pass, including synthetic separator regressions for hidden and gated cards, native boundaries, virtualization and opt-out restoration. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. No live browser or installed-build verification was performed; reload the extension and refresh Reddit to check the final appearance.

# 0.18.14 preview

- Keep profile feed borders supplied by Reddit. Remove generated card separators and stop hiding native horizontal rules around the feed, toolbar and loader; supplemental linear progress suppression remains scoped separately.
- Earlier fixes created rules with Reddit utility classes inside extension card wrappers and later hid some native rules. Matching classes alone do not establish matching layout. The precise cause of the reported vertical thickness has not been verified with computed styles.
- Document observed profile-history visibility signals and their limits. No speculative request-skipping based on a profile visibility assumption is introduced; search and archive coverage remain incomplete.

Version choice: PATCH to 0.18.14 for the profile border correction. No permissions or persistent storage/schema changes.

Validation: all 708 tests pass. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Synthetic regressions cover native separators through hydration, filtering and virtualization, and preserve native rules around controls and the loader. No live browser or installed-build verification was performed; the precise visual cause of the reported thickness remains unverified. Reload the extension and refresh Reddit to apply the bundle.

# 0.18.13 preview

- Fix the page-unresponsive regression introduced by 0.18.12 scroll preservation. The loading observer was responding to temporary inline feed-style writes by starting another viewport transaction, which wrote the same styles again and indefinitely restarted the mutation microtask. Exclude feed style records from loading-state triggers while retaining native loader visibility/content observations.
- Hide the actual horizontal rules identified in the supplied inspector screenshot around the extension toolbar and native continuation. Include loader-owned shadow rules, retain card/body separators and restore native presentation on opt-out. The earlier progress-only selectors did not target this divider.

Version choice: PATCH to 0.18.13 for the responsiveness regression and divider correction. No permissions, persistent storage/schema or chat sync changes.

Validation: all 708 tests pass, including 231 discovery/native-bridge checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. A bounded regression detects six recursive callbacks on 0.18.12 versus none from viewport style writes with the fix, verifies timers run and confirms actual native loader changes remain observed. Divider checks preserve native halos and card/body rules and verify opt-out cleanup. Diagnosis used the supplied inspector screenshot and extension-level synthetic diagnostics; no browser automation or installed-build verification was performed. Reload Reddit Tweaks and refresh Reddit. If the previous build has frozen a tab, disable the extension and reload that tab before enabling the corrected build.

# 0.18.12 preview

- Preserve the reading position across complete profile batch updates, including enrichment, native card visibility, filtering and loader handoff. Temporarily protect the feed height against intermediate bottom clamping and suppress native anchoring only during the synchronous update, then compensate the retained reading card once. Restore original inline style values and priorities; leave no permanent spacer.
- Keep an already displayed discovery in its current slot while a matching incoming native duplicate is still gated, avoiding an empty gap before native handoff.
- Suppress supplemental linear progress tracks in native feed/continuation components while retaining the Snoo halo. Scope shadow styles away from card/media roots, avoid duplicate injection and restore native presentation on opt-out.

Version choice: PATCH to 0.18.12 for bottom-scroll stability and loading presentation in existing profile discovery. No permissions, persistent storage/schema or chat sync changes.

Validation: all 706 tests pass, including 229 discovery/native-bridge checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Three scroll regressions fail on 0.18.11 and pass here: late enrichment, temporary bottom clamping and gated duplicate collapse. Additional coverage checks native halo retention, scoped media controls and loading-style cleanup. Validation used extension code and synthetic layout diagnostics without browser automation, as requested; the installed browser and exact screenshot element were not inspected live. Reload Reddit Tweaks and refresh Reddit to activate the bundle. Final document shortening at known exhaustion remains constrained by the browser's actual scroll range; no blank space is retained merely to preserve an impossible offset. Native response latency and search-index coverage remain external limitations.

# 0.18.11 preview

- Coordinate incoming native profile pages with discovered activity in New / All activity. Keep new native cards out of the displayed layout until discovery covers their dates and preceding discovered cards are ready, then reveal the combined chronological prefix. Retain the original native cards and already published discoveries through reverse scrolling and refresh.
- Pause the native continuation while its new cards wait and retain one shared native halo. Predictive continuation now follows the combined displayed prefix rather than a distant, uncovered native tail. A full buffer of older deferred discoveries cannot strand the shallower search cursor. Ignore pagination markers embedded inside individual cards.
- Remove temporary merge gates on filtering, navigation and opt-out, transfer them through native virtualization, and release native results after a failed initial discovery while keeping the source failure explicit and retryable.

Version choice: PATCH to 0.18.11 for mixed-feed ordering and continuation reliability in existing profile discovery. No permissions, persistent storage/schema or chat sync changes.

Validation: all 702 tests pass, including 225 discovery/native-bridge checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. The two mixed-feed regressions fail on 0.18.10 and pass with the fix. Additional checks cover automatic cursor progress, CSS and loader ownership, retained native identity, virtualization, full deferred buffers, failures, filtering and opt-out. This bundle was validated through extension code and synthetic diagnostics without browser automation, as requested; installed-build behavior was not rechecked live. Reload Reddit Tweaks and refresh Reddit to activate it. Search-index coverage and native response latency remain dependent on Reddit; source failures do not establish complete history. Chronological coordination applies to New, while Top and Hot retain their existing loaded-result ordering.

# 0.18.10 preview

- Recover a native-card transport timeout, transient gateway error or failed fetch once before exposing a manual Retry row. Keep the pending card behind the shared native loader during recovery, preserve its identity and native actions on success, and retain explicit failures after the bounded retry. Manual Retry starts a fresh attempt; definitive missing/malformed cards, canceled views and rate-limit pauses do not enter the retry path.
- Prepare up to four comment cards concurrently while retaining two physical post slots and a shared four-read ceiling across native render/status consumers. Keep status batches at two workers, native-fragment coalescing, bounded page-world caches and server cooldowns. Parallel responses still publish only the chronological ready prefix.
- Correct current documentation of native throughput and remove obsolete rolling card-count quota descriptions. Search-page timeout recovery and bounded predictive prefetch from 0.18.9 remain in place.

Version choice: PATCH to 0.18.10 for transient native-card recovery and comment-loading throughput in existing profile discovery. No permissions, persistent storage/schema or chat sync changes.

Validation: all 695 tests pass, including 218 discovery/native-bridge checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. The timeout-recovery regression fails on 0.18.9 and passes with the fix. New checks cover bounded retries, manual recovery, definitive-error exclusions, four-comment ordered publication, mixed post/comment capacity, and status/render saturation without exceeding the shared physical ceiling. Live Brave identified the screenshot's exact native-card timeout; a later authenticated read returned the matching card successfully in about 0.36 seconds. Final installed-build verification requires reloading Reddit Tweaks and refreshing Reddit. Persistent native/API failures remain retryable, and server latency/coverage cannot be guaranteed.

# 0.18.9 preview

- Fix the 0.18.8 ordering regression when Reddit's native profile feed is populated and signed-in search returns an empty page with a valid continuation. Such a page retains its cursor but cannot establish an infinite date boundary that blocks healthy public-search discoveries. Older native-horizon deferrals also no longer strand newer candidates that need another source page.
- Prime one additional cursor round on initial automatic discovery when the unpublished buffer has room, including archive-only profiles. Prefetch ahead of the feed tail between completed hydration batches as well as during active hydration, retaining the existing buffer, concurrency, cooldown and route-cancellation limits. Reddit still controls result page sizes; no larger unsupported Shreddit limit or full-history background walk is introduced.
- Retry a timed-out Reddit discovery read once at the same scoped cursor without discarding populated cards. Cancellation, rate limits and malformed responses do not retry. Persistent failures remain explicit and incomplete. The reported Reddit timeout is the existing 10-second accepted-request deadline, distinct from queue deferral and archive timeout messages.

Version choice: PATCH to 0.18.9 for mixed-feed visibility, predictive loading and transient timeout recovery in existing profile discovery. No permissions, persistent storage/schema or chat sync changes.

Validation: all 687 tests pass, including 150 discovery checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. The new native-plus-empty-cursor regression fails on 0.18.8 and passes with the fix. Live Brave reproduced zero signed-in comment cards with a valid continuation, ten public comment cards and a populated native feed on chuggingdeemer. Tests also cover bounded distant initial look-ahead, predictive loading between batches, archive-only priming, preserved native objects, same-cursor retry, persistent errors, cancellation and rate-limit exclusions. Final installed-build verification requires reloading Reddit Tweaks and refreshing Reddit. Empty streams retain continuation but can wait behind nonempty source boundaries; source coverage and individual network/card latency remain incomplete.

# 0.18.8 preview

- Coordinate New publication across posts, authenticated comments, public comments and opted-in archive streams. Establish initial source boundaries, publish only their shared chronological prefix and paginate the shallowest stream first. Hydrate native cards in combined order rather than staged DOM arrival order, so delayed comments do not push already-published older posts downward.
- Retain source boundaries in the existing account-scoped page-session snapshot. Resume a ready batch when a temporary boundary clears, retain populated native objects and preserve the visible card's offset during reconciliation without overriding an intervening user scroll. Existing native virtualization and shared native halo ownership remain in place.
- Start Deleted archive discovery alongside an in-flight Reddit search. Return native status evidence in incremental pairs rather than withholding a whole page behind a slow fragment, skip known available/search-only unknown candidates and drop irrelevant queued hydration on activity changes. Continue to require current deletion/removal proof before labeling a snapshot Deleted.
- Stop Deleted continuation when the relevant archive source is exhausted; unrelated live-search cursors cannot leave its halo spinning forever. Wait for pending verification before advancing its archive cursor, avoid per-frame continuation retries during that wait, and keep failed/unknown checks explicitly incomplete and retryable.

Version choice: PATCH to 0.18.8 for mixed-profile ordering, Deleted latency and loader reliability in the existing discovery feature. No permissions, persistent storage/schema or chat sync changes.

Validation: all 680 tests pass, including 143 discovery checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Regressions cover unequal mixed-source depths, delayed initial comments, active-boundary resumption, incremental verification, activity-switch queue pruning, Deleted exhaustion, archive continuation, Top archive boundaries and viewport compensation. Live installed-build verification requires reloading Reddit Tweaks and refreshing Reddit. Search/archive coverage and current-status verification remain incomplete; network/native-fragment latency can still delay individual items. Top/Hot order currently loaded activity, since chronological archive pages cannot guarantee lifetime score/relevance ranking.

# 0.18.7 preview

- Supplement authenticated comment discovery with a cookie-free public Reddit search stream in Comments and Overview. A live uncached comparison for the reported chuggingdeemer profile returned zero signed-in cards and ten public cards from r/TheLaptopGuide; a matching authenticated native comment fragment also returned successfully.
- Give each comment stream independent, scope-bound cursors, exhaustion/failure state and metadata precedence. Deduplicate full comment IDs, prefer signed-in metadata regardless of arrival order, preserve restriction flags and display successful sources progressively. Failed sources remain explicit and retry on Refresh without blocking healthy continuation. Keep cookies and account settings unchanged, bypass HTTP cache for both discovery variants, and retain authenticated native rendering/actions.
- Preserve all returned native comment cards up to the existing response bound; validate empty/error responses and continuations, and retain available parent IDs for reply context. Allow bounded local provider backpressure to settle rather than failing a third Overview source after only two short waits.
- Consume pending native virtualization swaps before reconciliation/cleanup so a concurrent result completion cannot reinsert an original card that Reddit has just placed in its retained scroll stack. Preserve consumed filter/hydration updates before paint and ignore obsolete placeholder records.
- Wait for a native card's component definition and first render before publishing its populated prefix. Missing modules stay behind the shared loader until the existing timeout produces a retryable error; canceled or replaced views cannot receive the result.

Version choice: PATCH to 0.18.7 for missing public-comment coverage and blank-region reliability fixes in existing profile discovery. No new permissions, persistent storage/schema changes or chat sync changes.

Validation: all 670 tests pass, including 193 targeted discovery/native-bridge checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. The synchronous placeholder regression failed before the fix by reconnecting the detached original prematurely and passes afterward with the same populated object retained. Live Brave checked public versus signed-in comment search, author/community metadata and authenticated native rendering. Final installed-build UI verification requires reloading the extension and refreshing Reddit. Search/archive coverage remains incomplete; Reddit may refuse individual reads, and native response/rendering contracts can change.

# 0.18.6 preview

- Retain the combined native/search/archive profile feed while opening a post, even when Reddit removes the profile tabs ahead of the feed. Track actual native objects, including virtualized originals, until the post view takes over; canceled navigation preserves the same cards and filters, while replacement views and opt-out clean up immediately.
- Recognize Reddit’s programmatic profile continuation alongside lazy continuations. Defer unpublished older discoveries to the appropriate native page, and keep published cards populated and visible through pagination-marker changes.
- Prepare groups of up to 25 cards two viewports ahead, publish their ready prefix in order, and overlap a next source read with hydration near the tail. Bound the unpublished buffer, including deferred discoveries, so prefetch cannot become a history crawl. An idle native loading halo still owns the visible loading UI but no longer blocks extension continuation.
- On reverse-scroll animation frames, ask Reddit’s existing virtualization controller to restore its retained original cards. Do not reconstruct cards, fetch them again, edit the native stack or implement a second virtualized list. Scope the optional adapter to enhanced profile feeds and reject queued work after route/view replacement or opt-out.
- Document the observed native profile pagination and session-dependent owner presentation. Native and search page sizes differ, and deduplication/filtering means a source page cannot guarantee an identical number of new combined-feed cards.

Version choice: PATCH to 0.18.6 for profile transition, pagination and scrolling reliability. No permissions, persistent storage/schema or chat sync changes.

Validation: all 659 tests pass, including 182 targeted discovery/native-bridge checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspected mixed feeds, native 25-post continuations, retained virtualization objects/controllers, post navigation and authenticated/cookie-free owner-page presentation. Final installed-build verification requires reloading the extension and refreshing Reddit. The native controller is an undocumented, feature-detected contract; server latency, failed native fragments and incomplete search/archive coverage remain possible.

# 0.18.5 preview

- Use Reddit’s native Shreddit post search for ordinary/curated profile discovery after live result-ID/order comparisons across New, Hot and Top. Parse crossposts as outer results, exclude embedded originals, retain their own author/time/counters and restrictions, and follow only matching same-origin continuations. Full post cards and actions continue to use Reddit’s authenticated native renderer; search snippets are not fabricated as complete text or deletion proofs.
- Preserve authenticated JSON discovery for explicitly blocked profile states: signed-in Shreddit returned fewer posts in the live comparison. Bind each post cursor to its transport, author, sort and time range so pagination cannot mix sources. Genuine empty searches are distinguished from changed/error HTML, and native pages are not silently truncated at the previous JSON page size.
- Preserve archived-body restoration for metadata-only discovery: attach a matching author/ID Arctic Shift body only after native deletion/removal evidence, retain restriction flags and leave available native text unchanged.
- Keep the extension’s loading sentinel as a stable insertion anchor when Reddit has no native continuation. Unchanged reconciliation previously moved published cards past the sentinel and then moved the sentinel back. Remove that unnecessary DOM churn, preserving hydrated card identity and placeholder restoration during reverse scrolling.
- Document the proposed authenticated plus cookie-free comment discovery streams, with independent cursors/errors, ID deduplication, shared bounded scheduling, native authenticated rendering and incomplete-coverage handling. Comment credentials are unchanged in this bundle.

Version choice: PATCH to 0.18.5 for profile discovery compatibility and scroll reliability. No persistent storage/schema changes, new permissions or additional chat sync loop.

Validation: all 648 tests pass, including 179 targeted profile/model/bridge checks. All 31 extension/demo JavaScript files parse, and ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. The scroll regression reproduced eight unnecessary child-list changes across two unchanged scans before the fix and zero after it, including virtualized-card restoration. Live Brave compared public result IDs, native pagination, crosspost structure, Top’s empty state and signed-in/cookie-free differences; findings and coverage limits are in docs/profile-search-sources.md. Final installed-build scroll verification requires reloading the extension. Search/API coverage and undocumented native contracts remain incomplete/changeable; blocked detection depends on Reddit’s explicit current profile marker.

# 0.18.4 preview

- Replay the native chat-cache connection when the isolated storage listener attaches after the page-world client. This closes a startup race where loaded memory events were replayed, but disk-only history waited until a search opened. All/Messages and room search can remain closed while the extension imports Reddit’s existing local history and captures native events.
- After a saved-read deadline, check worker responsiveness independently of storage queues. Slow reads retain the local Refresh action; an unresponsive worker receives extension-reload and tab-refresh instructions instead. Concurrent checks share one bounded probe, context invalidation stays terminal, and neither case clears saved data.
- Refine selected filters in global and room search with a subtle accent background and stronger label weight, without check marks or a reserved indicator column. Sender, attachment, chat-type, status and sort choices retain their existing selection behavior. This cosmetic follow-up keeps version 0.18.4.
- Preserve account checks, one reconciliation per native attachment, truthful incomplete coverage and the existing committed-read path. No second Reddit sync loop, network history crawl, storage-schema change or new permissions.

Version choice: PATCH to 0.18.4 for background chat-capture startup reliability.

Validation: all 640 tests pass, including independent worker health, concurrent probe deadlines, invalidated contexts and a startup regression reproduced failing before the fix with a deliberately late storage listener, disk-only history, no search calls and no repeated import on native sync. The filter refinement also passes 102 targeted search/interface checks. All 31 extension/demo JavaScript files parse; ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave reproduced the reported 15-second saved-read timeout while Reddit’s client was ready, but even unrelated extension-worker messages stalled; that separate live worker failure still requires a restart diagnostic and is not claimed fixed by this handshake change.

# 0.18.3 preview

- Preserve extension-discovered hidden/deleted/archive cards and active filters while Reddit keeps the outgoing native profile feed visible during a tab change. The URL and selected tab can change ahead of the data; bind cleanup/remount to the actual native feed handoff instead.
- Recognize replacement feeds and in-place native content replacement, retain virtualized native identities, preserve state on canceled tab changes, and prevent late outgoing responses from entering the incoming tab. Unavailable-account archive views keep their existing owned-tab behavior; other account transitions and opt-out still clean up immediately.

Version choice: PATCH to 0.18.3 for a visible native profile tab-transition reliability fix. No permissions, persistent storage or request-policy changes.

Validation: all 636 tests pass, including 115 discovery tests and six new tab-handoff regressions. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave tracing with temporary latency reproduced the old behavior: the URL/selection changed, extension cards disappeared while the same Posts feed remained connected, and Reddit replaced that feed later. Temporary diagnostics and network throttling were removed. Final installed-build verification requires an extension reload; undocumented native view ownership contracts can change.

# 0.18.2 preview

- Verify archive item status with Reddit's authenticated native card fragments rather than the legacy info endpoint, which can return HTTP 403 while card rendering works. Share in-flight reads and a bounded, transient page-world fragment cache between status checks and rendering. Preserve archive text provenance, author/identity checks, restrictions and explicit unknown status. Show optional verification limitations quietly without treating archive discovery as a failed load.
- Apply Activity filtering to the native feed before paint, including newly inserted and hydrated cards, without removing native cards from the client list. Preserve original visibility through virtualization placeholder swaps and restore it on All, cleanup or opt-out.
- Retain populated extension card objects when a native duplicate arrives, including objects held in Reddit's internal virtualization stack. Do not expose unfinished cards after a duplicate race. Reverse scrolling can restore the same hydrated objects without clearing and rebuilding their contents.
- Keep the tail sentinel measurable while a native continuation loader owns the visible halo. Loader ownership no longer changes merely because a loader is outside the viewport, preventing adjacent native and extension halos from appearing together during scrolling. Native component hidden states receive an explicit display rule.
- Isolate cancellation among consumers sharing a native read. A status deadline cannot cancel a card still using the response; completed verification evidence survives a partial timeout. Physical fragment requests remain bounded to two; server cooldowns and route cancellation remain enforced.

Version choice: PATCH to 0.18.2 for archive verification, pre-paint filtering, retained-card scrolling and duplicate-loader reliability corrections. No new permissions, persistent data schema or chat sync behavior.

Validation: all 630 tests pass, including 157 discovery/native-bridge checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspection confirmed the blocked JSON/native-fragment distinction, adjacent native/extension loaders, and Reddit's retained virtualization stack and same-object restoration contract. Final installed 0.18.2 verification requires reloading the unpacked extension. Reddit may still refuse or omit individual fragments, and missing verification remains unknown; archive coverage is incomplete. Undocumented client contracts can change.

# 0.18.1 preview

- Keep one native Reddit halo at the end of the feed while cards and further pages load, including comments in Overview. Stage unfinished cards outside the visible feed and publish ready cards in order. Reattach the same tail if native reconciliation removes or overtakes it; dormant, hidden and offscreen native loader components do not suppress it. Observe native loader shadow completion so continuation can resume without another scroll.
- Remove the eight-page lifetime cap and artificial rolling 8-read/30-card quotas. Continue on demand with validated source cursors, bounded concurrency, timeouts, route checks and Reddit Retry-After. Retain original native sort horizons for All activity and do not claim complete archive/history coverage.
- Combine Comments sorting and Activity in one native dropdown at the existing sort position, showing the current sort such as New. Reuse the native button/caret, menu rows, Top submenu and positioning; restore the original sort control on opt-out, replacement and cleanup.
- Make Deleted start opted-in Arctic Shift discovery, including after an in-flight Reddit read, and prefer archive continuation in that mode. Verify current deleted/removed status instead of treating every snapshot as deleted. Older filtered archive candidates are no longer held behind the unfiltered native feed horizon.

Version choice: PATCH to 0.18.1 for user-visible loading/continuation and Deleted-filter reliability fixes, plus the requested Comments control correction. No permissions, storage schemas or private chat synchronization changes.

Validation: all 606 tests pass, including 133 targeted discovery/native-bridge checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspection confirmed the native Comments sort button/caret and reproduced the missing archive lookup and separate controls on the reported profile. Final installed-build verification requires reloading the unpacked extension. The live Reddit metadata endpoint returned HTTP 403 during diagnosis; native card evidence can still qualify status, but failed or unavailable verification never proves deletion. Archive availability/coverage and undocumented native client contracts remain variable.

# 0.18.0 preview

- Preserve Reddit's Feed options trigger and sort/view rows. Add one Activity entry opening All activity, Hidden and Deleted within the same dropdown, with native icons, checkmark, Back and Escape behavior. Missing controls on deleted/banned profiles reuse Reddit-rendered controls with native Top/view actions; Comments uses the native icon-only variant beside View where available. Reduce Refresh to the adjacent 16px visual size.
- Use retained native empty-state markup, with a last-verified native rpl fallback and adapted loaded-activity copy. Count matching original and extension cards, suppress empty states during unfinished work/failure/continuations, and restore native nodes on All or opt-out.
- Remove the artificial 12-per-30-second card bottleneck: one 25-card page now fits inside a bounded 30-start window, retaining two concurrent renders and server Retry-After. Publish each contiguous ready prefix, show successful Overview sources before slower peers, and render archive records before optional metadata finishes. Keep source errors through secondary work and Back.
- Keep Reddit's bottom continuation visible through queued cards, pending reads/enrichment and further pages, including when existing results are present. Pauses offer Retry; the automatic page limit offers an explicit cursor-preserving Continue loading action. Known exhaustion removes the loader.
- Add Restore deleted content automatically, on by default within the separate Arctic Shift opt-in. Recover eligible visible deleted/removed profile posts/comments in bounded author-verified batches, and check opened deleted posts once their exact native identity loads. Display available original text by default, retain native/archive NSFW and spoiler restrictions, and discard opted-out or stale results. Missing archive text is never invented.

Version choice: MINOR to 0.18.0 for the new automatic-restoration preference and behavior, bundled with native interface and loading corrections. No new permissions, persistent profile content, chat sync loop or storage-schema change.

Validation: all 596 tests pass, including 161 targeted discovery/native-bridge/model/broker/popup checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspection verified native menu/empty-state markup and selection glyphs; a temporary first-party fragment probe retained the working native Top submenu and bottom-start positioning and was removed. Final installed 0.18.0 appearance, end-to-end restoration and continuation require reloading the unpacked extension. Provider latency/availability and archive coverage remain variable/incomplete; native undocumented contracts may change. No live speedup benchmark is claimed. Automatic restoration cannot reconstruct text absent from the archive.

# 0.17.0 preview

- Add All activity, Hidden and Deleted choices to Reddit's native Feed options menu. Reuse native menu components, preserve original cards and restore them on opt-out. Hidden covers public results absent from the loaded feed; Deleted includes verified deleted/removed items and excludes unknown archive snapshots.
- Use monochrome native hide/delete indicators without colored backgrounds or a help cursor. Match the chat search refresh glyph and size.
- Reuse Reddit's actual continuation-loading component; remove orphan loaders on remount and suppress an additional halo during native feed reload. Retain hydrated sidebar DOM across profile transitions and prepare validated eager native modules before revealing sidebar text.
- Start independent Overview reads together and prepare hidden card groups in two existing native renderer slots. Reveal groups in order before optional reply metadata settles. Keep request/page budgets, native pagination, completed cards and partial Back restoration; reject stale parallel completions.

Version choice: MINOR to 0.17.0 for the new profile activity filters, bundled with loading and navigation reliability improvements. No new permissions, persistent profile data, chat sync loop or storage-schema change.

Validation: all 570 tests pass, including 131 targeted model/discovery/bridge/broker checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspection confirmed Reddit's native Feed options structure, hide/delete paths, Boolean deletion property and continuation component rendering its own halo. Installed 0.17.0 visual/end-to-end checks require reloading the updated unpacked extension. Provider availability and archive coverage remain incomplete, filters cover discovered/loaded activity, and Reddit's undocumented native contracts can change. Optional metadata failures do not hold up ready cards.

# 0.16.4 preview

- Hydrate Reddit's native grid controller with the recovered left sidebar, restoring collapse, hover and saved navigation behavior. Discover validated native bootstrap metadata rather than copying new event handlers.
- Restore missing comment author and “replied to” headers. Reuse loaded parents, batch native lookups and use the enabled archive provider for unresolved parents, restricted to children already discovered on this profile/tab. Preserve complete native headers and verify thread identity.
- Match native profile continuation: one halo at the feed tail, six prepared cards revealed together, then the next bounded group/page as scrolling reaches it. Keep completed cards and partial Back state; pause failures and avoid false empty states, placeholder-filled scrollbars and loader anchoring jumps. Native feeds keep their own pagination.

Version choice: PATCH to 0.16.4 for existing profile metadata, navigation and loading corrections. No new permissions, persistence or schema change.

Validation: all 556 tests pass, including 117 targeted model/discovery/bridge/broker checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live inspection verified native reply markup, the continuation loader and the missing grid bootstrap; loading it restored collapse/expand, and the original preference was restored. Reddit metadata returned HTTP 403; direct archive diagnostics were blocked, so provider-dependent installed recipient recovery and final appearance still require reloading the bundle. Missing archive data remains incomplete; Reddit's undocumented contracts can change. Temporary relationship proofs expire in ten minutes or when worker memory is released.

# 0.16.3 preview

- Correct the loading hierarchy: use one native Snoo halo for initial feed loading and quiet native shimmer skeletons for pending cards.
- Preserve Reddit-rendered card identities instead of injecting banned/deleted account artwork into community cards. Archive-only fallbacks use community icons for community activity and the owning user identity for profile-hosted posts. Keep unavailable-profile header artwork at its native 64px size.
- Prefer validated compatible reload contracts from Reddit-owned cards, preserving native HTML/components and view settings. Defer renderer startup without requests or premature fallback cards, with a bounded failure instead of indefinite loading.

Version choice: PATCH to 0.16.3 for native presentation and rendering reliability corrections. No new permissions, persistence or schema changes.

Validation: all 542 tests pass, including 87 targeted model/discovery/bridge checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspection confirmed native community/profile-post identity layout, comment reload URLs and shimmer behavior. Installed visual verification requires reloading the extension. Native renderer/endpoint contracts remain undocumented; archive-only fallback markup cannot be guaranteed identical to future Reddit UI, and archive coverage remains incomplete.

# 0.16.2 preview

- Use Reddit's exact banned/suspended and deleted-account artwork in centered profile headers and card author identities. Remove conflicting generic avatars and the superseded retained-photo fallback; chat avatars are unchanged.
- Preserve `/user/.../comments/...` post overlays. Fix Back navigation when Reddit detaches and reconnects native profile views; restore loaded results, ready cards and pagination cursors without repeating archive/card-render requests. Keep the page-session cache bounded and owner-scoped, and clear it on account/settings changes.
- Reuse Reddit's native Snoo logo and expanding/fading halo loader for profile-card loading, with reduced-motion handling and a shimmer fallback before component registration. Native chat startup was verified to use shimmer rows.

Version choice: PATCH to 0.16.2 for existing profile artwork, return-navigation reliability and native loading corrections. No new permissions, persistence or schema change.

Validation: all 538 tests pass, including 66 targeted model/discovery checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave component inspection confirmed the feed's native Snoo halo and the separate chat shimmer templates; the temporary probe and network throttling were removed. Back restoration and artwork behavior are covered by synthetic fixtures; installed end-to-end verification requires an extension reload. Cached views are document-session only, archive coverage remains incomplete, and Reddit's native markup/components may change.

# 0.16.1 preview

- Keep hidden/banned profile notices detached while Notifications and other native overlays/transitions change the URL. Retain the profile until Reddit replaces its underlying DOM; opt-out restores the original notice.
- Use Reddit's default profile-fill silhouette instead of a ban-action hammer. Prevent generic card avatars from replacing it, and fix avatar sizing/hidden styles that could display both icon and photo at once.
- Replace repeated profile archive-text sections and header copy with compact source/status icons. Comment indicators sit at the right of native headers; fallback cards include Reddit's community icon or a matching already-loaded community image.
- Display available recovered deleted-comment text in its native body, including comments already present in Reddit's feed. Preserve current live text and original nodes for opt-out restoration; retain restrictions and avoid invented text when the archive has only deletion markers.

Version choice: PATCH to 0.16.1 for native presentation, navigation and recovery reliability corrections. No new permissions, persistence or storage-schema change.

Validation: all 534 tests pass, including 55 targeted discovery checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave reproduced notification-triggered notice restoration and the overlapping generic-avatar defect, and verified native profile/community glyphs and layout. Installed verification requires reloading the updated unpacked extension. Archive coverage remains incomplete; content captured only after deletion cannot be reconstructed, and Reddit's internal markup/endpoints may change.

# 0.16.0 preview

- Extend native archive recovery to Reddit's explicit banned/suspended-account pages. Overview, Posts and Comments share the existing Arctic Shift opt-in, bounded pagination, native cards and desktop sidebars. Account bans never imply that each post/comment was deleted.
- Replace unavailable-profile initials with Reddit's native ban-fill artwork. Available retained profile photos still take precedence, with the native icon retained on missing/failed photos.
- Detach banned-account notices through nested page parsing, replacements and post overlays. Opt-out restores Reddit's original notice; unrelated forbidden/error pages remain untouched.

Version choice: MINOR to 0.16.0 for archive discovery on an additional account state. No new permissions, persistence or storage-schema change.

Validation: all 529 tests pass, including 50 targeted discovery checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive equality pass for 32 assets. Live Brave inspection verified the example's explicit banned-account marker and Reddit's exact ban-fill artwork. Installed recovery and archive coverage for the example require reloading the updated unpacked extension. Archive availability remains incomplete, and Reddit's native markup/endpoints can change.

# 0.15.2 preview

- Detach Reddit's deleted-account and curated-profile Welcome/hidden-posts notices before paint, including replacements and native post overlays. Restore the original notices on opt-out or leaving the profile.
- Reuse available active-account chat identity avatars and matching native post icons for deleted profiles. Preserve avatar space while loading, reject unsafe URLs and group conversation images, and retain a neutral fallback when no photo is available. Arctic Shift does not provide profile images.
- Restore Reddit's responsive desktop columns and native left navigation on deleted profiles. The right panel shows explicitly labeled counts and date ranges for loaded archive records, with incomplete-coverage context. Keep navigation stable across profile tabs and provide usable links plus explicit Retry on failure.
- Use Reddit's shimmer placeholders for discovery and card loading. Avoid redundant full-document notice scans and repeated archive-statistic DOM writes.

Version choice: PATCH to 0.15.2 for existing profile-view reliability and native interface corrections. No new permissions, persistence or storage-schema change.

Validation: all 526 tests pass, including 71 targeted profile/model/native-bridge checks. All 31 extension/demo JavaScript files parse. ZIP integrity, both aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave inspection verified native layout/navigation markup and the same-origin navigation fragment. Installed verification requires reloading the updated unpacked extension. Retained-avatar recovery depends on existing matching identity hints and active native chat context; archive coverage and Reddit's internal markup/endpoints remain incomplete or changeable.

# 0.15.1 preview

- Fix deleted-profile Posts/Comments requests being rejected after SPA navigation. Brave can retain the original document sender URL while the current tab URL changes. Accept only supported tabs of the same requested profile across both URLs; retain origin, other-profile and unsupported-page checks.
- Replace custom archive tabs, typography and card styling with Reddit's native tab group, panel, feed and server-rendered cards. Use the native main landmark and utility classes, including selected-tab and overflow controls. Arctic Shift remains the discovery provider.
- When Reddit no longer returns a matching card, render archived text inside its native post/comment components and layout. Keep historical vote/action rows inert, retain archive attribution and restrictions, and avoid Retry-only archive rows.

Version choice: PATCH to 0.15.1 for tab navigation and interface consistency corrections. No schema change or new persistence.

Validation: all 518 tests pass, including 73 targeted discovery/provider/native-bridge checks. All 31 extension/demo JavaScript files parse; ZIP integrity, aliases and source/stable-folder/archive equality pass for 32 assets. Installed Brave reproduced the same-profile request rejection, returned 50 archive items on Overview, and confirmed a native post fragment succeeds while an older comment returns a native not-found state. Native tab classes, slots, comment action rows and post action boundaries were inspected against Reddit's actual UI; temporary DOM probes were removed. The updated installed bundle requires manual reload for final navigation/layout verification. Native internal components/endpoints and archive coverage may change.

# 0.15.0 preview

- Handle Reddit's explicit deleted-account pages, which omit both the main landmark and native feed. Add a compact archive-only Overview/Posts/Comments view and restore the native notice on opt-out or navigation. Generic missing-page/network errors stay untouched.
- Automatically search the viewed username only when both discovery and Arctic Shift are enabled. Reuse credential-free, bounded archive requests and explicit pagination. Disabled archives send no requests and show the relevant setting.
- Render attributed archive text, dates, historical scores and source links without Reddit search, status, native-card requests or fabricated live voting controls. Preserve unknown current item status, NSFW/spoiler restrictions, existing results after a failed refresh and incomplete-coverage wording.

Version choice: MINOR to 0.15.0 for the new deleted-account archive view. No storage-schema change or new persistence.

Validation: all 515 tests pass; all 31 extension/demo JavaScript files parse. ZIP integrity, aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave confirmed that the reported profile is deleted and has no native feed. A synthetic Brave preview rendered mixed archived posts/comments in date order. Direct Arctic Shift API probes returned HTTP 403 and Brave blocked direct API navigation; recovery coverage for the example username remains unverified. The updated installed extension requires manual reload. Archive availability/coverage and Reddit's deletion-page markup can change.

# 0.14.2 preview

- Fix profile discovery failing to mount after the early-notice change. Installed Brave tracing showed the shared model executing only in MAIN when both registrations used document start; the isolated discovery script exited before creating its controls/results. Restore its established idle registration for Posts, Comments and Overview.
- Run a uniquely named, model-independent notice guard at document start. It works before the document root exists, suppresses the curated-profile Welcome panel during settings/search and native replacement, respects newer opt-out updates and follows profile SPA routes.
- Return native card hydration to its established startup path; keep native media, controls, virtualization and source/status indicators unchanged.
- Scope profile discovery to New/Hot/Top, Top time range and native view mode. Forward validated sorting to Reddit, discard obsolete same-path query responses, use current post/comment scores for Top and preserve public-search order for Hot without changing native card order.
- Pause native-card/local request queues at existing concurrency and request budgets instead of filling the feed with Retry rows. Cancel paused work on scope changes. Honor server Retry-After with one retry, then expose one paused explanation and an explicit Refresh action; no indefinite rate-limit retry loop. Keep genuine-error Retry buttons from shrinking under long titles.
- Add Reddit-styled feed separators to placeholders and comment fragments that omit them, without duplicating server-supplied rules. Keep separators attached through native virtualization and cleanup. Hydrate nearby discoveries serially in feed order so later cards cannot finish ahead of earlier ones.
- Use Reddit’s own indeterminate progress animation with equal 20px host/graphic sizes and no extra outer rotation.

Version choice: PATCH to 0.14.2 for confirmed initialization, feed-scope and loading regressions. No chat schema change, cache reset or new server sync loop.

Validation: all 511 tests pass, including isolated-model registration timing, model-free/root-free guard startup, opt-out races, profile route changes, sort/range cancellation, ranked post/comment anchors, paused queues, bounded server cooldowns, reversed visibility notifications and separator lifecycle/deduplication. All 31 extension/demo JavaScript files parse. ZIP integrity, aliases and source/stable-folder/archive byte equality pass for 32 assets. Live Brave tracing reproduced the missing isolated model in the previous build. The installed recovery build was verified rendering Posts and Overview on the reported curated profile with the Welcome notice hidden. Live GET probes confirmed Hot endpoints respond successfully; results/coverage vary. A temporary native-loader probe measured a 20×20px host and graphic, no outer animation and Reddit’s own track animation; it was removed. Installed Top/All Time, Hot and New transitions rebuilt the feed without Retry rows. The final separator/serial-hydration follow-up requires another extension reload for live verification. Reddit's internal rendering endpoints and markup may change; archive coverage remains incomplete.

# 0.14.1 preview

- Cooperate with Reddit's native feed virtualization instead of reinserting detached cards after their height placeholders. Preserve loaded cards, native date anchors and duplicate identities as the user scrolls; restore existing content without another hydration request. Recover a card whose request was interrupted while it was virtualized.
- Put the source/status marker just before the native Join and overflow controls. Use distinct, visible crossed-eye, trash, barred-circle and archive icons for profile-omitted activity, verified deletion, verified removal and unverified archive snapshots, with descriptive accessible labels.
- Suppress Reddit's curated-profile Welcome/hidden-posts panel from document start, including while settings/search are pending and after native replacement. Preserve other native empty/error states, restore the panel on opt-out, and wait within existing time/concurrency limits for native component registration. Leave native media markup and controls intact.
- End the attachment animation without a persistent transform/opacity stacking context so native menus can overlap subsequent cards. Play it only on initial hydration, rather than again after scrolling back.

Version choice: PATCH to 0.14.1 for the scrolling/stacking reliability fixes. No chat schema change, cache reset or additional sync loop. The startup notice correction retains 0.14.1 as a follow-up to this preview bundle's existing presentation behavior.

Validation: all 500 tests pass, including native placeholder replacement/restoration, preserved DOM/request counts, virtualized opt-out, interrupted hydration, icon placement/state, pre-result/replaced-panel suppression, opt-out/routes and early component readiness/cancellation. All 30 extension/demo JavaScript files parse. ZIP integrity, compatibility aliases and source/stable-folder/archive byte equality pass for 31 assets. Live Brave diagnosis reproduced repeated native placeholders and reinsertion while scrolling, and confirmed the native virtualization mechanism and persistent animation transform. A live DOM/CSS probe against Reddit's actual panel measured 260px before the guard and 0px after it, including replacement markup; probe changes were restored. First-paint verification of the new document-start registration requires another extension reload. Reddit's internal fragment endpoints and virtualization markup may change; archive coverage remains incomplete.

# 0.14.0 preview

- Fix discovery initialization under the existing trusted-only storage policy. Content scripts receive only normalized feature preferences through the worker; private chat storage remains protected. Preference changes propagate to mounted profile views, and failed initialization offers Retry instead of silently disappearing.
- Discover public comments using Reddit's native author-search partial endpoint, including modern long t1 IDs. Add Arctic Shift comment lookup and source-safe post/comment identity, parent links and independent cursors.
- Show a bounded initial selection automatically: posts on Posts, comments on Comments, and both on Overview. Preserve partial successes, cancel stale route work and hide the native empty placeholder only while additional activity is visible.
- Merge missing discoveries directly into Reddit’s feed instead of a separate results block. Recognize native profile-comment IDs, preserve pinned cards and native ownership, defer older results past the loaded date window, and remount cleanly when Reddit replaces its feed. Use compact status/icon controls.
- Replace simplified result cards with Reddit’s real profile-feed post and comment fragments, hydrated by its own component loader. Preserve native media, icons, action controls, vote state and observed view mode; keep authenticated markup in the page world. Hydrate nearby cards at bounded concurrency, remove duplicate native IDs, and show native placeholders with reduced-motion-aware attachment instead of a visible checking message.
- Fix the popup's intrinsic sizing with a stable 360px root/body width, shorten descriptions and clarify that discovery includes posts and comments. Retain chat controls, settings and caches.

Version choice: MINOR to 0.14.0 because this adds public and archived comment discovery alongside reliability/UI corrections. No chat schema change or cache reset.

Validation: all 492 tests pass. All 26 extension/preview JavaScript files parse. Live Brave diagnosis reproduced the blocked content-script storage read, verified successful Reddit post and comment requests on the reported curated profile, and received a successful Arctic Shift post page. The synthetic popup preview measured a single-line brand, 360px body width and 542px body height. ZIP integrity and source/stable-folder/archive byte equality pass for 31 assets. Archive coverage remains incomplete; Native post and comment fragment endpoints and component hydration were verified in live Brave without voting or posting. Final installed-build verification follows reloading the extension. Internal native endpoints may change; unavailable cards offer an explicit retry/link rather than imitation actions.

# 0.13.0 preview

- Rebrand the extension as **Reddit Tweaks**, with orange sliders artwork and separate Posts and Chat sections. Keep the existing unpacked installation path, account-scoped chat data, and cache-management actions.
- Discover additional public posts from modern Reddit profiles through bounded author-search requests. Insert native-styled results inline, deduplicate against loaded posts, and use small source/status icons without guessing whether an author hid a post.
- Add opt-in Arctic Shift profile and post-ID lookups. Keep archived text in separate, collapsed snapshots, prefer current Reddit metadata, and require a verified status before labelling a post deleted or removed. Preserve NSFW/spoiler restrictions from both sources.
- Validate routes, source records, settings and cursors; bound response sizes, concurrency, pagination and timeouts. Drop stale SPA results, recheck opt-out after queueing, and respect rate limits. No archive bodies, browsing history, new credentials or chat sync loops are persisted.
- Name new ZIP exports Reddit Tweaks while retaining the stable `artifacts/reddit-chat-search/` folder and compatibility ZIP alias. Validate registered CSS assets during packaging.

Version choice: MINOR to 0.13.0 for post discovery and the expanded extension interface. No chat storage schema change or cache reset.

Validation: all 471 tests pass (435 existing plus 36 new). All 25 extension/preview JavaScript files parse. ZIP integrity and source/stable-folder/archive byte equality verified for 31 assets. Brave inspection confirmed current public profile/feed and post component structure; synthetic wide/narrow and light/dark previews were inspected. The reference clone and live research remain ignored.

Limitations: full live extension recovery was not verified after a browser reload. Direct navigation to Reddit's search JSON endpoint was blocked by the client; no restriction was bypassed. Arctic Shift coverage and availability vary, and public API requests may fail or be rate limited. This release covers modern Reddit public profile Overview/Posts views and post details, not private Hidden lists, private communities, comment discovery or old Reddit. A selection or failed lookup never establishes complete history or current deletion.

# 0.12.8 design test

- Exclude Reddit’s temporary local message IDs from new saved captures, native-cache import and individual search. Observe native local-echo updates so confirmed messages are captured under their server-assigned IDs.
- Hide previously saved temporary records from global results, room results, summaries and message counts without clearing the stored event ledger. Reject a stale temporary-result jump locally rather than calling Reddit’s selected-message endpoint with an invalid ID.

Version choice: PATCH to 0.12.8 for a confirmed message-navigation bug. No storage schema change, cache reset or changes to Reddit’s send methods.

Validation: all 435 tests pass. New regressions cover pending capture, confirmation capture, native-cache reconciliation, legacy saved entries, room search and navigation with no server request. All extension JavaScript parses; archive integrity and source/stable-folder/archive byte equality verified. Live Brave inspection found the reported HTTP 400 M_INVALID_PARAM response for a tilde-prefixed event ID and confirmed Reddit’s local-ID generation in its running client. After reloading the existing Brave installation, the affected window ran 0.12.8, displayed saved results without the navigation error, excluded temporary IDs from the returned search page and rejected a synthetic temporary jump locally. No messages were sent during diagnosis; synthetic fixtures cover sending/confirmation transitions. Saved history remains incomplete.

# 0.12.7 design test

- Isolate native-cache importer abort/error events from Reddit’s database handlers. The running Reddit client closes its backend when an abort reaches the database; importer read failures, timeouts and cancellations must not shut down Reddit’s own connection. Unsupported-schema reads now finish without an unnecessary abort.
- Stop a partial import if Reddit replaces its database handle, and explain a closed connection without marking the failed pass complete. Existing saved messages remain available; native reconnection and explicit Refresh can retry the check without a second sync loop or database reset.
- Reopen the extension-owned database once if transaction creation encounters a closed handle. Discard connections on abnormal closure and yield them on version changes. Retry only before requests have started, preserving queued writes, account isolation and stored data.

Version choice: PATCH to 0.12.7 for database connection reliability. No storage schema change or cache reset.

Validation: all 429 tests pass, including reproduced abort propagation with Reddit-equivalent shutdown handling, native handle replacement, closed native handles, extension read/write recovery, abnormal closure and version-change handling. All extension JavaScript parses; archive integrity and source/stable-folder/archive byte equality verified. Live Brave inspection confirmed Reddit’s abort/close handlers, and an isolated readonly cancellation left its connection usable with those handlers unchanged. After reloading the existing Brave installation, version 0.12.7 completed native-cache reconciliation, retained saved messages, returned saved-search results without cache/saving errors and left Reddit’s database readable. The original intermittent error was not reproduced in the fresh live tab; synthetic regressions reproduce the failure mechanism. Saved-history coverage remains incomplete.

# 0.12.6 design test

- Reconcile Reddit’s open local cache without waiting for its startup-sync promise. Saved message searches and previews remain available while captured/cache updates are saved. Each page attachment still checks for messages, edits and redactions missed while the extension was inactive; it does not start a server-history build or another sync loop.
- Label reconciliation Checking cache, expose checked-record progress in the status tooltip, and show a paused explanation when a check fails. Refresh retries a failed cache check. Empty partial caches explain that messages can still arrive.
- Bound stalled native cursor transactions, extension read/write transport and idle reconciliation. Preserve committed data and pending captures, stop the busy state, and never mark a failed pass complete. Failed search reads replace placeholders with a recoverable state and do not restart on ordinary native renders.

Version choice: PATCH to 0.12.6 for startup/cache reconciliation reliability. No storage schema change or cache reset.

Validation: all 423 tests pass. New regressions cover an open native database with a startup-sync promise that never resolves, a stuck native cursor, stalled transport, a stalled reconciliation with explicit retry, sustained durable-write progress that keeps a large active import alive, and the real global interface showing committed results while native-cache writes are deliberately blocked. All extension JavaScript parses; archive integrity and source/stable-folder/archive byte equality verified for 26 assets. Validation is synthetic; live Reddit startup recovery was not measured. Saved history remains incomplete.

# 0.12.5 design test

- Keep individual chat result lists bounded to the visible region, with cached measurements and reusable avatars. Scrolling no longer grows and rebuilds an increasingly large list. Incoming result updates wait until scrolling settles; new messages above the viewport preserve the visible message.
- Load additional global saved-result pages quietly, without restarting the main refresh animation or replacing existing rows. Keep the match count visible during unrelated conversation checks and reduce per-frame list scanning and day-header rebuilding.
- Keep the loading placeholder visible while individual search checks saved messages and native history, including searches started through sender/date filters, so a temporary empty read does not flash “no results.”

- Share control sizing between global and individual search: native-header-based field height, input padding and type, filter/date glyphs, menu widths, option rows and sender tags.

Version choice: PATCH to 0.12.5 for scrolling performance and loading reliability fixes. No storage schema change. The cosmetic sizing amendment retains this version.

Validation: all 417 automated tests passed, including large synthetic lists, scroll anchoring, pagination, delayed reads, keyboard navigation, and native identity updates. JavaScript syntax and archive integrity/source-to-stable-folder equality verified. Synthetic headless Chrome verifies matching field, icon, input, menu and option-row geometry at 320/420/820 px panel widths and 40/52/64 px native header heights. Live Reddit/Brave performance was not measured; saved-history coverage remains incomplete.

# 0.12.4 design test

- Put a Custom date choice first in before/after suggestions and open the app calendar in that operator mode. Applying a day keeps its full before/after date expression in the search. Match secondary menu row spacing and text sizing to the primary menu.

Version choice: PATCH to 0.12.4 for a user-visible search interaction improvement. No storage schema change.

Validation: changed JavaScript syntax and package integrity checked; automated tests were not run for this quick edit.

# 0.12.3 design test

- Put filter autocomplete icons at the left without menu-arrow rotation. Date suggestions retain the full before/after date token alongside a calendar icon and concise labels such as Today, Yesterday, This month and This year.

Version choice: PATCH to 0.12.3 for a user-visible search interface correction. No storage schema change.

Validation: JavaScript syntax and package integrity checked; automated tests were not run for this quick edit.

# 0.12.2 design test

- While a global or individual filter menu or calendar is open, any click outside that surface dismisses it and is consumed, preventing accidental activation underneath.

Version choice: PATCH to 0.12.2 for a user-visible interaction fix. No storage schema change.

Validation: changed JavaScript syntax and package integrity checked; automated tests were not run for this quick edit.

# 0.12.1 design test

- Prevent outside clicks from activating Reddit UI underneath an open global or individual filter menu. The outside pointer now dismisses the menu and its matching click is suppressed.

Version choice: PATCH to 0.12.1 for a user-visible interaction fix. No storage schema change.

Validation: JavaScript syntax and package integrity checked; automated tests were not run for this quick edit.

# 0.12.0 design test

- Add matching icons to every applied filter tag in global and individual search, retaining sender avatars. Remove the orange applied-filter number badges from the filter icon and scope tabs. Give both filter menus full-width icon rows, explicit selected checks, contextual saved-data counts, Reset, active-filter accents and removable tags. Open Chat type, Status and Sort in separate option views, with the same flat, borderless rows as the main menu; Escape returns to the main menu before closing it. Apply choices immediately. Keep search text and dates when resetting menu filters.
- Separate chat type from status so Groups and Unread can be combined. Move Requests into Status, use Any consistently and explain that Unavailable means deleted or suspended rather than blocked. Show unavailable-account indicators as icons with full tooltips.
- Remember chat/status/sort choices per tab for the current account and page session. Add A–Z and Unread first in People, keep Relevant in message scopes, hide the calendar in People, shorten the placeholder and anchor popovers to their controls.
- Support compact completion for every implemented operator: from, has, before and after. Selecting an operator inserts it; sender values use People-style rows with avatars, attachment values use matching icons, and dates have suggestions. Complete filters become removable tags. Before excludes the chosen day; after includes it. Multiple senders remain alternatives and other conditions combine with AND.
- Limit menus and autocomplete to Reddit-relevant media; remove Video, Audio and File choices. Expose the same supported attachment filters in global and individual search: Images, GIFs and Links. Calculate counts during the existing local-search traversal while retaining text/sender/date/room conditions and excluding the currently selected attachment type. Keep selected zero-count options removable.
- Resolve You from the native account profile even before any own messages have been imported. Reuse already-loaded native profile data, prefer the current avatar, retain the saved fallback and clear retained identity on account changes or saved-data removal.

Version choice: MINOR to 0.12.0 for expanded shared filter menus and operator completion. No storage schema change, extra profile requests, sync loop or background history download. Reload the extension and refresh existing Reddit tabs.

Validation: all 414 tests pass. Coverage includes native/saved self-profile precedence and isolation, composed type/status filters and contextual counts, operator completion, selected-zero removal, Reset with retained text/dates, per-tab state and accurate counts without extra queries, dormant message-filter controls in People, submenu Escape/Back focus restoration, native jumps, redactions through the current global interface, and existing cache/history/media/scroll regressions. All 20 scripts parse. Synthetic Chrome checks 820/420/320 px layouts: global and individual menus stay within their chat width without horizontal clipping or an internal scrollbar; Chat type, Status, Sort and Contains use the same compact secondary view with full-width option rows and a Back control. Contains offers Any, Images, GIFs and Links. Archive CRC integrity and source/stable-folder/ZIP byte equality pass for all 26 assets; the convenience archive matches.

Limitations: option counts describe currently cached data, not complete server history. Unknown counts remain selectable; zero saved-match counts do not prove that older inaccessible messages do not exist. Per-tab choices last for the page session and are cleared on account changes. Visual checks use synthetic fixtures rather than the signed-in browser. Only operators supported by Reddit chat's captured data are offered; Discord-specific polls, embeds and forwarding are not implied.

# 0.11.0 design test

- Integrate individual-chat search into the native header area with a back button and a full-width field. Preserve the original header nodes, handlers and inline display values; restore them on Back, close, room changes and teardown. Match native header height and remeasure it when the chat width changes.
- Match both search toolbars to the native room-header height, measuring unscaled CSS pixels and following header replacement, hiding and resize. Keep icon-only Filters and Date inside both search fields. Individual Filters contains From and Sort, with avatar-backed multi-sender choices. Keep removable applied tags below the field and preserve typing, debouncing and native message jumps. Remove the separate scrollable filter row.
- Open the existing Reddit-accented calendar directly. Retain its built-in quick ranges, date modes, cached-day hints, future-date limits, explicit Apply and draft cancellation. Remove the duplicate preset-first date menu and its unused implementation.
- Correct refresh-wheel rotation: compact styles keep the SVG and rotating wrapper at the same 12 px size, with the circular arc centered in its viewBox. Use global-style gray keyboard previews in room results, retaining only the faded orange left rail with matching 8 px insets.
- Show recent successful room searches in the empty search view, with keyboard reuse. Bound this page-session history to five queries per room and forty account/room entries. Clear it on account changes. Clearing text returns to this view without closing search.

Version choice: MINOR to 0.11.0 for the header-based search flow. Keep this version for follow-up control/layout refinements, restored direct calendar access and cosmetic rotation/preview corrections. No storage schema change, new sync loop or background history download. Global search and image presentation are unchanged. Reload the extension and refresh existing Reddit tabs.

Validation: all 387 tests pass. Coverage includes native header size/transform/replacement handling, restoration, Back/Escape, recent-search account isolation and keyboard reuse, sender alternatives, filter/sort states, direct-calendar Apply/cancellation, quick ranges across month boundaries and existing search/storage/navigation regressions. All 20 scripts parse. Synthetic headless Chrome checks 820/420/320 px rooms: search starts at the native header position, both toolbars equal the 49 px native header with matching 37 px fields, icon-only filters/date stay within the fields, the direct calendar stays bounded with four quick ranges, and the full-width result view reaches the room bottom. Refresh centers remain fixed at 0/90/180/270 degrees, and keyboard previews resolve to the shared neutral gray at all three widths. Archive integrity and source/stable-folder/ZIP equality pass for all 26 assets; the convenience ZIP matches.

Limitations: recent room queries last only for the current page session and are recorded when opening a match. Live Reddit authentication and exact-event accessibility still govern message retrieval. Visual checks use synthetic fixtures, not the signed-in browser. Date menus remain compact and bounded to the chat panel.

# 0.10.0 design test

- Remove startup navigation waits on initial sync and the bulk saved-cache pass. Keep authentication/router readiness, exact-event failure handling and interactive request coordination. Skip redundant native event lookup when that event is already loaded; reveal visible room messages directly.
- Make individual search a full-width results view over the thread with one result status. Remove the extra close button and Ctrl+F-style counter/arrows. Preserve the native identity header, show an active search icon and support room-scoped Ctrl/Cmd+F. Esc peels the calendar/filter popup, results, then search.
- Place global-sized filter/calendar icons inside the search field, with sender/sort options in the filter menu and independently active filters. Use an icon-only Refresh with stable busy animation and remove extra section borders. Preserve multi-sender selection and typing shortcuts. Use actual sender avatars/names with the same native font/spacing measurements as global results, match-centered three-line snippets, stronger orange highlights, sticky day headings, lightweight scrollbars and a quiet incomplete-coverage footer. Native message navigation expands recognized Read more controls and briefly paints hits without rewriting message text.
- Share the exact global Refresh SVG, dimensions, animation and loading placeholders with room search, including immediate typing feedback and pending history with no matches. Position sender/sort menus below their filter control and keep them inside narrow rooms.
- Reset result scroll, keyboard selection and stale mobile return anchors for new queries, filters or sort orders. Preserve same-query refresh/mobile-return positions. Background reads anchor the viewport at completion so scrolling during a read is not undone. Coalesce passive scroll events per frame, avoid rebuilding filters on the scroll path and postpone capture-triggered refresh work during active scrolling.
- Keep selected senders in a separate removable tag rail, matching global search. The field remains one line and contains only editable text; filter state stays separate from that draft.
- Default the room calendar to On, expose Today/Yesterday/Last 7/Last 30 days, disable future days, mark cached message days, use a neutral disabled Apply state and anchor it to the date control. Earlier uncached dates remain selectable. Global calendar behavior is preserved.
- Compact recognized settings/popout native buttons into an accessible ⋯ menu in rooms at most 440 px wide. Retain native handlers and restore original presentation when wide or destroyed.

Version choice: MINOR to 0.10.0 for the substantial individual-search interface expansion. Follow-up control, loading and scroll corrections stay in this unreleased bundle. No storage schema change. Reload the extension and refresh existing Reddit tabs.

Validation: all 382 tests pass, including query-position resets, scrolling during in-flight reads, coalesced scrolling, shared room/global placeholders and Refresh, menu anchoring, blocked-startup navigation, native-event reuse, sender/date/sort chips, keyboard layers, exact local jumps, shadow-text highlights, calendar bounds and native action restoration. All 20 extension scripts parse. Synthetic headless Chrome checks 820/420/320 px room widths: results span the room and reach its bottom, controls and quick ranges fit, sender tags stay outside the single-line field, the clear button stays contained, menus align 4 px below the field and remain inside the room, seven placeholder rows show during pending history, Refresh remains 20 × 20 px, and future days are disabled. Archive integrity and source/stable-folder/ZIP equality pass for all 26 assets; the convenience archive matches.

Limitations: uncached/inaccessible events can still require or fail Reddit requests; server cooldowns remain respected. Native action grouping and Read more expansion only apply to recognized accessible controls. Per-word thread highlights require the browser Custom Highlight API and accessible text roots. Cached-day dots describe available saved data, not complete history. Rendered checks use synthetic fixtures, not a signed-in Brave session. These checks verify bounded scroll work and position preservation; live-device frame rates have not been measured.

# 0.9.1 design test

- Keep the restored month-grid interaction and refine its structure: flat mode tabs with the same solid active/faded hover underline as People/All/Messages, softly squared date selections, softer range fills, compact month/year selectors and footer controls, and orange keyboard cues instead of inherited blue outlines. Use #ff4500 for selected dates and Apply, with neutral text on active mode/chooser labels. Selected choices have a solid side accent; keyboard previews have a faded accent.
- Reduce the full picker to 264 px and keep the narrow layout at 228 px. Tighten spacing and omit only unused trailing weeks, retaining real four-, five- and six-week months and every selectable day. A synthetic five-week layout measures 300 px high instead of 372 px; the compact layout measures about 268 px instead of 304 px.
- Tighten individual-room search results to a 2 px gap below the search field in full/floating/narrow layouts. Reserve a fixed tabular-number slot for the navigation match count so loading or moving through matches cannot resize the search field. Preserve the full counter text and existing matching/navigation behavior.
- Add a quiet clock-labeled Quick ranges control to the existing Clear/Apply footer. Five options replace the calendar area without opening an external dropdown: Last 7 days, Last 30 days, This month, Last month and This year. Show compact date previews. Presets use inclusive local-calendar periods, including leap months/year boundaries, and only modify the draft until Apply. Escape returns to the calendar; dismissing the draft restores the applied dates.
- Preserve On/Before/After/Between semantics, explicit Apply/Clear, strict validation, removable date chips, date-grid and chooser keyboard navigation, chat-bounded placement and listener cleanup. Keep the bulky date-entry experiments removed. Scope runtime changes to the date-picker and individual-room search styles; search, capture, cache, image and retained-profile behavior is unchanged. No dependencies, additional server requests or storage schema changes.

Version choice: keep 0.9.1 for refinements to the current unreleased calendar bundle, including restoring quick periods already trialed in that bundle. Historical releases and independent tooling versions are preserved.

Validation: all 351 tests pass, including 11 calendar and 71 unified-interface tests. Fixtures cover inclusive presets, leap months/year boundaries, draft isolation, Apply/cancellation, quick-menu keyboard navigation, all needed calendar weeks, existing date semantics and saved-search integration without extra native requests. All 19 JavaScript scripts parse. Synthetic headless Chrome verified full/compact light/dark layouts, exact orange selection color, no focus outline, bounded quick-menu/footers and no horizontal overflow. A rendered individual-room fixture confirms a 2 px result gap and identical field width/right edge for empty, small and five-digit counters at 820, 420 and 320 px room widths. No signed-in Brave artifact check was performed. ZIP integrity and source/stable-folder/archive equality pass for all 25 assets; the convenience ZIP matches the versioned export.

Limitations: quick periods use the browser's local date and calendar; named month/year periods include their full end date. Short chat windows scroll the picker contents. Reload the extension and refresh Reddit to apply this export. Saved-history coverage remains incomplete; no global-history build or persistent history cursors are added.

# 0.9.0 design test

- Extend recovered native identities to retained avatars. Pass the saved safe HTTPS reference to Reddit’s room-icon/profile controllers and user-avatar renders, including chat-list rows, room headers, introductions and message senders. Newly connected native components receive the presentation override before their first render. Reuse avatar models and bypass native avatar cache-miss lookups when a retained reference is available.
- Preserve original profile objects, account/NSFW/community-agent flags and component properties. Overrides are tied to the authenticated account and native user IDs, follow recycled rows, update when only the avatar changes and restore native behavior when cleared. Reject credential-bearing and non-HTTPS avatar references. No additional directory, profile or history requests, storage schema change, history build or sync loop; the browser loads the retained image reference normally.
- Add a compact unavailable-account icon beside conversation names in All and Messages results, with a descriptive tooltip and accessible label. Keep timestamps on their existing line and update cached rows when availability changes. Group messages identify the unavailable sender, preserving the group’s own identity. People/chat rows keep their existing Unavailable text.
- Retain 0.8.7’s immediate loading placeholders and Down Arrow entry from the input/scope tabs into results, including cached drafts, pending message queries, dismissed menus and empty results.

Version choice: MINOR to 0.9.0 for the requested expansion of retained-identity presentation across native chat and global results. Storage schemas and independent tooling versions remain unchanged; existing saved data is reused.

Validation: all 346 tests pass, including 9 native presentation and 69 unified interface tests. Synthetic fixtures cover full/floating layouts, first connected avatar render, stable avatar models, original profile preservation, account switching, clearing/recycling, unsafe URLs, avatar-only updates, availability changes and group-sender labels. All 19 JavaScript scripts parse. ZIP integrity and source/stable-folder/archive equality pass for all 25 assets; the convenience ZIP matches the versioned export. No signed-in Brave artifact check was performed.

Limitations: restoration requires a retained, accessible avatar reference; an old photo cannot be reconstructed if no reference was saved or the image is no longer served. Unavailable does not distinguish deletion from suspension or banning. Native integration is based on the inspected client’s presentation methods and synthetic fixtures; future native component changes may require updates. Reload the extension and refresh Reddit to apply this export. Saved-history coverage remains incomplete, and persistent global-history cursors/full-history building are not added in this release.

# 0.8.7 design test

- Trial compact day/month/year segments instead of a month grid in global and individual message search. Between shows From and To; On, Before and After show a single row. A small themed condition dropdown replaces a row of mode tabs, retaining Reddit accents and a narrower floating layout.
- Support typing, complete-date paste (ISO or DD/MM/YYYY), arrow-key stepping, Home/End and segment navigation. Validate Gregorian dates, leap years, four-digit years and range ordering; preserve the applied filter when dismissing unfinished edits. On/Between remain inclusive and Before/After exclude the selected day. Apply/Clear and removable date chips reuse the existing search/history paths.
- Remove People scans, count recalculation and result-list rebuilding from ordinary keystrokes. Global result work waits for the existing 180 ms pause; room-local matching and progressive redraws wait 150 ms. Capture, completed-query, media and resize redraws defer while typing. Retain cached result nodes during that interval, showing a bounded loading placeholder immediately in People, All and Messages. Reuse that placeholder across keystrokes and progress updates; use Reddit’s native shimmer when registered, with a themed reduced-motion-aware fallback.
- Explicit filter/operator choices and Enter/arrow navigation can flush immediately. Clearing, closing, changing accounts or switching rooms cancels pending input timers; a dismissed timer cannot reopen the menu. Empty room queries skip matching. Global saved-message queries continue in the existing extension worker.
- Down Arrow moves focus from the search field or scope tabs into the result cards in People, All and Messages. Reopen dismissed results, handle cached drafts immediately and retain navigation through pending message queries; subsequent arrows move between cards without opening them.
- Keep the date experiment separate in commit 1378c4e and typing improvements in fa72432, making date-only rollback possible. No new dependencies, server requests, history rebuild, storage schema or sync loop.

Version choice: PATCH to 0.8.7 for the compact replacement of existing date controls and typing responsiveness; keep 0.8.7 for the requested placeholder and keyboard-navigation amendments. Independent tooling versions and storage schemas remain unchanged.

Validation: all 342 tests pass. Coverage includes segmented entry/paste, keyboard navigation, invalid and reversed dates, leap-day corrections, draft cancellation, existing whole-day search semantics, no per-keystroke People scanning or result DOM rebuilds, late query/capture/resize updates during typing, immediate keyboard navigation, dismissed-timer cleanup, immediate placeholders in all three scopes, placeholder reuse, native/reduced-motion selection and arrow entry from the field/tabs through cached and pending searches. All 19 JavaScript scripts parse. Synthetic headless Chrome layouts were reviewed for full-size, floating and dark date controls; no signed-in Brave artifact check. ZIP integrity and source/stable-folder/archive equality pass for all 25 assets; the convenience ZIP matches the versioned export.

Limitations: this is an experimental numeric DD/MM/YYYY editor; traditional month-grid browsing is intentionally replaced. People and individual-room matching still run in the page after debouncing, and native Reddit work can still occupy that thread. Reload the extension and refresh Reddit to apply this export. Saved-history coverage remains incomplete.

# 0.8.6 design test

- Preserve the visible result’s screen position when decoded image previews change height. Commit updated row/spacer geometry before assigning a corrected scroll offset, avoiding browser clamping against the old shorter list near the bottom.
- Reuse virtual spacer nodes and temporarily reserve the track while reconciling rows, avoiding transient shortening. Remeasure only changed image rows and preserve unrelated cached heights. Skip redundant scroll assignments so ordinary scrolling is not interrupted.
- Align the outer message result at the top as well as its avatar/name content. Images in a visible row expand downward; images below the viewport do not move it. Individual-chat search captures its visible row before changing image geometry and compensates for changes above it, with browser scroll anchoring disabled on that result menu.
- Keep existing dimension hints, shimmer, proportional previews, search/import behavior and native chat navigation. No additional network requests, storage schema or history rebuild.

Same-version cosmetic follow-up: rotate Refresh inside a fixed 12 px HTML wrapper with an explicit center, a 3D transform and a busy-only compositor hint rather than rotating the SVG paint surface directly. Keep the existing linear cadence, idle icon, reduced-motion behavior and truthful activity labels. This amendment adds no JavaScript animation loop or data requests. All 57 unified interface tests pass; live animation FPS was not profiled.

Version choice: PATCH to 0.8.6 for image-loading scroll stability; keep 0.8.6 for the requested animation amendment.

Validation: all 328 tests pass. A synthetic browser-clamp regression reproduces a 64 px visible-row shift with the prior implementation and passes with the fix. Fixtures cover image changes above/in/below the viewport, near-bottom restoration, persistent spacers, unrelated height retention, individual-search anchoring and capture-before-reveal ordering. All 19 JavaScript scripts parse. Archive integrity and source/stable-folder/ZIP equality pass for all 25 assets; the convenience ZIP matches the versioned bundle. No Brave artifact check was performed.

Limitations: validation uses synthetic layout and scroll-clamping fixtures rather than signed-in browser pixel rendering. Missing or incorrect dimension hints can still require a first-load preview size correction; the surrounding viewport is anchored during that correction. Reload the extension and refresh Reddit to apply this export. Saved-history coverage remains incomplete.

# 0.8.5 design test

- Replace the raw “Extension context invalidated” error and perpetual search label with a clear instruction to refresh the Reddit tab after the extension is reloaded or updated. Preserve loaded results, latch the discarded transport state and stop repeated worker calls, capture buffering and scheduled search retries in that tab.
- Give Refresh a busy indicator and accessible activity label for local searching, preview reads, native-cache import and capture saving. Show a compact import status while it is active; honor reduced motion. Import and saving progress notifications update controls without rerunning message queries or rebuilding the directory.
- Keep the existing cache policy: message Refresh rereads saved results and retries pending writes rather than forcing another full native-history import. A page refresh reconnects scripts and performs the existing local reconciliation; no new server requests or sync loop.

Version choice: PATCH to 0.8.5 for stale-tab recovery messaging and activity feedback. Storage schemas and independent tooling versions remain unchanged.

Validation: all 325 tests pass, including a discarded runtime rejecting once without repeated capture/search transport calls, preserved visible matches, activity during a deferred local query, import start/end feedback without additional searches or directory reads, and manual Refresh returning to idle. All 19 JavaScript scripts parse. Archive integrity and source/stable-folder/ZIP equality pass for all 25 assets; the convenience ZIP matches the versioned bundle. No Brave artifact check was performed.

Limitations: browser-invalidated extension scripts cannot reconnect themselves; existing Reddit tabs must be refreshed after an extension update. The live reported tab was not inspected, so a particular browser reload/update event is not attributed. Saved-history coverage remains incomplete.

# 0.8.4 design test

- Replace fixed 96 × 64 cropping with proportional message previews up to 128 px wide and 128 px high. Keep small returned images small and preserve compact People previews within 28 × 20 px. Use automatic image height and contain rendering, without stretching or cover cropping.
- Retain validated native image dimensions during the existing message import, history reads and event captures. Bind hints to the chosen preview source, including separate thumbnail metadata when that source is used. Reserve the final preview dimensions before assigning its image URL; no additional history pass or metadata request.
- Reuse Reddit’s registered faceplate-shimmer component for loading images, with a themed fallback when it is unavailable and static placeholders for reduced motion. Keep the loading image hidden inside the same sized placeholder and reveal it when decoded; errors stop the shimmer and retain a stable fallback.
- Learn missing or incorrect dimensions from decoded previews and batch at most 100 small account-scoped layout updates. Reuse these hints on later visits without saving image bytes, broadcasting message changes or restarting active searches. Protect edited/redacted attachments against stale load callbacks and preserve learned proportions during native replay.
- Reuse existing image nodes and notify layout when an active cached image loads offscreen as well as onscreen. Batch image-load measurements per frame, invalidate image-row measurements and preserve virtual scroll anchors without rerunning search or directory loads. Cancel queued image-layout work on suspension, account/cache reset and destruction.
- Align message-result avatars with the conversation heading at the top, above image content. Sender prefixes remain above message images. Scale thumbnail requests retain their existing 384 × 256 bounds and source reuse.

Version choice: PATCH for uncropped preview proportions, stable image placeholders and avatar alignment. This correction amends the existing 0.8.4 bundle without another version bump. Storage schemas and independent tooling versions remain unchanged.

Validation: all 322 tests pass. Coverage includes proportional image fitting, native metadata through both import compaction passes, edited/redacted images, decoded-hint persistence across reloads, account/source isolation, batched writes without search notifications, native shimmer reuse, reduced motion, error placeholders and virtual measurements without search restart or scroll movement. All 19 JavaScript scripts parse. ZIP integrity and source/stable-folder/archive equality pass for all 25 assets; the convenience ZIP matches the versioned bundle. No Brave artifact check was performed.

Limitations: images with missing or incorrect metadata can resize on their first decoded load; learned hints reduce this on later visits. Native shimmer reuse depends on Reddit registering its component before the preview is created, otherwise the themed fallback is used. A larger request cannot recover detail absent from a low-resolution source. Pixel rendering in the signed-in browser was not checked; tests use synthetic events/layout fixtures. Reload the extension and refresh Reddit to apply this export. Saved-history coverage remains incomplete.

# 0.8.3 design test

- Request 384 × 256 scale previews through Reddit’s existing media conversion helper, using the original image reference when available instead of first enlarging an already-small thumbnail. Prefer the safe converted reference during storage compaction and fall back to another valid reference if conversion or URL validation fails.
- Upgrade recognized credential-free Reddit Matrix thumbnail URLs at display time, including references already saved by older versions. Preserve the media identifier, avoid reducing existing larger dimensions, and leave arbitrary CDN/download URLs unchanged. No history reload or extra profile/directory requests.
- Stack You/group-sender prefixes above message-result image previews in global and individual search. Keep compact People summaries inline. Reserve the extra sender-line height in the virtual list and retain measured-height correction.
- Keep the existing 96 × 64 display size, lazy loading, bounded node cache, failure placeholders and unchanged-row image reuse. Higher-resolution image responses may contain more bytes; image bytes remain outside extension storage.

Version choice: PATCH for image-quality and sender-layout corrections within the existing preview feature. Storage schemas and independent tooling versions remain unchanged.

Validation: all 314 tests pass; all 19 extension JavaScript files parse. Coverage includes original-reference selection, 384 × 256 native conversion, safe fallback on conversion failure, existing-cache URL upgrades, credential rejection, unchanged external URLs, stacked/compact CSS layouts, image-node reuse, sender-row height, import compaction, edits and redactions. ZIP integrity and equality with source and the stable unpacked folder pass for all 25 assets; the convenience ZIP matches the versioned export. No Brave artifact check was performed.

Limitations: requesting more pixels cannot restore detail absent from the source. Old cached references to a separate low-resolution thumbnail file cannot reconstruct the original image reference until Reddit supplies that event again. Live server image quality and signed-in rendering were not checked; validation uses synthetic events and layout fixtures. Reload the extension and refresh Reddit to apply this export. Saved-history coverage remains incomplete.

# 0.8.2 design test

- Reconcile sidebar routing and header hydration before paint, bypassing the ordinary 120 ms UI debounce for those changes. Mobile Back restores retained search chrome and existing matches alongside a ready native sidebar.
- Observe the native sidebar header’s size as well as the sidebar. Reveal search when the header is hydrated and laid out, and measure the result viewport only after mounting beneath it. Retain the scroll anchor while readiness is pending.
- Use at most two route-local animation-frame follow-ups to discover shadow roots attached during the native render. Keep the existing discovery heartbeat as a fallback; add no network polling or server requests.
- Keep ordinary timeline mutations batched and exclude extension-owned changes across shadow boundaries, avoiding repeated discovery caused by search redraws. Cancel scheduled restore work on page unload.
- Return to already-ready matches without another local message query or directory load. Query/filter/scope/page state, account isolation and the compact nonwrapping count layout remain intact.

Version choice: PATCH to 0.8.2 as requested, for smoother mobile search restoration. Storage schemas and independent tooling versions remain unchanged.

Validation: all 310 tests pass. Lifecycle fixtures verify hidden/replaced sidebar restoration on the first frame, no additional query/directory load on return, immediate reveal after header layout, next-frame shadow hydration, preserved scroll/filter state, ordinary timeline batching, ignored search redraws and unload cancellation. All 19 JavaScript scripts parse. Archive integrity and source/stable-folder/ZIP equality pass for all 25 assets; the convenience ZIP matches the versioned bundle. No Brave artifact check was performed.

Limitations: search still needs Reddit’s native header and mounting structure to become ready. Unusually late unobserved shadow hydration can use the existing discovery fallback. First-frame behavior is verified with synthetic lifecycle fixtures, not a live signed-in mobile rendering session. UI restoration remains within the current document/account; saved-history coverage remains incomplete. Reload the extension and refresh Reddit to apply this export.

# 0.8.1 design test

- Keep People/All/Messages labels centered in equal-width columns without clipping Messages. Reserve counts below labels in narrow panels, and beside labels when the chat container has enough room. Count changes do not shift the labels.
- Wait for Reddit’s actual header to hydrate and acquire layout before revealing the search host. Mount sidebar search beside the native header wrapper and individual message search beneath its header, avoiding the initial above-header flash in full-screen, floating and narrow/mobile chat.
- Suspend hidden or detached mobile sidebar controllers when opening a result. Back to the same account and chat surface restores query text, applied filters, scope, loaded results and the scroll anchor. Keep native message navigation running while the sidebar is away.
- Refresh already-browsed local result pages after capture updates instead of resetting to the first 500 matches. Anchor the viewport by stable room/event IDs while retaining visible results during the local refresh.
- Bound detached controller retention to four chat surfaces within the current document, destroy evicted controllers, and clear retained state on account changes and page unload. No new server requests, sync loop or storage schema.

Same-version cosmetic follow-up: reduce scope-tab vertical padding, remove the label/count gap and shrink the reserved count slot. Labels remain centered and readable; counts retain a stable position with enough nonwrapping space for `999+`. All 53 unified interface tests pass, updated styles parse, and all 25 packaged assets match source and the stable unpacked folder. No browser artifact check.

Version choice: PATCH for mobile search restoration and responsive mounting reliability fixes. Independent tooling versions remain unchanged.

Validation: all 306 tests pass, including hidden/replaced mobile sidebars, account isolation, loaded-page catch-up and viewport restoration, delayed header content/layout, nested shadow toolbar anchoring, and both sidebar and individual-room mount readiness. All 19 JavaScript scripts parse. ZIP integrity and source/stable-folder/archive equality pass for all 25 assets; the convenience ZIP matches the versioned archive. No Brave artifact check was performed, as requested.

Limitations: restored UI state is temporary within the same document and native chat surface; a page reload or browser restart starts a fresh search UI while persistent saved messages remain available. Readiness and navigation still depend on Reddit’s native component structure. Headless fixtures cover lifecycle behavior but do not validate final rendered pixel layout or the installed signed-in bundle; reload the extension and refresh Reddit to apply this export. Saved-history coverage remains incomplete.

# 0.8.0 design test

- Show lazy image/GIF thumbnails in global message results, available latest-message previews, and individual message search instead of JPEG filenames. Filenames remain searchable and available on hover.
- Reuse Reddit’s native media URL conversion, prefer thumbnail references, and retain one bounded credential-free HTTPS preview URL. Keep credentials in the page world and media bytes outside extension storage. No additional profile/history requests or sync loop.
- Preserve preview references through both native IndexedDB import compaction passes, replay, edits and summaries. Redactions remove references; older data requires no schema migration and gains previews as native references become available.
- Cache bounded thumbnail nodes and keep a stable placeholder after failures, avoiding repeated requests on redraw. Account clearing/destruction resets preview views.
- Replace result-navigation outlines with a faded orange left rail; scope tabs retain their underline.
- Tighten text-result spacing, align content to the top, and retain extra space for wrapped headings and image previews. Keep virtual row heights consistent with their contents.

- Same-version visual follow-up: show one faded selection rail, prioritize keyboard navigation, and restore the opened-chat indicator when focus leaves search. Keep People rows at the native sidebar height with short status labels beside previews.
- Remove the common-word hint, compact counts/Refresh, and move loaded counts into the tooltip. Align sender chips to the search field’s left edge and show only their avatar/icon, username and removal control.
- Read native row fonts, colors, padding, gaps, line heights and avatar sizes through shadow roots. Reuse client typography/spacing tokens as fallbacks and refresh styles on resizing, existing native discovery, late fonts and root theme changes. Invalidate measured heights when needed without server calls, new polling loops or search restarts.
- Use Reddit-logo orange (#ff4500) for accents in both chat layouts and calendar highlights, rather than the darker brand-button token. Center People/All/Messages in equal-width columns while reserving count space.
- Escape dismisses global results, tabs, chips and menus from the search field or opened result rows, retaining the query and filters for reopening. Background updates do not reopen dismissed search.
- Match global message rows to People/discovery typography and spacing, reusing title/time classes and native avatar dimensions, normal-weight names and native preview typography capped at three lines.
- Keep message timestamps on the same line as native-style normal-weight conversation names; exceptionally long names truncate with full-name tooltips.
- Fit visible message cards to measured content with a bounded measurement cache, width invalidation and preserved virtual scroll anchors. Cap match-centered snippets at three lines and extend the rail with consistent 8 px top/bottom padding. Keyboard reveals and manual scrolling remain independent.
- ArrowUp reveals the whole previous card below sticky day headers while preserving downward scrolling.
- Use solid Reddit-orange rails for opened chats/messages and faded rails for keyboard previews. All results retain one rail, preferring the opened message after navigation.
- Reserve compact count slots and fixed scope columns to prevent People/All/Messages from shifting. Enlarge message thumbnails to 96 × 64 px without a visible Image/GIF caption; retain accessible labels and sender prefixes.

Version choice: MINOR for the new image-preview capability; spacing corrections share this release. Storage schemas and independent tooling versions remain unchanged.

Validation: all 294 tests pass; extension JavaScript syntax, ZIP integrity, and source/stable-folder equality pass for all 25 assets. Tests cover URL validation, replay, edits/redactions, native conversion without server calls, double-compaction cache import, lazy node reuse/failure fallback, People summaries, individual image history, and existing search/navigation coverage. The original bundle received Brave synthetic checks for loaded thumbnails, mixed results and stable scrolling/refocusing. Synthetic tests also cover responsive font/height changes, replacement native rows, font loading, theme changes and absence of appearance-related server/search requests. The visual follow-up uses headless fixture tests only, as requested; no Brave artifact check was performed.

Limitations: native appearance falls back to client tokens until a rendered native row is available. Missing or inaccessible references show an Image/GIF placeholder. Old cached filenames cannot reconstruct a preview URL until Reddit exposes the corresponding event again. Saved-history coverage remains incomplete. The signed-in installed bundle requires manual Reload and validation; browser checks use synthetic data.

# 0.7.1 design test

- Match message terms shorter than three characters on Unicode word boundaries. Keep longer substring searches, strict AND across the full message, and quoted exact phrases. Apply the same rule in saved/global and individual search, highlights and excerpts; People and sender completion retain substring matching.
- Keep conversation names/avatars as result headers. Prefix only your messages in DMs; prefix every sender in groups. Add accessible sender/action labels and avoid substituting your own avatar when a conversation avatar is missing.
- Let right-aligned timestamps wrap when needed instead of cutting off username suffixes. Allocate virtual row space for wrapped headings and refresh height calculations on resize. Reuse the excerpt for both visual and accessible text.
- Score relevance by distinct term coverage, with existing occurrence/position tie breaks. AND results all satisfy the required terms; partial matches remain excluded.
- Verify existing year-bearing older day dividers and stable room/event IDs across renamed and identically named conversations.

Version choice: PATCH for visible matching, sender-identity, accessibility and layout corrections within existing search. Storage schemas, native capture/sync behavior and tab styles are unchanged.

Validation: all 279 tests pass; JavaScript parses and all 24 archive files match source and the stable unpacked folder. Brave synthetic checks verify full example usernames, right-aligned/wrapped times, DM/group prefixes, accessible labels, whole-word short matches, strict AND, and distinct 2024/2025 date dividers. Screenshots are in ignored validation artifacts.

Limitations: snippets can omit required terms outside the displayed window even though the full message matches all of them. Long group titles may use two lines with a full-name tooltip. Saved history remains incomplete, and the signed-in installed Reddit bundle still needs manual Reload and validation.

# 0.7.0 design test

- Move applied global sender/media filters out of the editable input into one compact 32 px chip row below it. Hide its horizontal scrollbar, keep removal buttons on the right, preserve draft text, and make Clear filters remove all applied state.
- Preserve explicitly selected People/All/Messages tabs when clearing/replacing a query. Share People matching across People and All, calculate independent counts, apply conversation filters consistently, and reuse count/full-result reads across scope changes. Existing matching remains literal, including regex characters; no arbitrary regex engine is added.
- Retain the preceding design's scope tabs and solid orange active underline. Size tabs around their labels/counts to avoid clipping and use a faded orange underline for hover. Result-navigation outlines use Reddit orange. Compact global sender suggestions and the calendar, and dismiss sender choices outside without discarding the pending draft.
- Make arrows navigate from clicked result buttons as well as the input. Immediate People selection does not wait for message counts. Native message navigation retains Reddit's highlight without additional orange outlines; extension result selection accents remain.
- Add global Images/GIFs/Links and conditional observed Videos/Audio/Files filters using native type/MIME metadata. Capture only the small MIME string through the page bridge, including edits, and exclude redacted media. Individual-room media UI is not expanded.
- Keep search in the existing extension worker, virtualize long lists, reuse unchanged rows/avatars, debounce typing for 180 ms, and batch native capture updates for 750 ms. Capture bursts do not starve queries or replace visible rows per batch.

Version choice: MINOR for the compatible global media expansion and applied-filter state model. No storage-schema bump, second sync loop, automatic full-history crawl, or extra profile/media request. Older missing metadata is filled only when native events are replayed. Work remains on `prototype/unified-chat-search`; no merge or publication.

Validation: all 275 tests pass, including sender/media state, literal/shared People matching, independent counts, count-only-to-full transitions, keyboard focus, outside dismissal, account clearing, capture bursts, bridge-to-worker MIME persistence, edits/redactions and existing history/storage coverage. All JavaScript parses; ZIP integrity and all 24 packaged files match source and the stable unpacked folder. Brave synthetic checks cover full/floating light and dark views, minimized search restoration, sender/media chips, 32 px overflow with hidden scrollbar and right-side removals, compact calendar, scope counts, exact message navigation and result-focused arrows. Screenshots are kept in ignored validation artifacts.

Limitations: saved message coverage remains incomplete. Missing MIME metadata is not guessed, and old events unavailable locally cannot be classified until fetched by native/user-directed history. Videos/audio/files are supported conditionally rather than claimed as universally available in Reddit's current client. Manual browser checks use synthetic data; the signed-in installed Reddit extension requires a manual Reload and has not been verified with this bundle. Browser automation blocks the Brave extension-settings page. No universal latency guarantee is made.

# 0.6.0 design test

Quick follow-up export: sender chips now sit inside the search field, sender matching uses People-style substring matching and the shared People row renderer, and captured updates batch into a 750 ms background search/summary refresh. Account clearing stays immediate. This same-version follow-up is untested at the user’s explicit request; the validation below describes the preceding bundle.

- Start search in People and retain Reddit’s original sidebar until a query or relevant filter is applied. Focus/click exposes underlined People → All → Messages tabs. Keep calendar placement stable with a disabled People control; omit duplicate single-category section headings.
- Add multiple removable sender chips with reused avatars. Repeated `from:` values match alternatives; text, dates and attachment filters remain conjunctive. Expand contextual filters with Direct, Unavailable, Images and Files. Attachment type comes from native message metadata, including edits and replay of older cached events.
- Correct individual snippet highlighting to use the excerpt’s original offsets. Keep first matches visible in responsive windows, wrap long URLs, highlight People titles and restore main’s orange matches/selected-row accents.
- Restore reliable user-requested message navigation: load exact events through the available native client API for initialized rooms, retain cold-room routing, scroll/highlight the exact target, expose loading/failure and ignore obsolete navigation completion. No background scroll or second sync loop.
- Reuse unchanged result/preview/avatar nodes during native updates. Compile query/date checks once, reuse sender identities within each search, sort numeric timestamps, and bypass Unicode mapping for ASCII highlights. Search stays in the existing extension worker.

Version choice: MINOR for multiple sender selection and genuine attachment filters plus the compatible search-flow expansion. No storage-schema bump; older attachment metadata is recovered on native replay. Work stays on `prototype/unified-chat-search`.

Validation: all 254 tests pass. New cases cover multi-sender OR matching and chip removal, native default/focus behavior, deep URL windows, stable clickable rows, attachment replay/edits, cold-room navigation, exact target scrolling, and obsolete navigation completion. All JavaScript parses; ZIP integrity and all 23 files match source and the stable unpacked folder. Brave synthetic checks verify native People on focus, underlined scope order, sender selection/chips, matched-message navigation and orange highlighting. Synthetic benchmark against the previous code measured 100 long-URL excerpts at 48.9 → 1.3 ms and five 5,000-message searches averaging 39.2 → 11.4 ms; these are local fixture timings, not a guarantee for every account.

Limitations: saved-history coverage remains incomplete; unavailable attachment metadata is not guessed. Browser testing uses synthetic fixtures in Brave. The signed-in Reddit account is not yet verified with this bundle; browser automation blocks Brave’s extension-settings URL, so the installed extension needs a manual reload. Native client capabilities can change. Reload the same unpacked extension and refresh Reddit tabs after updating.

# 0.5.2 design test

- Refine message timestamps by sort in global and individual-room search: Newest/Oldest use time-only rows under sticky local-day dividers; Relevant removes dividers and uses date plus time on every result. Dividers use Today, Yesterday, recent full weekdays and compact older dates. Full timestamps appear on hover. Virtualized scrolling retains the active day without changing list height.

- Move the saved-history explanation from chat results into the extension popup, alongside cache statistics and clearing controls. Saving failures remain visible in search status; no completeness guarantee is added.
- Center compact filter menus within the sidebar and individual-room search. People offers chat types and chronological sorting; Messages offers sender selection and message sorting; All offers both. Dormant chat filters no longer constrain Messages, and calendar filters do not hide People results.
- Separate calendar and filter active indicators. Date-only filtering accents the calendar alone; All/People/Messages use Reddit secondary theme colors.
- Remove link, before/after date-operator, and whole-word menu options and autocomplete suggestions. Sender completion retains avatar rows and keyboard selection; dates use the existing calendar. Previously typed query operators remain supported by the parser for compatibility.

Version choice: PATCH for user-visible filter scope and active-state corrections within the existing design-test interface. No storage-schema change, second sync loop, or additional network lookup. Work remains on `prototype/unified-chat-search`. The timestamp display follow-up retains this same version under the small interface refinement policy.

Validation: all 241 tests pass, including chronological/relevance timestamps, local calendar dates, virtualized day continuity, room-search sort switching, context-specific menus, scope switching, calendar/filter independence, sender keyboard selection, popup notice/statistics, saved-query integration and existing storage/history tests. All extension JavaScript parses. The ZIP passes integrity checks and all 23 packaged files match source and the stable unpacked folder. Synthetic browser checks cover light full chat, dark floating chat, centered sidebar/room menus, independent date accent, and minimized search restoration. Timestamp previews verify time-only chronological rows, dated relevance rows and a day header pinned to the result viewport after scrolling.

Limitations: saved-message history may be incomplete. Browser checks use synthetic fixtures in the Codex in-app browser; the installed bundle has not been verified in the signed-in Brave Reddit tab. Reload the unpacked extension and refresh Reddit tabs after updating.

# 0.5.1 design test

- Refine chat/message rows, search fields, scope pills, and sticky day separators to use Reddit's native theme. Restore the selected-chat highlight from Reddit's active room, keep keyboard focus distinct, and show an optional one-line last-message preview in People when already saved. Missing, blank, or older-than-known-activity messages leave the preview absent; dates retain the latest known activity.
- Replace the enlarged filter menu with compact icon actions and short inline chat/sort choices. Completing `from`, `has`, `before`, or `after` offers an operator action; click or Enter inserts its query token and keeps focus in the search field.
- Choose senders with reused avatar rows in the main results area, choose Link for `has:`, and type or choose dates through the existing calendar. Individual-room search follows the same flow. There is no separate scrolling sender popup or message-context expander.
- Hold message/history reads while an operator value is being chosen. Keep flat results virtualized, reuse cached sender candidates, fix keyboard selection repainting, and return to Reddit's native sidebar when the query is cleared.

Version choice: PATCH, at the user's request, for fixes and interface refinements to the existing 0.5.0 search/filter behavior. No storage-schema change, new sync loop, or additional profile lookup is introduced. This remains on the unmerged `prototype/unified-chat-search` test branch.

Validation: 236 tests pass, including query insertion, sender selection with spaces, keyboard navigation, native selected-room changes, date-query completion, local pagination, and room-search integration. All extension JavaScript parses. Export validation checks ZIP integrity and byte equality with source and the stable unpacked folder. Synthetic browser checks cover full/floating chat, minimized search restoration, light/dark menus, individual-room sender selection, and date completion.

Limitations: saved-message coverage remains incomplete. Browser UI validation uses the Codex in-app browser and invented fixture data; the updated installed bundle has not been validated against the signed-in Brave Reddit account. Native selection/navigation relies on Reddit's current components. Reload the unpacked extension and refresh Reddit tabs after updating.

# 0.5.0 design test

- Integrate the unified chat/message design into the actual extension on `prototype/unified-chat-search`. All, People, and Messages share an input, independent counts, and account-scoped recent searches.
- Put icon-only filter/calendar controls inside the chat search ribbon, without a separate empty toolbar row. Individual message search shares the compact filter menu and Discord-style operator/sender suggestions. Active filters have removable chips.
- Add `from:`, `before:`, `after:`, `has:link`, quoted phrases, Me/Them, whole-word matching, and newest/oldest/relevance sorting to saved searches. Reuse known native unread metadata; unknown state is not invented.
- Show last-message previews, partner avatars and conversation titles, compact timestamps/full tooltips, centered snippets, and a normal-weight You: prefix. Group message matches, reveal saved context on demand, and highlight native message jumps. Window long lists and expanded groups with local pagination and accurate total counts.
- Consolidate result status, use skeleton/empty states, preserve captured matches during updates, and keep incomplete coverage in a footer. Keep search above native chat rows/Threads and give only the native header a higher layer, so its dropdowns paint above search controls. Restore scoped header style overrides when search unmounts. Tighten the status/Refresh strip and suppress the common-word hint while browsing without a query.
- Replay loaded native timelines once when cache listeners attach late; retain full snapshot references afterward to avoid repeatedly saving unchanged startup history. No new server calls or second sync loop are introduced.

Version choice: MINOR for the new unified search interface and compatible search/filter expansion, once for this design-test bundle. Directory/message storage schemas and tooling versions are unchanged. This branch is not merged or published.

Limitations: global search covers saved data, not the complete archive. Context is limited to saved messages in the same thread. Unread filters require native metadata. Global results load in 500-message local pages, and exact navigation depends on Reddit's private native client. This build requires reloading the unpacked extension and refreshing Reddit tabs. Browser checks use actual extension scripts against a synthetic native fixture in Brave; the updated installed build has not yet been tested on the signed-in Reddit account.

Validation: 233 tests pass; all extension JavaScript parses. Package validation confirms ZIP integrity and byte equality between extension source, the versioned ZIP, and the stable unpacked folder. Synthetic Brave checks cover the compact full/floating search ribbon, individual-room filters/suggestions, dark calendar, native navigation, and minimized restoration.

# 0.4.1

- Show already-committed global/room matches without draining queued captures. Worker reads run separately from ordered mutations; whole-room reads use a single snapshot.
- Preserve explicit save barriers and invalidate stale reads after clearing or changing accounts. Remove the redundant full stats scan during initialization.
- Keep saved matches searchable during saving failures, show Saving paused, and let Refresh retry pending writes without turning ordinary searches into a retry loop.
- Document proportional version decisions in AGENTS.md. This meaningful startup performance fix receives a PATCH bump; no feature or cache-schema version change is required.

Validation: 181 tests pass, including paused client/worker/storage queues, snapshot consistency, durable barriers, clear protection, saving failure/Refresh behavior, and existing native catch-up/UI tests. Authenticated-account readiness, an active IndexedDB write, and local matching can still take time; global coverage remains incomplete.

# 0.4.0

- Persist messages already fetched by Reddit or individual searches, scoped by account and shared between individual and global search.
- Add People / All chats search scope, local message/date filtering, compact sender rows, and exact room/event/thread navigation. Global search explicitly shows incomplete coverage.
- Capture existing native events, loaded timelines, edits and redactions without another sync loop or background history crawl.
- Reconcile supported locally cached Reddit history on each chat attachment, using readonly 200-row chunks and durable write acknowledgements. Persist successful reconciliation timestamps; skip unchanged message/identity writes.
- Add cache statistics and a separate Clear saved messages control. Failed writes retry within bounded memory; account switches and clear operations invalidate stale work.
- Initialize Git and document the repeatable commit/validation policy in AGENTS.md.

Buffer fix within 0.4.0: throttle startup/sync capture as well as native database import, coalesce native bursts, skip unchanged snapshots, and recover rejected captures locally instead of latching the buffer error indefinitely. The buffer limits are unchanged.

Search fixes within 0.4.0: return saved global/room matches while the initial local import continues; coalesce incoming capture updates without cancelling queries or clearing visible results; avoid saved-room reads in hidden controls. Preserve unresolved invitations/departed rooms when their participant endpoint denies access, continue accessible username resolution, retain invite state, and persist denied status to avoid repeated failures on reload. Unexpected participant failures remain visible.

Sidebar fixes within 0.4.0: keep All chats visible behind its calendar and while interacting with a conversation or opening a matched message. Outside clicks and Escape close the calendar without reverting the global sidebar to Reddit's native list. People search and individual message menus remain dismissible.

Reconnect fixes within 0.4.0: automatically reconcile messages Reddit cached while capture was disabled, including new messages, older edits and redactions. An old import-complete flag no longer blocks catch-up. Late database readiness and replacement clients/databases attach without a second sync loop; searches keep using saved data during reconciliation. Individual history completion waits for saved writes. Pending invitations avoid forbidden member reads, acceptance updates saved room metadata, and named community conversations appear in People with a distinct caption.

After re-enabling, reload open Reddit tabs. Local catch-up cannot recover events that Reddit no longer retains; persisted extension history is not removed merely because Reddit evicted it.

The optional full-history build is deferred. Existing local tails and newly fetched pages do not establish complete global coverage. No fixed storage ceiling is promised.
