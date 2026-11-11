# Search syntax

Every search box in Reddit Tweaks understands the same query language: chat search (all chats and inside a conversation), profile search, your Saved, History, Hidden, Upvoted and Downvoted searches, the archive's community search, and Search Comments on archived posts. Each box offers **Search tips** with tappable examples:

- **Chat:** in the Filters menu.
- **Profile and list search:** in Feed options and the filter row.
- **Archive:** a button next to the box.

## Words, phrases and operators

| Syntax | Meaning | Example |
|---|---|---|
| words | All words must match | `battery laptop` |
| `"exact phrase"` | The exact phrase | `"battery health"` |
| `OR` | Either side matches | `laptop OR notebook` |
| `-word`, `NOT` | Leave out matches | `laptop -gaming`, `NOT "for sale"` |
| `( … )` | Group alternatives | `(rog OR legion) -used` |

- Only **uppercase** `AND`, `OR` and `NOT` are operators. Lowercase `and`, `or` and `not` are ordinary words.
- Precedence: `NOT` (and `-`) binds first, then `OR`, then `AND`. Spaces mean AND. So `a b OR c` means `a AND (b OR c)`; add parentheses to group differently.
- An exclusion needs at least one word to search for: `laptop -gaming` works, `-gaming` alone doesn't.

## Fields

| Field | Meaning | Example | Where |
|---|---|---|---|
| `title:` | Words in the title | `title:review` | Post searches |
| `body:` | Words in the text | `body:warranty` | Posts and comments |
| `author:`, `u/` | By one person | `u/spez` | Everywhere except chat (chat uses `from:`) |
| `subreddit:`, `r/` | In one community | `r/termux` | Profile and list searches |
| `site:` | Links to a website | `site:github.com` | Post searches |
| `url:` | Words in the link | `url:youtube` | Post searches |
| `flair:` | Posts with a flair | `flair:Help` | Post searches |
| `type:` | Post type: text, image, gif, video, gallery, link, poll | `type:image` | Post searches |
| `self:` | Text posts (`yes`) or link posts (`no`) | `self:yes` | Post searches |
| `nsfw:`, `spoiler:` | Only (`yes`) or no (`no`) NSFW or spoiler posts | `nsfw:no` | Post searches |
| `from:` | Sender (`me`, a name) | `from:alice` | Chat |
| `has:` | Media: link, image, gif, video, audio, file | `has:image` | Chat |
| `after:`, `before:` | Date (YYYY-MM-DD) | `after:2026-10-01` | Chat |

Field alternatives can be grouped: `(from:alice OR from:bob) invoice`. A field a box doesn't support gives a message instead of being ignored. Profile search on someone else's profile keeps the author fixed to that person.

## How results are found

- **Chat** searches messages saved on this device. History may be incomplete; messages become searchable once Reddit or a conversation search has loaded them.
- **Profile search** asks Reddit's search and, when "Use the archive" is on, the Arctic Shift archive. Parts of a query that Reddit or the archive can't run are matched on loaded results, and the status says "Some matches filtered locally".
- **Your lists** (Saved, History and the others) are read from Reddit and matched locally. Reddit returns the newest 1,000 items; History holds about your 20 most recently viewed posts.
- **Archive searches** use Arctic Shift and say how far back they searched. Archive coverage is never complete.
