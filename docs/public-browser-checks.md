# Hidden signed-out Reddit search

## Contract

When a credential-free native profile search explicitly returns HTTP 403, retry
that search once in a real, invisible browser context. Do not open tabs, change
focus, scroll the user's page, or use the user's Reddit login. Ordinary successful
requests and authenticated reads keep their existing transport. HTTP 429 never
triggers an alternate route.

An inert iframe, positioned outside the viewport of the existing Reddit page,
embeds `https://www.reddit.com/` with `credentialless` set before navigation.
Reddit's own scripts and automatic verification form run normally in the frame;
popups and top-level navigation remain blocked. The homepage navigation uses a
real, origin-only Reddit referrer, without the current profile path. Its cookies and storage use the
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

Server-rendered Log In markup alone is not initialization proof. The iframe
document must finish loading and Reddit's `shreddit-app` component must be
registered before its first public request.

## Bounds and lifecycle

- One frame per page, with one read at a time and at most two pending requests.
  Requests remain separate from chat storage work.
- Wait at most six seconds for native signed-out hydration, then five seconds
  for a read. The existing request deadlines also bound the fallback.
- Read at most three megabytes. Reject nonmatching routes, duplicate parameters,
  arbitrary endpoints, redirects and changed frame/session state.
- Parent cancellation propagates to the iframe. Late page results are discarded.
  Remove the frame after 60 idle seconds. Anonymous partition storage is scoped
  to the top document and expires when that document unloads; removing an
  individual frame does not itself clear that shared anonymous partition.
- A refusal pauses public browser checks for ten minutes. Explicit Refresh
  activity may probe again without discarding a healthy session. Rate limiting
  honors numeric or HTTP-date Retry-After, bounded to one hour, with a one-minute
  default; Refresh cannot bypass an active rate limit. No CAPTCHA solver, header-policy removal, ordinary-frame
  fallback or authenticated fallback is used.

Initial support is limited to canonical `www.reddit.com` profile search. Existing
signed-in feeds, archives and incomplete-coverage notices remain usable if this
anonymous route is unavailable. No new permissions, hosts, extension-persisted
data or visible interface is added. Offscreen extension documents were rejected
as a transport because Reddit returns `X-Frame-Options: SAMEORIGIN` and CSP
`frame-ancestors 'self' *.reddit.com *.snooguts.net`. The implementation respects
these policies.

## Anonymous-session reuse policy

| State | Retention and renewal |
| --- | --- |
| Anonymous cookies, including verification cookies | Managed by the browser inside the credentialless partition. Reused with their native expiry; never exported to extension storage, copied into the signed-in jar, or manually reconstructed. |
| Running anonymous frame | Reused across reads, pagination and explicit activity refresh. Removed after 60 idle seconds; later frames in the same top document can reuse that anonymous partition's cookies. |
| Temporary request failure | Keep a healthy frame after network timeouts, HTTP 5xx and rate limits. Do not repeat verification solely because a request failed. |
| Invalid or blocked anonymous state | Discard the frame when signed-out proof is lost or Reddit refuses the public request. Reinitialize through Reddit's native browser flow on the next permitted attempt. |
| Verification scripts, form solutions and tokens | Execute only as Reddit's own page code. No extension-side solver, token parsing or stored challenge solution. |
| Search results | No additional result cache. Every requested page is fetched again using the reusable anonymous session. |

A full browser page reload creates a new credentialless partition. Ordinary
Reddit SPA navigation can retain it. This implementation does not claim durable
anonymous verification across full reloads; normal browser initialization runs
again when required. Interactive CAPTCHA remains a user action.

## Validation

Unit coverage uses synthetic data for frame isolation checks,
route authorization, parsing, cancellation, serialization, failure
cooldowns and packaging. Live checks use the actual Reddit website in Brave.

Live Reddit in Brave: a credentialless browser helper
rendered the signed-out homepage and returned ten real native comment search
results; a continuation returned five more and reused the same frame. The
ordinary credential-free request returned HTTP 403. Native account markers
confirmed the parent remained signed in while the frame was signed out.
Parent URL, focus, scroll position and horizontal scroll width remained
unchanged. Automatic idle removal was observed. No preview website was used.

The first installed build exposed a cold-start issue: suppressing the navigation
referrer returned a JavaScript-only verification page, and the sandbox blocked
its automatic form submission. Controlled fresh-document checks confirmed an
origin-only referrer loads the native signed-out page and returns search HTTP
200. Separately, enabling native forms allowed Reddit's own JS verification
submission to complete and return HTTP 200; only query field names were
observed, never token values. The corrected installed build still requires an
unpacked reload to verify the complete fallback flow.

The first installed automatic read also exposed an early-start race: native
login markup could be available before browser initialization finished. The
readiness check now waits for document completion and native app registration;
the regression test prevents server-rendered markup alone from starting a read.
