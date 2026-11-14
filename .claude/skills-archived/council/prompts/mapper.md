<!-- Mapper (Explore, haiku). Read-only; returns the map as text and the main agent saves it as feature-map.md. -->
Map the "{{FEATURE}}" feature of the Chrome extension in {{ROOT}} so testers know exactly what to test. Read only what is relevant (grep first). Return at most 80 lines of markdown with these sections:

1. **Entry conditions**: which pages or communities get the feature, and the settings that gate it.
2. **Surfaces**: each page and region the feature renders, with its root selector and the native Reddit element it imitates.
3. **URL params and routes**, with every value.
4. **States and user-visible strings**: loading, empty, error, timeout, retry, end of data, partial/coverage labels. Quote the strings.
5. **Lifecycle table**, the most important section. One row per path: trigger (popstate, `reddit:route`, MutationObserver, settings change, click, timer) → function → what is created, replaced or removed (mount, unmount, `replaceChildren`, `replaceWith`, `remove`) → regions affected → whether the work is async (and what it waits on: bridge queue, network). Mark rows where a visible region is torn down and rebuilt as **TRANSITION RISK**.
6. **Data fields**: record fields rendered vs available but unused (for example `score`, `num_comments`, `domain`, `preview`, `removed_by_category`).
7. **Related components** that touch the same pages (other extension modules, the page bridge, native components reused).
8. **Documented promises** from README.md, CHANGELOG.md, docs/ and test titles in tests/, each written as one testable claim.

Sources: README.md (the feature's section), CHANGELOG.md (feature entries), docs/*{{FEATURE_KEYWORD}}*, `grep -n "test(" tests/*{{FEATURE_KEYWORD}}*.test.cjs`, and the feature's files in extension/. Code tells testers WHAT to test; it is not evidence that anything works.
