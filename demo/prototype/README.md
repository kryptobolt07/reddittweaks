# Unified chat search design preview

Branch: `prototype/unified-chat-search`. This folder is the isolated synthetic design experiment. The branch also now builds the actual 0.5.0 extension in `extension/`, exported to the stable `artifacts/reddit-chat-search/` folder. Use that folder to test the extension in Reddit.

From the repository root, run `npm run preview`, then open <http://127.0.0.1:8765/demo/prototype/>. You can also open this folder's `index.html` directly. The preview has no build step or external resources.

## What to try

- Focus **Search chats and messages** or press `/`. All / People / Messages appear, with independent counts after typing. Empty input browses chats and shows recent searches. Recent queries are saved only under the preview's own localStorage key.
- Search `coffee`, `"coffee tomorrow"`, `from:me has:link`, or `from:R-K-T after:2026-10-01 before:2026-10-12`. Terms combine with AND; quoted phrases match exactly. Dates use your local timezone: **After** includes the selected day, **Before** excludes it. The Between calendar selects both bounds in one calendar.
- Use Filters for Unread, Groups, or Requests; From for Me / Them; Date for the calendar; sort by newest, oldest, or relevance. Short queries expose Whole word. Active dates, senders, conversations, and conversation filters have removable chips.
- Select Messages. Each conversation starts with its partner avatar and name. Your messages use a normal-weight **You:** snippet prefix. Snippets center the first match, timestamps stay right aligned and have full-date tooltips, and older groups have sticky day headings.
- Expand **more matches** to browse every match in a conversation. **Show context** reveals its previous/next saved messages. Click a match or use ↑ / ↓ then Enter: the synthetic conversation opens at that message and briefly highlights it. Clicking a search field again preserves the results.
- In the room header, Search this conversation searches both senders and adds a removable conversation chip. The sidebar stays visible in full mode; floating/mobile mode uses a Back control.
- Try `this` for the common-word hint, `coff` with Whole word for an empty state, and the refresh/history icon for a loading skeleton.
- Switch Full chat / Floating / Minimized and Light / Dark. The minimized search icon restores the compact search pane with its query intact.
- **Learn why** explains incomplete saved history. Unavailable accounts are marked per row with their retained name; there is no global warning banner to truncate.

## Interaction and accessibility

Input is debounced by 180 ms. A windowed result list mounts only visible rows plus an overscan region; expanded conversation matches are windowed individually. Hover, selected, and keyboard focus have separate styles. Scope tabs support left/right and Home/End; menus support up/down; Escape closes menus or clears the query. Icon controls have accessible names and hover tooltips, reduced motion is respected, and inactive tabs, timestamps, control text, footer links, and calendar selections meet WCAG AA text contrast in both themes.

## Boundaries of this experiment

The 42 conversations and 1,853 messages are generated synthetic fixtures anchored to October 11, 2026. Unread flags, request states, refresh delays, avatars, context, and message jumps demonstrate the design. The composer does not send. No Reddit credentials, APIs, account caches, native sync events, or extension runtime are accessed.

This is not an installable extension build. This standalone experiment does not exercise actual Reddit navigation, unread/request state, native captures, real-account storage, or production search performance; those are handled separately by the extension integration and its native fixture tests. The saved-history footer intentionally avoids claiming complete coverage.

## Validation

`node --test tests/prototype-*.test.cjs` tests operators, date boundaries, snippets, sorting, keyboard/reopening, context, calendar ranges, previews, windowing, states, and contrast. The full repository suite is also run to ensure the existing extension remains unaffected. Browser checks cover Brave's default viewport and a 390 × 844 narrow breakpoint, including dark calendar placement and minimized restoration.
