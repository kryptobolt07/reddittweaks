# Profile search sources and continuation plan

## Post discovery: implemented

The normal post discovery request now uses Reddit's website HTML search route:

`/svc/shreddit/search/?q=author:"USERNAME"&type=posts&sort=new`

Sorting remains New, Hot or Top, including the existing Top time range. Search only discovers identities and compact metadata. Full cards, text, media and actions still come from Reddit's authenticated native profile-card renderer. Search snippets are not presented as complete post bodies or current deletion-status proofs.

Live Brave comparisons on 25 October 2026 used the same author query, sort, time range and signed-in session for the existing `/search.json?type=link` route and Shreddit. Comparisons followed Shreddit's actual continuation rather than comparing unequal page sizes. The observed Shreddit batch size was seven, even when `limit=25` was supplied.

| Public profile / scope | Comparison |
| --- | --- |
| example_user / New | First 14 IDs and order matched across two Shreddit pages. |
| example_user / Hot | First 14 IDs and order matched across two Shreddit pages. |
| example_user / Top, all time | First 14 IDs and order matched across two Shreddit pages. |
| example_user / Top, past month | Both returned no results; Shreddit supplied an explicit empty-search marker. |
| example_account / New | All 12 JSON results matched in order across two Shreddit pages, ending without another cursor. |
| example_profile / New, blocked in this session | Signed-in Shreddit returned only four of the JSON route's first 14 IDs within three pages. Cookie-free Shreddit matched those 14 IDs and order across two pages. |

These samples do not prove identical lifetime coverage. The blocked-profile result prevents an unconditional replacement: the existing authenticated JSON route is retained when Reddit's current profile sidebar explicitly exposes its native `unblock_user` state. Both paths continue to use credentials inside the page world; no account preference is changed. This preserves that known coverage difference without making all discovery anonymous.

Post continuation values wrap the transport, author, sort, time range and opaque cursor. A continuation cannot silently change transport or be reused for another query scope. Refresh creates a new scope. Only matching same-origin search continuations are followed, and source failures remain incomplete.

Shreddit crossposts need special treatment: their outer result tracker can lack the regular post test ID and author field, while an inner tracker identifies the actual crosspost author. The parser matches that inner identity to the outer result ID, reads the crosspost's own timestamp and counters, and excludes embedded original posts from the result list. Format changes and unrecognized error/challenge HTML fail explicitly instead of masquerading as empty results.

## Cookie-free comment discovery: proposed next step

The current comment request remains authenticated. A previous live comparison for the blocked example_profile profile and r/TheLaptopGuide returned no signed-in comment cards but ten cookie-free cards and a continuation. This is evidence of session-dependent public search coverage, not a guarantee that anonymous requests always return more.

The long-term approach is two bounded discovery streams feeding the existing native-card pipeline:

1. Keep authenticated discovery, preserving content the signed-in account is permitted to see.
2. Add a cookie-free public supplement using the same validated author/comment query, `credentials: 'omit'` and no referrer. Do not change cookies, log out, alter the block list or forward authentication headers.
3. Maintain separate signed-in and anonymous cursors, exhaustion flags, errors and cooldowns. Never send one stream's cursor to the other. Bind both to the viewed author, account session, sort and time range; invalidate them on the corresponding change.
4. Merge by full comment ID, preserve provenance and known restriction flags, and require the returned author to match. Search discovers IDs; render cards and perform actions through the authenticated native client. An anonymous result does not establish permission for a signed-in action or prove a current deletion state.
5. Schedule the supplement only as part of explicit/profile-triggered discovery and subsequent feed-tail loading, with a shared bounded request scheduler. Prioritize visible cards, coalesce identical in-flight requests, and honor server cooldowns. Do not add a periodic sync or walk all history in the background.
6. Publish ready batches without replacing existing card objects or resetting the viewport. One stream failing must leave the other's results usable. The feed may offer another page while either stream has a valid continuation; failure or missing cursors must never be described as verified complete history.

Before enabling the supplement, test normal, curated, blocked, deleted/suspended, mature-content and access-restricted cases. Cover overlapping and disjoint pages, duplicate IDs, source-specific failures, changed formats, rate limits, cancellation, account/route changes and reverse scrolling. Keep Arctic Shift separate and opt-in; it is not interchangeable with either live discovery stream.
