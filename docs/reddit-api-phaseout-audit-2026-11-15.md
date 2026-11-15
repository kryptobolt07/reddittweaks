# Reddit access phaseout and Reddit Tweaks dependency audit

Researched November 15, 2026. Runtime inspected: **0.36.0**, checkout `f46642e8bd110e7417fccefbdd2c526f15cdea81`. This is a source and announcement audit, not a migration or a live endpoint availability test. No extension code or settings were changed.

## Findings

The public Data API retirement is confirmed. The supplied summary overstates the evidence when it assigns every logged-in browser JSON URL the same shutdown date, treats every programmatic interface as discontinued, or says academic access necessarily requires commercial licensing.

Reddit Tweaks has substantial exposure through cookie-authenticated legacy JSON/API requests, Reddit Raffler's API-dependent backend, and Arctic Shift's upstream collection. Native Shreddit routes, native chat, and local functionality need separate treatment. An undocumented browser route is neither an announced public API exemption nor proof of a March shutdown.

## 1. Confirmed changes and timing

| Surface | Confirmed change | Timing and limits of the evidence |
| --- | --- | --- |
| Unauthenticated Reddit `.json` URLs | Reddit announced their deprecation. | May's announcement explicitly excluded logged-in/authenticated access from **that change**. It did not establish a universal HTTP status or shutdown date for every URL/session. [Official announcement](https://www.reddit.com/r/modnews/comments/1tq9vxo/protecting_communities_from_scrapers_and_platform/) |
| Public Data API applications | New access requests closed October 31, 2026; removals begin January 12, 2027 for apps/users that have not registered or responded to outreach; remaining access ends in March 2027. November 30 is the migration **funding registration** deadline; February 23 is an update/reminder. No exact March day is given. | This is retirement of ordinary public API access, not a claim that the `oauth.reddit.com` hostname will disappear. Registration is a migration step, not a permanent exception. [September timeline](https://www.reddit.com/r/redditdev/comments/1wubcvf/moving_data_api_apps_to_the_developer_platform/), [November 12 reaffirmation](https://www.reddit.com/r/redditdev/comments/1xulk8k/data_api_migration_reminder_register_your_apps/) |
| Reddit RSS feeds | Support retired November 13, 2026. Moderator alerts have Devvit alternatives; Reddit identifies no replacement for feeds outside communities the reader moderates. | This confirms the support retirement, without assuming every feed returns an identical response worldwide. [Official infrastructure announcement](https://www.reddit.com/r/modnews/comments/1wubgvt/continuing_our_infrastructure_updates_whats/) |
| Old Reddit | Login already required; further restriction announced for ordinary logged-in users without Old Reddit use in the previous six months. Logged-in moderators are exempt from the usage requirement. | The further restriction was described as arriving over the following months, with no exact rollout date. It is not an announced total Old Reddit shutdown. [Same announcement](https://www.reddit.com/r/modnews/comments/1wubgvt/continuing_our_infrastructure_updates_whats/) |

### Corrections to the broader claims

- **Every authenticated `.json` URL closes in March:** not conclusively established for cookie-authenticated website requests by the reviewed announcements. Ordinary public OAuth access is retiring; our website-session requests are a different authentication path. The distinction is an unresolved compatibility risk, not a guarantee of survival. [May scope statement](https://www.reddit.com/r/modnews/comments/1tq9vxo/protecting_communities_from_scrapers_and_platform/)
- **Only moderator apps and paid enterprise partners retain programmatic access:** too absolute. Reddit also identifies written-agreement exceptions, including accessibility apps and mobile clients such as Narwhal. Being paid, authenticated, or using a particular wrapper does not itself establish an exception. [Reddit administrator's clarification](https://www.reddit.com/r/redditdev/comments/1vgbm9c/comment/p1w1ami/)
- **All academic access must become paid:** incorrect. Approved non-commercial academic projects can use the free Reddit for Researchers dataset through BigQuery Analytics Hub. That is not continued ordinary OAuth/PRAW access. [Official research program](https://support.reddithelp.com/hc/en-us/articles/49381918834964-Reddit-for-Researchers-Program)
- **Cross-subreddit workflows have no official path:** too broad. The migration guide describes gated cross-subreddit workflows, external endpoints, HTTP Fetch allowances, and global app-mention triggers. It also acknowledges gaps. These are not a demonstrated replacement for unrestricted history discovery or our account-scoped browser extension. [Official migration guide](https://developers.reddit.com/docs/guides/migrate/public-api)
- **PRAW/Snoowrap themselves are being removed:** access behind ordinary developer credentials is being retired. Installing a newer wrapper cannot restore that access; an independently approved arrangement is a separate case. For a concrete affected app, Alerts for Reddit's maintainer reports a refused exception and a March shutdown. [Maintainer announcement](https://www.reddit.com/r/alerts_for_reddit/comments/1x9bopn/march_2027_reddit_api_changes_alerts_for_reddit/)

## 2. Direct extension dependencies

The legacy requests below generally execute on the current Reddit origin using the browser's session cookies (`credentials: include` or `same-origin`). The extension does **not** directly operate a registered public OAuth client or call `oauth.reddit.com`. Consequently, their existence is proven by source inspection, while their exact March fate remains unpublished in the sources reviewed.

### Legacy Reddit JSON and API surfaces

| Feature | Request and source | Consequence if access is removed; existing alternative |
| --- | --- | --- |
| Own-list search and identity | `/api/me.json`; `/user/<me>/{saved,hidden,upvoted,downvoted,overview}.json`. Removed uses Overview. [Bridge identity](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:607), [list reader](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:660) | Saved/Hidden/Upvoted/Downvoted/Removed searches lose their listing transport. History reads HTML, but still requires JSON identity first. Current UI ownership checks also depend on that identity. |
| Redaction identity, discovery, and writes | `/api/me.json` supplies identity and modhash; `/user/<me>/{overview,submitted,comments}.json` supports legacy listing; POST `/api/editusertext` and `/api/del` perform writes. [Identity](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:863), [listing](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:927), [write](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:951) | **All redaction modes are exposed**, including overwrite, delete, and both. Newest-first discovery already reuses native DOM/profile HTML and continuation, but identity/modhash and writes still gate the feature. Alternate sort scans retain JSON. The lack of a `.json` suffix on the write URLs does not make them independent of legacy API access. |
| Private raffle initial candidate collection | `/comments/<post>.json`. [Bridge](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:743), [UI thread reader](/home/bolt/Documents/Programs/redditchat/extension/raffle-ui.js:357) | Initial pool loading fails. Native Shreddit comment continuation exists, but the current flow still requires the initial JSON thread. Thus private draw is independent of the Raffler service, but not independent of Reddit's legacy JSON. |
| Raffle account checks, winner pictures, and chat recipient lookup | `/user/<name>/about.json`; `/api/me.json` for current-user identification. [Account reader](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:847), [recipient resolution](/home/bolt/Documents/Programs/redditchat/extension/raffle-ui.js:860) | Account-age/karma/availability qualification, winner avatar enrichment, and Reddit user-ID resolution are exposed. A native Matrix message transport does not remove its prerequisite account lookup. |
| Public raffle winner-comment enrichment | `/comments/<post>/_/<comment>.json`. [Reader](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:720) | Winner comment bodies may be absent, although results/proof links can still display from Raffler. Current code already documents an `/api/info.json` refusal and uses permalink JSON instead. That substitutes another legacy JSON route, not a distinct compatibility guarantee. |
| Not-yet-approved filter | `/r/<community>/about.json` and `/r/<community>/about/unmoderated.json`. [Moderator reader](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:696) | Moderator verification and queue loading lose their current transport. No native queue replacement is implemented here. |
| Profile status verification, archive checks, and reply context | `/api/info.json`. [Status fast path](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:440), [generic info dispatch](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:1003), [reply context](/home/bolt/Documents/Programs/redditchat/extension/post-discovery.js:2603) | Profile status verification already falls back to native fragments and suppresses the failed fast path for ten minutes. Other info uses are best-effort enrichment/current-state checks, including reply parents and restoration eligibility. Losing them reduces functionality/evidence rather than proving an archived item is currently deleted. |
| Legacy profile search cursor support | `/search.json` remains available to the JSON transport carried in a post-search cursor. [Dispatch](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:1003) | A retained JSON-transport cursor can fail. Normal new profile search now uses native Shreddit; blocked-profile search uses an anonymous native route. The JSON path is not the main current discovery transport. |
| Unavailable-community search detection | `/r/<community>/about.json`. [Reader](/home/bolt/Documents/Programs/redditchat/extension/subreddit-archive.js:110), [search gate](/home/bolt/Documents/Programs/redditchat/extension/subreddit-archive.js:768) | Archive search takeover requires a recognized banned/private response reason. Ordinary unavailable-community pages separately detect Reddit's native notice, so losing this request does not automatically disable every archive page. |
| Redaction community suggestions | `/api/me.json` followed by own-profile HTML or `/svc/shreddit/search-typeahead`. [Suggestion reader](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:612) | Suggestion content uses native surfaces, but JSON identity is still a prerequisite. Other community suggestions based on Arctic Shift have a separate external dependency. |

### Native website surfaces: separate compatibility category

These are dependencies we actually use, but the reviewed announcements do not explicitly schedule their retirement:

| Surface | Uses and current code |
| --- | --- |
| `/svc/shreddit/search/` partial HTML | Signed-in profile post/comment discovery and logged-out supplementary discovery. [Bridge](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:1016) |
| Credentialless browser session for that search | Hidden iframe executes the anonymous website flow and reuses its session. The Google Referer rule changes a request header; it does not query Google or supply an API exemption. [Public browser](/home/bolt/Documents/Programs/redditchat/extension/public-browser.js:14), [rule](/home/bolt/Documents/Programs/redditchat/extension/search-referrer-rules.json:1) |
| `/svc/shreddit/comment/`, `/partial-feed-post/`, native reload fragments | Card rendering, status fallback, and comment component loading. [Card URL selection](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:344) |
| `/svc/shreddit/comments/r/...`, `/more-comments/r/...` | Raffle comment tree/continuation. [Reader](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:764) |
| Profile pages and `/svc/shreddit/profiles/...` continuations | Newest-first redaction, History, native controls, community suggestions. [Native redaction](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:907) |
| User/community hover cards | Profile and chat identity/picture enrichment, community icons. [User reader](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:578), [chat reader](/home/bolt/Documents/Programs/redditchat/extension/page-bridge.js:707), [community reader](/home/bolt/Documents/Programs/redditchat/extension/community-icons.js:77) |
| Native navigation HTML and Reddit web components | Archive sidebars, feed/post controls, comment UI. [Navigation](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:231) |

Anonymous website access remains susceptible to access restrictions and challenges independently of the public API schedule. Retaining a successful challenge/session improves request efficiency; it cannot establish permanent access. Native HTML routes and DOM/component contracts are undocumented dependencies and can change separately.

## 3. External and transitive dependencies

### Reddit Raffler: indirect public Data API dependency

Our broker uses `www.redditraffler.com`: form/session discovery, raffle creation, job polling, and result pages. It also exposes that service's Reddit OAuth sign-in URL. [Broker](/home/bolt/Documents/Programs/redditchat/extension/raffler-broker.js:1)

The published backend instantiates **PRAW** with Reddit client ID/secret and optionally a user's refresh token. Raffle generation fetches submissions/comments and checks users through that client. Guest draws still use the backend's API credentials. This is an indirect ordinary Data API dependency even though our browser calls Raffler's own domain. [Backend Reddit service](https://github.com/redditraffler/redditraffler/blob/bfae4be3ea4885a3ceefcb2c91d7af8b833b68ee/app/services/reddit_service.py), [raffle implementation](https://github.com/redditraffler/redditraffler/blob/bfae4be3ea4885a3ceefcb2c91d7af8b833b68ee/app/util/raffler.py)

The repository pins `praw==7.1.0` and `prawcore==1.5.0`; its development README requires Reddit API applications. [Requirements](https://github.com/redditraffler/redditraffler/blob/bfae4be3ea4885a3ceefcb2c91d7af8b833b68ee/requirements.txt), [README](https://github.com/redditraffler/redditraffler/blob/bfae4be3ea4885a3ceefcb2c91d7af8b833b68ee/README.md)

**Assessment:** new public draws and sign-in-backed functionality are exposed unless the operator migrates or has a qualifying agreement. The public source does not prove the deployed service is identical, and this audit established no exemption or post-shutdown commitment. Existing database-backed result/proof pages need not disappear solely because fresh Reddit API reads stop; continued hosting is a separate unknown. Do not present Raffler as certain to close on a particular day.

Inspected upstream revision: `bfae4be3ea4885a3ceefcb2c91d7af8b833b68ee` (`staging`).

### Arctic Shift: query service versus upstream collection

Our broker calls Arctic Shift's post/comment ID lookup and search APIs, search aggregates, and subreddit search. These serve content/author restoration, archived profiles, unavailable-community feeds/threads/search, parent titles/context, community suggestions, and date coverage. [Broker lookups](/home/bolt/Documents/Programs/redditchat/extension/post-broker.js:97), [thread reader](/home/bolt/Documents/Programs/redditchat/extension/post-broker.js:188), [aggregate reader](/home/bolt/Documents/Programs/redditchat/extension/post-broker.js:346), [subreddit metadata](/home/bolt/Documents/Programs/redditchat/extension/post-broker.js:372)

These are **Arctic Shift's APIs**, not Reddit RSS or Reddit `.json` URLs. However, its own data documentation says collection uses Reddit's official API. Public API retirement therefore creates an upstream collection risk even if our requests to Arctic Shift continue succeeding. [Maintainer data notes](https://github.com/ArthurHeitmann/arctic_shift/blob/11bbf2e62db1dd1d699e1280724916a079815ec8/file_content_explanations.md)

There is direct maintainer evidence about the shutdown: on October 9, asked specifically about March 2027, the owner said the outcome was uncertain. The issue's “completed” label reflects closure by its author, not a completed migration. [Maintainer response](https://github.com/ArthurHeitmann/arctic_shift/issues/76#issuecomment-6087692292)

Reddit's access retirement does not by itself erase existing archives. Historical query availability, continued hosting, future ingestion, and snapshot freshness must be assessed separately. None is guaranteed by the others; Arctic Shift's API documentation explicitly offers no uptime/performance guarantee. [API documentation](https://github.com/ArthurHeitmann/arctic_shift/blob/11bbf2e62db1dd1d699e1280724916a079815ec8/api/README.md)

Inspected upstream revision: `11bbf2e62db1dd1d699e1280724916a079815ec8` (`master`).

### Already relevant: comment ID changes

Reddit has also replaced monotonically increasing comment IDs with base36 IDs up to 13 characters long; older IDs remain valid. The revised rollout announcement specified the week of September 28. [Official update](https://www.reddit.com/r/redditdev/comments/1whal6a/upcoming_changes_to_the_comment_id_endpoint/)

Arctic Shift's maintainer reports a working but less efficient replacement collection method, with incomplete comment coverage and delayed pickup; on October 21 they reported all comments had moved to new IDs. This is an existing coverage limitation, distinct from the unresolved March retirement. The maintainer's estimated percentage is not a guarantee for any particular thread. [Maintainer discussion](https://github.com/ArthurHeitmann/arctic_shift/issues/53)

Most extension comment validators already allow 32 characters. One compatibility defect remains in the archived-thread component fallback: it selects a comment using `^t1_[a-z0-9]{1,10}$`. A shell containing only new 13-character IDs cannot supply that fallback's representative comment; if modules are already registered or load through the earlier path, it is not exercised. This needs a targeted follow-up correction, not a conclusion that all new comments are unsupported. [Restriction](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:285), [shared validator](/home/bolt/Documents/Programs/redditchat/extension/post-model.js:6)

### Dependencies without an identified retirement link

| Dependency | Assessment |
| --- | --- |
| Reddit's native Matrix/chat client | Chat directory, event/history loading, and account identity use Reddit's existing client, including `/rooms/.../members` and `/rooms/.../events` through its authenticated transport. These are not ordinary Reddit Data API OAuth calls. No reviewed announcement schedules this transport for removal. It still depends on Reddit's native client contracts. [Bridge](/home/bolt/Documents/Programs/redditchat/extension/page-bridge.js:787) |
| Matrix winner messaging | Uses native `createRoom` and `sendTextMessage`. Its legacy user-ID lookup prerequisite is listed above; the transport itself is a separate dependency. [Messaging](/home/bolt/Documents/Programs/redditchat/extension/post-page-bridge.js:807) |
| Reddit image/media/CDN hosts | Avatars, community images, thumbnails, and Matrix media depend on Reddit-owned hosts. No reviewed announcement retires these simply because Data API/RSS access ends. [Media validation](/home/bolt/Documents/Programs/redditchat/extension/media-preview.js:10) |
| IndexedDB/local processing | Existing stored chat data, local search/filtering, UI adjustments, clean link generation, and exports do not require these retiring feeds/APIs to process already available data. Fresh data/enrichment still depends on its respective transport. |
| npm dependencies | No production npm dependencies declared. `jsdom` and `fake-indexeddb` are development/test dependencies, not Reddit API clients. PRAW is indirect through Raffler, not bundled in our extension. [Package manifest](/home/bolt/Documents/Programs/redditchat/package.json:1) |
| RSS | No runtime feed consumer or RSS fallback found. No direct extension migration needed for RSS. |
| Old Reddit | No implemented data-retrieval fallback switches to `old.reddit.com`. Some generic chat matches/URL validators accept it; major profile/raffle/redaction features exclude it. Using Old Reddit as a future fallback would add the announced access restrictions. |
| Pushshift, PullPush, Reveddit, Snoowrap | No configured runtime provider/package found. Reveddit is mentioned as provenance for a removal heuristic; PullPush appears as an example of an unconfigured future adapter. Neither constitutes a current external service dependency. |

## 4. Recommended order for subsequent work

1. **Resolve scope before redesigning:** seek a specific answer on cookie-authenticated browser-extension use of legacy read/write routes. The published public API timeline alone does not resolve it. No outreach was sent during this audit.
2. **Prioritize hard gates:** identity/modhash, own-list retrieval, redaction writes, private raffle initial comments, and raffle account/recipient lookup. Trace native alternatives per operation rather than assuming that rendering native cards removes the underlying JSON dependency.
3. **Establish provider plans:** Raffler needs a verified migration/exemption position for new public draws; Arctic Shift needs separate answers on historical hosting and future collection. Do not promise one service as a guaranteed fallback for the other.
4. **Retain proven native paths with explicit failure states:** keep HTML discovery/status fallbacks, preserve partial-coverage reporting, and isolate legacy calls so their failure cannot stall otherwise healthy native or cached functionality. Treat logged-out challenge/session reuse as reliability work, not a durable access arrangement.
5. **Correct the known comment-ID fallback restriction:** small compatibility work, independently justified by the announced ID format. No migration changes were made as part of this report.
6. **Evaluate Devvit against individual capabilities:** the official migration path has useful features and allowances, but this audit has not established a one-to-one fit for global history discovery, personal redaction, chat, or deleted-content restoration.

## 5. Verification boundaries

Checked Reddit's announcement posts, current migration documentation, the research program, runtime network call sites and callers, manifest/referrer rules, package metadata, upstream Raffler source, and Arctic Shift documentation/maintainer discussions. Public upstream captures are retained only under ignored `artifacts/research/api-phaseout-2026-11-15/`.

No authenticated actions, public raffle creations, destructive redactions, or messages were performed. No preview was used. Tests/repackaging were unnecessary because this change adds only the audit document. This report does not claim a live response proves future access, or infer private operator agreements from a currently working endpoint.

Unresolved facts remain explicit: the exact March shutdown day; treatment of each cookie-authenticated website route; deployed Raffler implementation and agreements; and Arctic Shift's final post-retirement collection/hosting plan. A conclusive audit must preserve those unknowns rather than assign unsupported dates.
