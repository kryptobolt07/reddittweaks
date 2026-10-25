# Profile search sources and continuation plan

## Post discovery: implemented

The normal post discovery request now uses Reddit's website HTML search route:

`/svc/shreddit/search/?q=author:"USERNAME"&type=posts&sort=new`

Sorting remains New, Hot or Top, including the existing Top time range. Search only discovers identities and compact metadata. Full cards, text, media and actions still come from Reddit's authenticated native profile-card renderer. Search snippets are not presented as complete post bodies or current deletion-status proofs.

Live Brave comparisons on 25 October 2026 used the same author query, sort, time range and signed-in session for the existing `/search.json?type=link` route and Shreddit. Comparisons followed Shreddit's actual continuation rather than comparing unequal page sizes. The observed Shreddit batch size was seven, even when `limit=25` was supplied.

| Public profile / scope | Comparison |
| --- | --- |
| kryptobolt200528 / New | First 14 IDs and order matched across two Shreddit pages. |
| kryptobolt200528 / Hot | First 14 IDs and order matched across two Shreddit pages. |
| kryptobolt200528 / Top, all time | First 14 IDs and order matched across two Shreddit pages. |
| kryptobolt200528 / Top, past month | Both returned no results; Shreddit supplied an explicit empty-search marker. |
| TheMLguy07 / New | All 12 JSON results matched in order across two Shreddit pages, ending without another cursor. |
| chuggingdeemer / New, blocked in this session | Signed-in Shreddit returned only four of the JSON route's first 14 IDs within three pages. Cookie-free Shreddit matched those 14 IDs and order across two pages. |

These samples do not prove identical lifetime coverage. The blocked-profile result prevents an unconditional replacement: the existing authenticated JSON route is retained when Reddit's current profile sidebar explicitly exposes its native `unblock_user` state. Both paths continue to use credentials inside the page world; no account preference is changed. This preserves that known coverage difference without making all discovery anonymous.

Post continuation values wrap the transport, author, sort, time range and opaque cursor. A continuation cannot silently change transport or be reused for another query scope. Refresh creates a new scope. Only matching same-origin search continuations are followed, and source failures remain incomplete.

Shreddit crossposts need special treatment: their outer result tracker can lack the regular post test ID and author field, while an inner tracker identifies the actual crosspost author. The parser matches that inner identity to the outer result ID, reads the crosspost's own timestamp and counters, and excludes embedded original posts from the result list. Format changes and unrecognized error/challenge HTML fail explicitly instead of masquerading as empty results.

## Native profile history and feed continuity

The website initially serves the profile page and follows native continuations such as `/svc/shreddit/profiles/profile_posts-more-posts/new/?after=...&name=USERNAME`. Live Brave inspection found the same continuation route on the signed-in owner's profile and a different public profile. A credentialed request identifies the viewer through Reddit's existing session; the username parameter alone does not grant owner visibility. The signed-in owner's response exposed “Showing all posts”; a cookie-free read of the same page did not expose that owner control. This is evidence of session-dependent presentation, not proof of equal authenticated/anonymous history coverage or a separate owner-only endpoint. No credentials are read or stored by the extension.

Profile curation changes which activity appears on the profile. Reddit documents that the underlying public posts/comments remain in their communities and in search: https://support.reddithelp.com/hc/en-us/articles/360043471231-How-do-I-update-my-profile-settings.

In the inspected native Posts feed, continuations added 25 posts. Native search returned seven per page in the earlier comparison. The combined feed therefore cannot promise 25 *additional unique* extension cards per request: source page sizes, duplicates, filters and missing fragments all affect the visible count. Keep all returned identities and follow each source's own cursor.

Prepare extension card groups of up to 25, two viewports ahead like the native pager, and publish the ready prefix in order. Near the tail, overlap a further source read with card hydration only while fewer than 25 unpublished unique discoveries are buffered; count older deferred items too. Honor failures, route changes and server cooldowns. This is bounded on-demand prefetch, not a full-history crawl.

Recognize both lazy and programmatic native continuations. Keep already-published cards visible through pager replacement, and retain the combined feed until Reddit actually replaces its native objects during post navigation. The extension requests the existing native virtualization controller's update on reverse-scroll animation frames; Reddit retains ownership of its original populated objects, placeholders and stack. This optional, feature-detected contract falls back to native scrolling if Reddit changes it. Server latency, missing coverage and native rendering failures can still delay a page; they do not establish history completeness.

