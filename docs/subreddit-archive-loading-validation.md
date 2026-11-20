# Unavailable-community loading validation — 0.27.0

Date: November 4, 2026.

## Automated and package checks

- `npm test`: 1,279 passing tests, zero failures.
- Targeted coverage includes independent preferences, early notice suppression/failure release, worker-forwarded preference updates under trusted-only storage, repeated/empty cursors, native slot preservation, connected comment/card identity, collapsed replies, and clean clipboard/share payloads.
- Sharing tests cover native string writes, promise-backed plain-text ClipboardItems, preserved user activation/feedback promises, later clipboard integrations, opt-out, unrelated/rich payloads, external domains and source-scoped opaque links.
- Package validation: 48 allowlisted assets; ZIP integrity, source/archive/unpacked byte equality and exact stable-folder file inventory pass.

## Live Reddit in Brave

Browser checks used the connected Brave session through the ChatGPT extension. No constructed preview is used as final browser evidence.

- With the new community preference disabled, Reddit's banned notice remained visible and no archive action mounted.
- With community archives and automatic opening enabled, a bare banned-community URL mounted the archive directly. The matching notice stayed held in observed startup states.
- Native navigation reached ready state. The collapsed layout's subgrid left edge remained 88.5 px before reload and while navigation was still loading afterward; no expanded-width reservation appeared in these observations.
- The feed revealed 25 then 50 cards on scrolling. Scrolling upward retained the first loaded card and all 50 cards, with no extension placeholder nodes.
- An archive query timeout stopped the halo and displayed Retry. Retrying showed the native 192 px halo and then recovered the feed.
- An archived thread continued from 35 to 58, 79 and 99 mounted comments while scrolling, without Load more comments/View more comments buttons or comment skeletons. Reverse scrolling kept earlier comments visible.
- Two native-style reply controls expanded their branches: three direct replies became five, and two became three. Reddit-assigned child slots remained intact.
- The updated post sidebar computed `position: sticky`, `align-self: start` and `top: 56px`; its viewport top stayed 56 px after scrolling six pages.
- Native comment Share → Copy link generated a canonical comment permalink without tracking parameters.
- Native normal-post Share → Copy link generated a canonical post permalink instead of an opaque `/s/...` share path. The actual copied text was read back and matched the normal permalink.

The browser connection installs its own clipboard wrappers. Sharing was therefore checked with the exact packaged page script loaded after that integration on live Reddit, preserving the integration underneath the cleaner. SHA-256 of the script used for the final post check: `d79cee9384f25aacf65f256b4d1aaa32be8e7dd834f6578458f3e45a1f9c11ef`. Temporary URL tracing was removed by a hard page reload and its absence verified. The built extension must be reloaded to activate the last sharing corrections in existing sessions.

## Limits

Private communities and exhaustive startup failure scenarios have automated synthetic coverage; live browser checks used banned communities. No frame-by-frame proof of zero flashes or every possible rapid-scroll sequence is claimed. Archive coverage and ranking remain partial. Retaining revealed feed cards trades additional page memory for rendering continuity. No private captures, chat content or generated package artifacts are committed.

## Mobile archive post detail spacing

Measured in regular Chrome at 393 CSS px. The native post header was 48 px tall, its credit row was 44 px tall, its title and flair used 16 px gutters, and its comment started at x=16 with a width of 361 px. The archive post detail uses the same header height and gutters while leaving the media slot full width. The archive feed keeps its existing masthead and divider. The scoped archive page class goes away when the archive unmounts on navigation or Back.
