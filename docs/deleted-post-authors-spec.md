# Deleted post authors

Restore an author only where Reddit marks the author deleted and Arctic Shift supplies a valid username for the exact post. This applies to the open post and to visible native cards in extension-filtered subreddit feeds when archive discovery and restoration are enabled. A late or replaced credit row can use the already recovered author. The post body, status and native controls stay in place when only the author is unavailable.

| Transition | Expected behavior |
|---|---|
| Archive result arrives before the credit line | Keep the exact author record and apply it as soon as Reddit renders the deleted label. |
| Reddit replaces the credit line or the reader returns to the post | Reapply the cached record while the native author is still marked deleted. |
| Follow the restored profile link | Keep the link destination and show Reddit's deleted label on the outgoing post during the transition. Restore the name if navigation stalls, and on Back. Modified clicks leave the source presentation in place. |
| Filtered subreddit feed exposes deleted author labels | Observe matching cards near the viewport. Batch exact post IDs, ignore hidden cards and return only author names from the current subreddit. Cache successful answers and misses for this tab. |
| Opt out, change feeds or lose native evidence | Revert original labels. Ignore stale responses after leaving their scope. |

The author-only request uses the existing Arctic Shift post-ID endpoint, bounded to 25 IDs and three fields. The worker still checks both preferences, the current Reddit community and the archive response. Archive gaps leave Reddit's native label in place.

## Posts whose author deleted them

Measured on 2026-11-23 on r/TeenIndia post `1y1x74o`. Signed in and signed out, Reddit showed the same thing: the title, `author="[deleted]"` and `is-author-deleted`, with no `post-type`, no body, no media and no deletion notice. Arctic Shift had the body. A deleted account's surviving post keeps its `post-type` and content.

| Case | Expected behavior |
|---|---|
| A `[deleted]` post with no `post-type`, body or media | Counts as deleted. With the archive on, restore its archived body and media with the “Deleted on Reddit” cue. Purged media shows Reddit's media-unavailable note. |
| A `[deleted]` post that keeps its type and content | Author only, as above. |

## Accounts that blocked the reader

Measured on 2026-11-23 with u/example_account, which blocked the signed-in test account.

What the signed-in reader sees:
- **The blocker's post:** `author="[deleted]"`, with the title but no media.
- **The blocker's comment:** `author="[deleted]"` with `is-comment-deleted` and “Comment deleted by user”. This is identical to a real deletion.

Reddit's signed-out profile-form fragments of the same items show the real author, body and media. The thread-form comment fragment is refused signed out (HTTP 403).

| Case | Expected behavior |
|---|---|
| A signed-in reader on a post page, with the blocked-profile setting on | Ask Reddit's signed-out view first about the `[deleted]` post and `[deleted]`-looking comments, ten comments per request. This happens whether or not the archive is on. |
| Signed-out view shows a live author for this thread's item | Show its author (with the signed-out picture), its text from Reddit's own body HTML, and its media. Mark it “u/… has blocked you · Shown from Reddit's signed-out view”. Skip the archive for it. |
| Signed-out view shows it deleted, or another thread's item | Treat it as a real deletion: go to the archive when on, otherwise keep Reddit's notice. |
| Signed-out reader, setting off, or another post | No signed-out reads, which are limited to this post's fragment and comment fragments. Turning the setting off reverts every change. |