## Cookie-free comment discovery: implemented

Comments and Overview now use two independent discovery streams: authenticated Reddit search and a cookie-free public supplement. A live uncached comparison on 25 October 2026 for chuggingdeemer returned zero signed-in comment cards and ten cookie-free cards from r/TheLaptopGuide. Reddit's authenticated `/svc/shreddit/comment/t1_ID?isProfile=true` renderer then returned a matching native card with its comment body. This verifies the supplement is useful for that profile; it does not prove anonymous search always returns more or that either search covers all history.

Both streams use the validated author/comment query on `/svc/shreddit/search/`. The public stream sends `credentials: 'omit'` and no referrer; both streams bypass the browser HTTP cache so session variants cannot reuse an earlier cached response. No cookies, account preferences or block-list settings are changed. Native card rendering, verification and actions remain authenticated in Reddit's page world. Public search HTML is parsed as data and never injected into the feed.

Each stream has an independent cursor, exhaustion flag and failure entry in the existing transient profile state. Comment cursor wrappers bind the opaque cursor to the stream, viewed author, sort and time range; the existing profile snapshots are scoped to the authenticated extension owner. Refresh retries a failed source. Ordinary continuation skips failed/exhausted sources and keeps a healthy source pageable, with failures still reported as incomplete coverage. Global Reddit cooldowns and bounded scheduling remain shared.

Merge by full comment ID, check the author and prefer authenticated metadata regardless of response order. Preserve restriction flags from either source. Public-only comments enter the same retained native-card list, source indicator, activity filtering and ordered publication pipeline as other discoveries. Before initial publication, each participating stream establishes its page boundary or explicit failure. For New, publish only the shared covered chronological prefix and advance the shallowest stream first, retaining deeper records for later. This prevents a late comment page from inserting newer activity above already-published older posts. Hydration uses the combined order rather than the arrival order of staged DOM nodes. Persist these boundaries with the existing account-scoped page-session snapshot. Arctic Shift remains a separate opt-in source; public discovery is not deletion evidence.

Regression coverage includes Comments and Overview, disjoint and overlapping pages, source-specific failures, independent cursors, metadata precedence, Back state, cancellation, local backpressure, unknown/empty HTML and untruncated native pages. Coverage remains dependent on Reddit's public search index, session visibility and undocumented response formats.

## Native card readiness and scroll placeholder timing

A native fragment's HTML can arrive before its custom element definition and first render. Keep that card staged behind the shared loading UI until those complete, under the existing bounded timeout and route/target checks. Missing modules become retryable failures rather than indefinitely publishing blank cards.

Reddit also swaps populated original cards for scroll placeholders synchronously, ahead of MutationObserver delivery. A concurrent source completion previously mistook such an original for an unmounted card and reinserted it, disturbing the native stack. Drain pending swap records before native-entry/slot lookup and cleanup; retain the exact original node. Apply any consumed native filter/hydration updates before paint as well. Ignore obsolete replacement records whose placeholder has already left the feed. A regression reproduces premature reinsertion before the fix and verifies same-object restoration afterward.

## Incremental archive verification and publication

Deleted starts opted-in archive discovery independently of an in-flight Reddit page. Archive snapshots are candidates, not current deletion proof. Native verification returns pairs incrementally so one slow fragment does not withhold an entire page's successful evidence. Known available cards and unverified search-only cards do not consume Deleted's hydration queue; switching activity drops irrelevant queued work without discarding saved records or populated cards. Keep the shared native halo while relevant reads, verification or card hydration remain. Once the archive is exhausted, unrelated live-search cursors cannot keep Deleted loading indefinitely. Unknown status remains explicit and is never relabeled as deletion.

New applies the shared chronological boundary to archive streams too. Top and Hot wait for initial source settlement, but archive pages are chronological rather than score/relevance ordered; those modes sort the activity currently loaded and do not promise lifetime global ranking. A source error remains incomplete and retryable. When a later discovery must enter above the viewport (for example, explicitly adding an archive source), reconciliation compensates the current visible card's displacement only if the user has not scrolled in the meantime. Native virtualization retains ownership of its stack and original cards.
