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
