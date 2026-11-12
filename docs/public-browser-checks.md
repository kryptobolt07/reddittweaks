# Hidden signed-out Reddit search

## Contract

When a credential-free native profile search explicitly returns HTTP 403, retry
that search once in a real, invisible browser context. Do not open tabs, change
focus, scroll the user's page, or use the user's Reddit login. Ordinary successful
requests and authenticated reads keep their existing transport. HTTP 429 never
triggers an alternate route.

An inert iframe, positioned outside the viewport of the existing Reddit page,
embeds `https://www.reddit.com/` with `credentialless` set before navigation.
Reddit's own scripts run normally in the frame. Its cookies and storage use the
top document's ephemeral credentialless partition, separate from the normal
Reddit session. Requests run through the frame's own fetch; owner cookies and
tokens are never copied or forwarded. This isolates cookie/storage state; it is
not a cross-origin DOM security boundary against native Reddit scripts.

Only a page with Reddit's native Log In control and no logged-in account markers
may perform an allowlisted same-origin GET
to `/svc/shreddit/search/`, for the author of the requesting profile. Cookies
created inside this anonymous partition may be retained there; the account's
cookies are never supplied. The frame is checked again after reading, and the
existing search parsers validate results. Shells, authentication, challenge pages, unrecognized HTML and
timeouts cannot prove visibility, removal, or complete history. This transport
does not add per-comment removal verification.

## Bounds and lifecycle

- One frame per page, with one read at a time and at most two pending requests.
  Requests remain separate from chat storage work.
- Wait at most six seconds for native signed-out hydration, then five seconds
  for a read. The existing request deadlines also bound the fallback.
- Read at most three megabytes. Reject nonmatching routes, duplicate parameters,
  arbitrary endpoints, redirects and changed frame/session state.
- Parent cancellation propagates to the iframe. Late page results are discarded.
  Remove the frame after 20 idle seconds. Anonymous partition storage is scoped
  to the top document and expires when that document unloads; removing an
  individual frame does not itself clear that shared anonymous partition.
- A refusal pauses public browser checks for ten minutes; rate limiting pauses
  them for one minute. No CAPTCHA solver, header-policy removal, ordinary-frame
  fallback or authenticated fallback is used.

Initial support is limited to canonical `www.reddit.com` profile search. Existing
signed-in feeds, archives and incomplete-coverage notices remain usable if this
anonymous route is unavailable. No new permissions, hosts, extension-persisted
data or visible interface is added. Offscreen extension documents were rejected
as a transport because Reddit returns `X-Frame-Options: SAMEORIGIN` and CSP
`frame-ancestors 'self' *.reddit.com *.snooguts.net`. The implementation respects
these policies.

## Validation

Unit coverage uses synthetic data for frame isolation checks, trusted parent
messages, route authorization, parsing, cancellation, serialization, failure
cooldowns and packaging. Live checks use the actual Reddit website in Brave.

Live Reddit in Brave: the exact helper source (SHA-256
`79966b517ad68c016f11503fd1a12f2322baa6144c0579f19450198f13fcb725`)
rendered the signed-out homepage and returned ten real native comment search
results; a continuation returned five more and reused the same frame. The
ordinary credential-free request returned HTTP 403. Native account markers
confirmed the parent remained signed in while the frame was signed out.
Parent URL, focus, scroll position and horizontal scroll width remained
unchanged. Automatic idle removal was observed. No preview website was used.
The installed extension's complete fallback flow still requires an unpacked
reload; helper live checks and integration unit checks are recorded separately.
