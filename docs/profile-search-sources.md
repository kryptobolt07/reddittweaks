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

## Cookie-free comment discovery: proposed next step

The current comment request remains authenticated. A previous live comparison for the blocked chuggingdeemer profile and r/TheLaptopGuide returned no signed-in comment cards but ten cookie-free cards and a continuation. This is evidence of session-dependent public search coverage, not a guarantee that anonymous requests always return more.

The long-term approach is two bounded discovery streams feeding the existing native-card pipeline:

1. Keep authenticated discovery, preserving content the signed-in account is permitted to see.
2. Add a cookie-free public supplement using the same validated author/comment query, `credentials: 'omit'` and no referrer. Do not change cookies, log out, alter the block list or forward authentication headers.
3. Maintain separate signed-in and anonymous cursors, exhaustion flags, errors and cooldowns. Never send one stream's cursor to the other. Bind both to the viewed author, account session, sort and time range; invalidate them on the corresponding change.
4. Merge by full comment ID, preserve provenance and known restriction flags, and require the returned author to match. Search discovers IDs; render cards and perform actions through the authenticated native client. An anonymous result does not establish permission for a signed-in action or prove a current deletion state.
5. Schedule the supplement only as part of explicit/profile-triggered discovery and subsequent feed-tail loading, with a shared bounded request scheduler. Prioritize visible cards, coalesce identical in-flight requests, and honor server cooldowns. Do not add a periodic sync or walk all history in the background.
6. Publish ready batches without replacing existing card objects or resetting the viewport. One stream failing must leave the other's results usable. The feed may offer another page while either stream has a valid continuation; failure or missing cursors must never be described as verified complete history.

Before enabling the supplement, test normal, curated, blocked, deleted/suspended, mature-content and access-restricted cases. Cover overlapping and disjoint pages, duplicate IDs, source-specific failures, changed formats, rate limits, cancellation, account/route changes and reverse scrolling. Keep Arctic Shift separate and opt-in; it is not interchangeable with either live discovery stream.
