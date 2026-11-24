const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('jsdom');

const read = file => fs.readFileSync('extension/' + file, 'utf8');
const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

const SAMPLE_ITEMS = [
  {
    uuid: 'uuidOne123',
    title: 'Gelato Cone',
    thumb: 'https://image.infini.wtf/uuidOne123/400/80/thumbnail.webp',
    src: 'https://image.infini.wtf/uuidOne123/800/80/original.webp',
    srcset: '',
    videoUrl: '',
    isVideo: false,
    isGif: false,
    width: 800,
    height: 1000,
    aspectRatio: 0.8,
    downloadUrl: 'https://infini.wtf/download/uuidOne123?is_animated=false',
    permalink: 'https://www.reddit.com/r/pixelart/comments/1gylby2/gelato_cone/',
    subreddit: 'pixelart',
    postId: '1gylby2',
    viewId: 'gelato-cone-uuidOne123'
  },
  {
    uuid: 'uuidTwo456',
    title: 'Soft Serve Video',
    thumb: 'https://image.infini.wtf/uuidTwo456/400/80/thumbnail.webp',
    src: 'https://image.infini.wtf/uuidTwo456/800/80/original.webp',
    srcset: '',
    videoUrl: 'https://video.infini.wtf/uuidTwo456/original.mp4',
    isVideo: true,
    isGif: false,
    width: 1280,
    height: 720,
    aspectRatio: 1.7778,
    downloadUrl: 'https://infini.wtf/download/uuidTwo456?is_animated=true',
    permalink: 'https://www.reddit.com/r/pics/comments/9xyz1/soft_serve/',
    subreddit: 'pics',
    postId: '9xyz1',
    viewId: 'soft-serve-uuidTwo456'
  }
];

function searchHtml() {
  return `<!doctype html><html><body>
    <reddit-search-large></reddit-search-large>
    <main id="main-content">
      <faceplate-tabgroup id="search-results-page-tabgroup">
        <a id="search-results-page-tab-posts" slot="posts" class="text-14 font-semibold" href="/search/?q=ice+cream&type=posts">Posts</a>
        <a id="search-results-page-tab-media" slot="media" class="text-14 font-semibold bg-neutral-background-selected" faceplate-tab-selected aria-current="page" style="background-color: var(--color-secondary-background-selected);" href="/search/?q=ice+cream&type=media">Media</a>
      </faceplate-tabgroup>
      <div class="bg-neutral-background" id="native-results">
        <search-media-feed>Native Media</search-media-feed>
      </div>
    </main>
  </body></html>`;
}

function setupUi(t, {
  url = 'https://www.reddit.com/search/?q=ice+cream&type=media&rt_visual=1',
  html = searchHtml(),
  settings = { visualSearch: true, visualSearchPostMenu: true },
  phone = false,
  hover = false,
  fastTimers = false,
  sendImpl,
  observe = false
} = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const W = dom.window;
  const D = W.document;
  const sent = [];

  if (fastTimers) {
    const rawSetTimeout = W.setTimeout.bind(W);
    W.setTimeout = (fn, ms, ...rest) => rawSetTimeout(fn, ms > 50 ? 5 : ms, ...rest);
  }

  W.matchMedia = query => ({
    matches: query.includes('max-width: 767.98px') ? phone : query.includes('hover: hover') ? hover : false,
    media: query,
    addEventListener() {},
    removeEventListener() {}
  });
  W.scrollTo = (arg1, arg2) => {
    const top = typeof arg1 === 'object' ? arg1.top : arg2;
    if (typeof top === 'number') {
      Object.defineProperty(W, 'scrollY', { value: top, configurable: true, writable: true });
    }
  };
  W.scrollBy = (arg1, arg2) => {
    const dy = typeof arg1 === 'object' ? arg1.top : arg2;
    if (typeof dy === 'number') {
      W.scrollTo({ top: (W.scrollY || 0) + dy });
    }
  };
  Object.defineProperty(D.documentElement, 'scrollHeight', { value: 2400, configurable: true });

  // Wire Reddit's faceplate-tabgroup shared Shadow DOM tablist + header search shadow root
  const tg = D.querySelector('#search-results-page-tabgroup');
  if (tg) {
    const tgSr = tg.attachShadow({ mode: 'open' });
    tgSr.innerHTML = '<div class="container"><div class="tablist" role="tablist"><span role="tab" data-i="1" aria-selected="false"><slot name="posts"></slot></span><span role="tab" data-i="2" aria-selected="true"><slot name="media"></slot></span></div></div>';
  }
  const searchHeader = D.querySelector('reddit-search-large');
  if (searchHeader) {
    const sr = searchHeader.attachShadow({ mode: 'open' });
    const form = D.createElement('form');
    const field = D.createElement('faceplate-search-input');
    field.setAttribute('name', 'q');
    const input = D.createElement('input');
    input.name = 'q';
    input.value = 'ice cream';
    field.append(input);
    const drop = D.createElement('div');
    drop.id = 'search-dropdown-results-container';
    const ul = D.createElement('ul');
    ul.id = 'reddit-typeahead-results-partial-container';
    drop.append(ul);
    form.append(field);
    sr.append(form, drop);
  }

  W.RTCommunityIcons = {
    peek(sub) { return sub.toLowerCase() === 'pixelart' ? 'https://styles.redditmedia.com/t5_pixel/styles/communityIcon_a.png' : undefined; },
    async get(sub) { return sub.toLowerCase() === 'pics' ? 'https://styles.redditmedia.com/t5_pics/styles/communityIcon_b.png' : null; }
  };

  for (const file of ['post-model.js', 'download-model.js', 'post-menu-dom.js', 'feed-sheet.js', 'visual-search-model.js']) {
    W.eval(read(file));
  }
  W.__rtVisualSearchTest = true;
  W.eval(read('visual-search.js'));

  const controller = new W.RTVisualSearch.VisualSearchController({
    observe,
    readSettings: async () => settings,
    send: async msg => {
      sent.push(msg);
      if (sendImpl) return sendImpl(msg);
      if (msg.action === 'query') {
        return { ok: true, items: SAMPLE_ITEMS, skippedCount: 0, page: msg.page || 1, hasMore: false, nextPage: 0, endpointKind: msg.kind, filterable: msg.kind !== 'view' };
      }
      if (msg.action === 'related') {
        return { ok: true, items: [{ label: 'gelato', slug: 'gelato' }] };
      }
      return { ok: true };
    }
  });

  t.after(() => {
    controller.destroy();
    W.close();
  });

  return { W, D, controller, sent, tg, searchHeader };
}

test('visual-search modules contain zero unsafe HTML DOM injection sinks', () => {
  for (const file of ['visual-search-boot.js', 'visual-search-model.js', 'visual-search-broker.js', 'visual-search.js']) {
    const stripped = read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    assert.equal(/\b(?:innerHTML|outerHTML|insertAdjacentHTML|document\.write)\b/.test(stripped), false, file + ' must not use HTML string sinks');
  }
});

test('visual-search-boot sets data-rt-visual-active before paint only when session enabled and rt_visual=1', t => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.reddit.com/search/?q=ice+cream&type=media&rt_visual=1',
    runScripts: 'outside-only'
  });
  const W = dom.window;
  t.after(() => W.close());

  W.eval(read('visual-search-boot.js'));
  assert.equal(W.document.documentElement.hasAttribute('data-rt-visual-active'), false);

  W.sessionStorage.setItem('rt-visual-enabled-v1', '1');
  W.dispatchEvent(new W.PopStateEvent('popstate'));
  assert.equal(W.document.documentElement.hasAttribute('data-rt-visual-active'), true);

  W.document.documentElement.removeAttribute('data-rt-visual-active');
  W.history.replaceState({}, '', 'https://www.reddit.com/search/?q=ice+cream&type=media');
  W.dispatchEvent(new W.PopStateEvent('popstate'));
  assert.equal(W.document.documentElement.hasAttribute('data-rt-visual-active'), false);
});

test('T1 & T2 & T3: initial mount hides native results, clicking tile holds grid until post swaps in, and Back restores parked DOM + scroll with zero refetch', async t => {
  const { W, D, controller, sent } = setupUi(t);
  await controller.ready;
  await flush();

  // T1: active route rendered
  assert.equal(D.documentElement.hasAttribute('data-rt-visual-active'), true);
  assert.equal(D.documentElement.hasAttribute('data-rt-visual-ready'), true);
  const host = D.querySelector('[data-rt-ui="visual-search"]');
  assert.ok(host);
  const nativeBox = D.getElementById('native-results');
  assert.equal(nativeBox.hidden, true);
  assert.equal(nativeBox.hasAttribute('data-rt-visual-hidden'), true);
  assert.equal(host.querySelectorAll('.rt-vs-tile').length, 2);
  // Zero nested anchors inside tiles (thumb link + meta + title link are siblings)
  assert.equal(host.querySelector('.rt-vs-tile a a'), null);
  const queryCallsAfterMount = sent.filter(m => m.action === 'query').length;
  assert.equal(queryCallsAfterMount, 1);

  // T2: Simulate scroll down and click first tile to open Reddit post
  W.scrollTo({ top: 320 });
  const tileLink = host.querySelector('.rt-vs-tile a.rt-vs-card-link');
  let prevented = false;
  D.addEventListener('click', e => {
    if (e.target.closest('a.rt-vs-card-link')) { e.preventDefault(); prevented = true; }
  });
  tileLink.click();
  assert.equal(prevented, true);
  assert.ok(controller.outgoing, 'outgoing hold must stay active while post page is loading');

  // Reddit changes URL via pushState before swapping <main>: outgoing grid must remain mounted!
  W.history.pushState({}, '', tileLink.href);
  controller.handleRoute();
  assert.equal(host.isConnected, true);
  assert.equal(D.documentElement.hasAttribute('data-rt-visual-active'), true);
  assert.equal(nativeBox.hidden, true);

  // Now Reddit replaces <main> with the opened post page
  const oldMain = D.getElementById('main-content');
  const postMain = D.createElement('main');
  const postEl = D.createElement('shreddit-post');
  postEl.setAttribute('view-context', 'CommentsPage');
  postMain.append(postEl);
  oldMain.replaceWith(postMain);
  controller.sync();

  assert.equal(controller.outgoing, null);
  assert.equal(host.isConnected, false);
  assert.equal(D.documentElement.hasAttribute('data-rt-visual-active'), false);
  assert.equal(W.scrollY, 0, 'newly opened Reddit post scrolls to top');

  // T3: Browser Back from post while post <main> is still present + delayed swap (even showing search-error-message before tabs)
  W.history.back();
  W.history.replaceState({}, '', 'https://www.reddit.com/search/?q=ice+cream&type=media&rt_visual=1');
  controller.handleRoute({ type: 'popstate' });
  // Must NOT mount Visual into outgoing CommentsPage <main>
  assert.equal(postMain.querySelector('[data-rt-ui="visual-search"]'), null);
  assert.ok(controller.waitingForReplacedMain === postMain);

  // Now simulate Reddit reusing/replacing into search DOM starting with search-error-message before tabs arrive
  postEl.remove();
  const errDiv = D.createElement('div');
  errDiv.setAttribute('data-testid', 'search-error-message');
  postMain.append(errDiv);
  controller.sync();

  // Parked DOM restored instantaneously with ZERO refetch!
  const restoredHost = D.querySelector('[data-rt-ui="visual-search"]');
  assert.ok(restoredHost);
  assert.equal(restoredHost, host, 'adopts exact parked host DOM');
  assert.equal(errDiv.hidden, true, 'native search-error-message suppressed');
  assert.equal(sent.filter(m => m.action === 'query').length, queryCallsAfterMount);
  await flush();
  assert.equal(W.scrollY, 320, 'scroll position restored on Back');

  // User scroll aborts scroll restoration immediately
  W.dispatchEvent(new W.Event('wheel', { bubbles: true }));
  assert.equal(controller.userScrolledRecently, true);
});

test('T5: Media <-> Visual fast swap works instantaneously and Back to baseNativeUrl skips 6s hold', async t => {
  const { W, D, controller, tg } = setupUi(t, {
    url: 'https://www.reddit.com/search/?q=ice+cream&type=media'
  });
  await controller.ready;
  await flush();

  const visualTab = D.getElementById('search-results-page-tab-visual');
  assert.ok(visualTab);
  const slotWraps = [...tg.shadowRoot.querySelectorAll('.tablist > [role="tab"]')];
  assert.equal(slotWraps.length, 3);
  const visualWrap = slotWraps[2];
  assert.equal(visualWrap.dataset.rtUi, 'visual-search-slot');
  assert.equal(visualWrap.querySelector('slot')?.getAttribute('name'), 'visual');
  assert.equal(slotWraps[1].querySelector('slot')?.getAttribute('name'), 'media', 'visual slot inserted immediately after media');

  // Click Visual from native Media -> pushState + immediate mount in same <main>
  visualTab.click();
  await flush();
  const mediaTab = D.getElementById('search-results-page-tab-media');
  const mediaWrap = slotWraps[1];
  assert.equal(new URL(W.location.href).searchParams.get('rt_visual'), '1');
  assert.ok(D.querySelector('[data-rt-ui="visual-search"]'));
  assert.equal(D.getElementById('native-results').hidden, true);
  assert.equal(visualTab.getAttribute('aria-current'), 'page');
  assert.equal(visualTab.hasAttribute('faceplate-tab-selected'), true);
  assert.equal(visualWrap.getAttribute('aria-selected'), 'true');
  assert.equal(mediaWrap.getAttribute('aria-selected'), 'false');
  assert.equal(mediaTab.hasAttribute('data-rt-visual-tab-muted'), true);

  // Click native Media tab back -> reveals native Media in 0ms without departure hold and restores native selection
  mediaTab.click();
  await flush();
  assert.equal(D.querySelector('[data-rt-ui="visual-search"]'), null);
  assert.equal(controller.outgoing, null);
  assert.equal(D.getElementById('native-results').hidden, false);
  assert.equal(mediaTab.getAttribute('aria-current'), 'page');
  assert.equal(mediaTab.hasAttribute('faceplate-tab-selected'), true);
  assert.equal(mediaTab.hasAttribute('data-rt-visual-tab-muted'), false);
  assert.equal(mediaWrap.getAttribute('aria-selected'), 'true');
  assert.equal(visualWrap.getAttribute('aria-selected'), 'false');
  assert.equal(visualTab.hasAttribute('faceplate-tab-selected'), false);

  // Repeat forward into Visual, then browser Back to baseNativeUrl (popstate) must also unmount immediately
  visualTab.click();
  await flush();
  assert.ok(D.querySelector('[data-rt-ui="visual-search"]'));
  W.history.replaceState({}, '', 'https://www.reddit.com/search/?q=ice+cream&type=media');
  controller.handleRoute({ type: 'popstate' });
  assert.equal(controller.outgoing, null);
  assert.equal(D.querySelector('[data-rt-ui="visual-search"]'), null);
  assert.equal(D.getElementById('native-results').hidden, false);
});

test('masonry aspect ratios, community icons, icon-only video/GIF badges, quiet load-more, and Similar keeps the query and Back works', async t => {
  const { W, D, controller } = setupUi(t, {
    sendImpl: async msg => {
      if (msg.action === 'query' && msg.kind === 'search' && (msg.page || 1) === 1) {
        return {
          ok: true,
          items: SAMPLE_ITEMS,
          skippedCount: 0,
          page: 1,
          hasMore: true,
          nextPage: 2,
          endpointKind: 'search',
          filterable: true
        };
      }
      if (msg.action === 'query' && msg.kind === 'search' && msg.page === 2) {
        return {
          ok: true,
          items: [
            SAMPLE_ITEMS[0], // duplicate should be deduped
            {
              uuid: 'uuidPage2Gif',
              title: 'Swirl GIF',
              thumb: 'https://image.infini.wtf/uuidPage2Gif/400/80/thumbnail.webp',
              src: 'https://image.infini.wtf/uuidPage2Gif/400/80/thumbnail.webp',
              videoUrl: 'https://video.infini.wtf/uuidPage2Gif/original.mp4',
              isVideo: true,
              isGif: true,
              width: 500,
              height: 500,
              aspectRatio: 1,
              permalink: 'https://www.reddit.com/r/gifs/comments/p2gif/',
              subreddit: 'gifs',
              postId: 'p2gif',
              viewId: 'swirl-gif-uuidPage2Gif'
            }
          ],
          skippedCount: 0,
          page: 2,
          hasMore: false,
          nextPage: 0,
          endpointKind: 'search',
          filterable: true
        };
      }
      if (msg.action === 'query' && msg.kind === 'view') {
        return {
          ok: true,
          items: [SAMPLE_ITEMS[1]],
          skippedCount: 0,
          page: 1,
          hasMore: false,
          nextPage: 0,
          endpointKind: 'view',
          filterable: false
        };
      }
      return { ok: true };
    }
  });
  await controller.ready;
  await flush();

  const cols = D.querySelectorAll('.rt-vs-masonry .rt-vs-col');
  assert.equal(cols.length, 3, 'desktop masonry renders 3 columns');
  const firstTile = D.querySelector('.rt-vs-tile[data-uuid="uuidOne123"]');
  assert.equal(firstTile.querySelector('.rt-vs-media').style.aspectRatio, '0.8');
  assert.equal(
    firstTile.querySelector('.rt-vs-sub-avatar')?.getAttribute('src'),
    'https://styles.redditmedia.com/t5_pixel/styles/communityIcon_a.png',
    'sync peek populates subreddit icon immediately'
  );
  const secondTile = D.querySelector('.rt-vs-tile[data-uuid="uuidTwo456"]');
  assert.equal(
    secondTile.querySelector('.rt-vs-sub-avatar')?.getAttribute('src'),
    'https://styles.redditmedia.com/t5_pics/styles/communityIcon_b.png',
    'async RTCommunityIcons.get resolves second subreddit icon'
  );
  const badge = secondTile.querySelector('.rt-vs-badge');
  assert.equal(badge.textContent.trim(), '', 'a symbol, not the word VIDEO');
  assert.equal(badge.getAttribute('aria-label'), 'Video');
  assert.ok(badge.querySelector('svg'));
  assert.equal(firstTile.querySelectorAll('.rt-vs-overlay-actions button').length, 2);
  for (const b of firstTile.querySelectorAll('.rt-vs-overlay-actions button')) assert.equal(b.textContent.trim(), '', 'icon-only hover buttons');
  assert.ok(firstTile.querySelector('.rt-vs-sub-row .rt-vs-more-btn[aria-label="More options"]'), 'touch ⋯ menu');

  // Below the grid there is no count bar or Media tab link: just the sentinel that loads the next page.
  const foot = D.querySelector('.rt-vs-foot');
  assert.equal(foot.textContent.trim(), '');
  assert.equal(foot.querySelector('a'), null);
  assert.equal(foot.dataset.state, 'more');
  const loading = controller.loadMore();
  assert.equal(D.querySelector('.rt-vs-foot').dataset.state, 'loading');
  assert.equal(D.querySelectorAll('.rt-vs-foot .shimmer-placeholder.bg-shimmer.rounded-2').length, 9, 'Reddit’s placeholder row while loading');
  await loading;
  await flush();
  assert.equal(D.querySelector('.rt-vs-tile[data-uuid="uuidOne123"]'), firstTile, 'existing page 1 tile DOM preserved');
  const tiles = D.querySelectorAll('.rt-vs-tile');
  assert.equal(tiles.length, 3);
  assert.equal(D.querySelector('.rt-vs-tile[data-uuid="uuidPage2Gif"] .rt-vs-badge').getAttribute('aria-label'), 'GIF');
  assert.equal(D.querySelector('.rt-vs-foot').dataset.state, 'end');
  assert.equal(D.querySelector('.rt-vs-foot').textContent.trim(), '');

  // Clicking Similar pushes state so Back restores the 3-tile masonry cleanly; q stays so Reddit keeps its All tab.
  firstTile.querySelector('.rt-vs-overlay-actions button[aria-label="Find visually similar"]').click();
  await flush();
  assert.equal(new URL(W.location.href).searchParams.get('rt_vview'), 'gelato-cone-uuidOne123');
  assert.equal(new URL(W.location.href).searchParams.get('q'), 'ice cream');
  assert.equal(D.querySelectorAll('.rt-vs-tile').length, 1);

  W.history.replaceState({}, '', 'https://www.reddit.com/search/?q=ice+cream&type=media&rt_visual=1');
  controller.handleRoute({ type: 'popstate' });
  assert.equal(D.querySelectorAll('[data-rt-ui="visual-search"]').length, 1, 'never leaves duplicate visual host nodes in <main>');
  assert.equal(D.querySelectorAll('.rt-vs-tile').length, 3, 'Back restores parked multi-page masonry');
});

test('search bar Enter dismisses dropdown, navigates new queries, and ignores arrow-selected suggestions', async t => {
  const { W, D, controller, searchHeader, sent } = setupUi(t);
  await controller.ready;
  await flush();

  const sr = searchHeader.shadowRoot;
  const input = sr.querySelector('input[name="q"]');
  const drop = sr.getElementById('search-dropdown-results-container');
  const ul = sr.getElementById('reddit-typeahead-results-partial-container');

  // 1. If a typeahead suggestion row is aria-selected="true", let Reddit handle Enter natively
  const row = D.createElement('li');
  row.setAttribute('aria-selected', 'true');
  ul.append(row);
  let navigated = '';
  D.addEventListener('click', e => {
    const a = e.target.closest('a[data-rt-ui="visual-nav-link"]');
    if (a) { e.preventDefault(); navigated = a.href; }
  });
  const selEvt = new W.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true });
  input.dispatchEvent(selEvt);
  assert.equal(selEvt.defaultPrevented, false);
  assert.equal(navigated, '');
  row.remove();

  // 2. Normal query Enter hides dropdown, shows orange progress bar, prefetches, and calls native navigateUrl
  input.value = 'chocolate cake';
  const subEvt = new W.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, composed: true, cancelable: true });
  input.dispatchEvent(subEvt);
  assert.equal(subEvt.defaultPrevented, true);
  assert.equal(drop.classList.contains('hidden'), true, 'search dropdown closed on Enter');
  assert.ok(D.querySelector('[data-rt-ui="visual-progress"]'), 'orange top progress bar active');
  assert.ok(navigated.includes('q=chocolate+cake') && navigated.includes('rt_visual=1'));
  assert.ok(sent.some(m => m.action === 'query' && m.target === 'chocolate-cake'));
});

test('Visual -> Posts tab switch holds mounted host until <main> swaps, and desktop dropdown updates filters cleanly', async t => {
  const { W, D, controller, sent } = setupUi(t);
  await controller.ready;
  await flush();

  // Desktop dropdown menu opens .rt-inline-menu (not mobile RTFeedSheet)
  const mediaBtn = D.querySelector('[data-rt-visual-control="media"]');
  mediaBtn.click();
  const menu = D.querySelector('[data-rt-ui="visual-menu"].rt-inline-menu');
  assert.ok(menu, 'desktop Media filter opens .rt-inline-menu dropdown');
  assert.equal(D.querySelector('[data-rt-ui="feed-sheet"]'), null);
  const imagesOption = [...menu.querySelectorAll('[role="menuitemradio"]')].find(el => el.textContent.includes('Images'));
  assert.ok(imagesOption);
  imagesOption.click();
  await flush();
  assert.equal(new URL(W.location.href).searchParams.get('rt_vmedia'), 'images');
  assert.equal(sent.at(-1).filters.mediaType, 'images');

  // Clicking non-Media sibling tab (Posts) holds Visual host until Reddit swaps <main>
  const postsTab = D.getElementById('search-results-page-tab-posts');
  D.addEventListener('click', e => {
    if (e.target.closest('#search-results-page-tab-posts')) e.preventDefault();
  });
  const hostBefore = D.querySelector('[data-rt-ui="visual-search"]');
  postsTab.click();
  assert.ok(controller.outgoing, 'switching Visual -> Posts starts departure hold');

  W.history.pushState({}, '', postsTab.href);
  controller.handleRoute();
  assert.equal(hostBefore.isConnected, true, 'Visual grid stays visible while outgoing <main> still connected');
  assert.equal(D.documentElement.hasAttribute('data-rt-visual-active'), true);

  const oldMain = D.getElementById('main-content');
  const nextMain = D.createElement('main');
  nextMain.textContent = 'Posts results';
  oldMain.replaceWith(nextMain);
  controller.sync();
  assert.equal(controller.outgoing, null);
  assert.equal(hostBefore.isConnected, false);
  assert.equal(D.documentElement.hasAttribute('data-rt-visual-active'), false);
});

test('pending upload hash polls check-image-query until embedding is ready and switches to rt_vupload', async t => {
  const hash = 'b'.repeat(64);
  let checks = 0;
  const { W, D, controller } = setupUi(t, {
    url: `https://www.reddit.com/search/?q=&type=media&rt_visual=1&rt_vhash=${hash}`,
    fastTimers: true,
    sendImpl: async msg => {
      if (msg.action === 'check-image-query') {
        checks++;
        assert.equal(msg.hash, hash);
        if (checks < 2) return { ok: true, exists: true, hasEmbedding: false, uuid: '' };
        return { ok: true, exists: true, hasEmbedding: true, uuid: 'readyUpload77' };
      }
      if (msg.action === 'query') {
        assert.equal(msg.kind, 'upload');
        assert.equal(msg.target, 'readyUpload77');
        return { ok: true, items: SAMPLE_ITEMS, skippedCount: 0, endpointKind: 'upload', filterable: true, capped: true };
      }
      return { ok: true };
    }
  });
  await controller.ready;
  for (let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 10));

  assert.equal(checks, 2);
  const url = new URL(W.location.href);
  assert.equal(url.searchParams.get('rt_vupload'), 'readyUpload77');
  assert.equal(url.searchParams.has('rt_vhash'), false);
  assert.equal(D.querySelectorAll('.rt-vs-tile').length, 2);
});

test('post overflow menu adds "Find visually similar" and unindexed post offers explicit upload/title actions', async t => {
  const html = `<!doctype html><html><body><main id="main-content">
    <shreddit-post id="t3_post1" post-type="image" post-title="Neon Sunset" content-href="https://i.redd.it/neon.jpg" permalink="/r/PixelArt/comments/post1/neon_sunset/">
      <div slot="post-media-container"><img src="https://i.redd.it/neon.jpg" width="800" height="600"></div>
      <shreddit-post-overflow-menu post-id="t3_post1">
        <div slot="devvit-context-actions"></div>
      </shreddit-post-overflow-menu>
    </shreddit-post>
  </main></body></html>`;

  const { W, D, controller, sent } = setupUi(t, {
    url: 'https://www.reddit.com/r/PixelArt/',
    html,
    sendImpl: async msg => {
      if (msg.action === 'resolve-post') return { ok: true, indexed: false };
      if (msg.action === 'query') return { ok: true, items: SAMPLE_ITEMS, skippedCount: 0, endpointKind: msg.kind, filterable: true, capped: true };
      return { ok: true };
    }
  });
  await controller.ready;
  await flush();

  const item = D.querySelector('[data-rt-visual-menu="item"]');
  assert.ok(item, 'adds Find visually similar to media post menu');
  assert.match(item.textContent, /Find visually similar/);

  let navigated = '';
  D.addEventListener('click', e => {
    const a = e.target.closest('a[data-rt-ui="visual-nav-link"]');
    if (a) { e.preventDefault(); navigated = a.href; }
  });
  item.querySelector('[role="menuitem"]').click();
  assert.ok(navigated.includes('rt_vpost=pixelart%2Fpost1'));
  assert.equal(sent.some(m => m.action === 'upload-image'), false, 'never uploads post image automatically');

  // Navigate to unindexed rt_vpost URL -> displays thumbnail + explicit actions without auto-upload
  W.history.pushState({}, '', navigated);
  controller.handleRoute();
  await flush();
  const host = D.querySelector('[data-rt-ui="visual-search"]');
  assert.ok(host);
  assert.equal(sent.some(m => m.action === 'resolve-post'), true);
  assert.equal(sent.some(m => m.action === 'upload-image'), false);
  assert.match(host.textContent, /Upload post image to search visually/);
  assert.match(host.textContent, /Search by title instead/);
});

test('phone viewport opens RTFeedSheet bottom sheets and NSFW reset clears |1| cache without exposing gay/trans', async t => {
  const { D, controller, sent, searchHeader } = setupUi(t, {
    url: 'https://www.reddit.com/search/?q=ice+cream&type=media&rt_visual=1&rt_vnsfw=1',
    phone: true
  });
  await controller.ready;
  await flush();

  // Header trigger inside shadow root
  const headerBtn = searchHeader.shadowRoot.querySelector('[data-rt-ui="visual-search-trigger"]');
  assert.ok(headerBtn);
  headerBtn.click();
  assert.ok(D.querySelector('[data-rt-ui="feed-sheet"]'), 'phone header camera button opens RTFeedSheet');

  // Media filter opens RTFeedSheet
  const mediaBtn = D.querySelector('[data-rt-visual-control="media"]');
  mediaBtn.click();
  assert.ok(D.querySelector('[data-rt-ui="feed-sheet"]'));
  D.querySelector('[data-rt-ui="feed-sheet"]')?.remove();

  // Turning NSFW off calls clear-cache({ nsfwOnly: true }) and uses Reddit nsfw-fill-12 styling
  const nsfwBtn = D.querySelector('[data-rt-visual-control="nsfw"]');
  assert.equal(nsfwBtn.getAttribute('aria-pressed'), 'true');
  assert.ok(nsfwBtn.querySelector('svg[icon-name="nsfw-fill-12"]'));
  assert.equal(nsfwBtn.textContent.trim(), 'NSFW');
  nsfwBtn.click();
  await flush();
  assert.equal(sent.some(m => m.action === 'clear-cache' && m.nsfwOnly === true), true);
  assert.equal(D.body.textContent.toLowerCase().includes('trans'), false);
  assert.equal(D.body.textContent.toLowerCase().includes('gay'), false);
});

test('coexistence guards yield to active Visual Search and opt-out restores original Reddit DOM', async t => {
  const { D, controller, tg } = setupUi(t);
  await controller.ready;
  await flush();

  // Opt-out via applySettings(visualSearch: false)
  controller.applySettings({ visualSearch: false });
  assert.equal(D.documentElement.hasAttribute('data-rt-visual-active'), false);
  assert.equal(D.querySelector('[data-rt-ui="visual-search"]'), null);
  assert.equal(D.getElementById('search-results-page-tab-visual'), null);
  assert.equal(tg.shadowRoot.querySelector('[data-rt-ui="visual-search-slot"]'), null);
  assert.equal(tg.shadowRoot.querySelector('.tablist > [data-i="2"]').getAttribute('aria-selected'), 'true');
  assert.equal(D.getElementById('search-results-page-tab-media').style.backgroundColor, 'var(--color-secondary-background-selected)');
  assert.equal(D.getElementById('search-results-page-tab-media').hasAttribute('faceplate-tab-selected'), true);
  assert.equal(D.getElementById('native-results').hidden, false);

  // Re-verify post-discovery & subreddit-archive & live-subreddit-filters yield guards in VM
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.reddit.com/user/Example/search/?q=ice&type=media&rt_visual=1',
    runScripts: 'outside-only'
  });
  t.after(() => dom.window.close());
  const W2 = dom.window;
  W2.document.documentElement.setAttribute('data-rt-visual-active', '');

  const pdSrc = read('post-discovery.js');
  assert.ok(pdSrc.includes("params.get('rt_visual')==='1' && document.documentElement?.hasAttribute('data-rt-visual-active')"));
  const saSrc = read('subreddit-archive.js');
  assert.ok(saSrc.includes("params.get('rt_visual')==='1' && document.documentElement?.hasAttribute('data-rt-visual-active')"));
  const lsfSrc = read('live-subreddit-filters.js');
  assert.ok(lsfSrc.includes("'data-rt-visual-active'") && lsfSrc.includes('[data-rt-ui="visual-search"]'));
});

// The tile clip (uuidTwo456) and a fake fetch-video reply.
function clipSend(counter) {
  return async msg => {
    if (msg.action === 'fetch-video') { counter.fetches++; return { ok: true, base64: 'AAAA', mimeType: 'video/mp4' }; }
    if (msg.action === 'query') return { ok: true, items: SAMPLE_ITEMS, skippedCount: 0, page: 1, hasMore: false, nextPage: 0, endpointKind: msg.kind, filterable: true };
    return { ok: true, items: [] };
  };
}
function inView(W, D) {
  // jsdom has no layout: put every tile's media fully on screen, the video tile nearest the middle.
  W.innerHeight = 800;
  for (const media of D.querySelectorAll('.rt-vs-media')) media.getBoundingClientRect = () => ({ top: 250, bottom: 550, height: 300, left: 0, right: 300, width: 300 });
  W.URL.createObjectURL = () => 'blob:clip';
  W.HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
  W.HTMLMediaElement.prototype.pause = function () {};
  W.HTMLMediaElement.prototype.load = function () {};
  W.URL.revokeObjectURL = () => {};
}
const wait = ms => new Promise(r => setTimeout(r, ms));

test('loading shows Reddit’s own Media tab placeholder row', async t => {
  let release;
  const { D, controller } = setupUi(t, { sendImpl: msg => msg.action === 'query' ? new Promise(r => { release = () => r({ ok: true, items: SAMPLE_ITEMS, page: 1, hasMore: false }); }) : Promise.resolve({ ok: true, items: [] }) });
  await controller.ready;
  await flush();
  const row = D.querySelector('.rt-vs-skeleton[role="article"]');
  assert.ok(row);
  assert.equal(row.children.length, 3);
  assert.deepEqual([...row.children[0].children].map(c => c.className), [
    'shimmer-placeholder h-5xl w-100 mb-2xs bg-shimmer rounded-2',
    'shimmer-placeholder h-md w-100 mb-2xs bg-shimmer rounded-2',
    'shimmer-placeholder h-[40px] w-100 mb-2xs bg-shimmer rounded-2'
  ]);
  release();
  await flush();
  assert.equal(D.querySelector('.rt-vs-skeleton'), null);
});

test('clip previews follow the start choices: hover with a mouse, Play only starts nothing, one fetch per clip', async t => {
  const counter = { fetches: 0 };
  const { W, D, controller } = setupUi(t, { hover: true, sendImpl: clipSend(counter) });
  await controller.ready;
  await flush();
  inView(W, D);
  const wrap = D.querySelector('.rt-vs-tile[data-uuid="uuidTwo456"] .rt-vs-media-wrap');
  const media = wrap.querySelector('.rt-vs-media');
  assert.equal(media.dataset.kind, 'video');
  wrap.querySelector('img').dispatchEvent(new W.MouseEvent('mouseover', { bubbles: true }));
  await wait(260);
  await flush();
  assert.ok(media.querySelector('video.rt-vs-video'), 'hovering plays the clip');
  assert.equal(media.dataset.previewing, 'playing');
  // Moving onto the tile's own buttons keeps it playing.
  const btn = wrap.querySelector('.rt-vs-icon-btn');
  wrap.querySelector('img').dispatchEvent(new W.MouseEvent('mouseout', { bubbles: true, relatedTarget: btn }));
  assert.ok(media.querySelector('video'), 'buttons are part of the tile');
  wrap.querySelector('img').dispatchEvent(new W.MouseEvent('mouseout', { bubbles: true, relatedTarget: D.body }));
  assert.equal(media.querySelector('video'), null, 'leaving the tile stops it');
  wrap.querySelector('img').dispatchEvent(new W.MouseEvent('mouseover', { bubbles: true }));
  await wait(260);
  await flush();
  assert.equal(counter.fetches, 1, 'the clip is fetched once');

  controller.applySettings({ visualSearch: true, videoStart: 'play' });
  assert.equal(media.querySelector('video'), null, 'Only when I press Play stops automatic previews');
  wrap.querySelector('img').dispatchEvent(new W.MouseEvent('mouseover', { bubbles: true }));
  await wait(260);
  assert.equal(media.querySelector('video'), null);
});

test('on touch the clip you stop on plays muted after scrolling settles, and Autoplay picks one quickly', async t => {
  for (const [settings, waitMs] of [[{ visualSearch: true }, 700], [{ visualSearch: true, videoStart: 'preview' }, 700], [{ visualSearch: true, videoStart: 'autoplay' }, 220]]) {
    const counter = { fetches: 0 };
    const { W, D, controller } = setupUi(t, { phone: true, settings, sendImpl: clipSend(counter) });
    await controller.ready;
    await flush();
    inView(W, D);
    W.dispatchEvent(new W.Event('scroll'));
    await wait(waitMs);
    await flush();
    const video = D.querySelector('.rt-vs-tile[data-uuid="uuidTwo456"] video');
    assert.ok(video, JSON.stringify(settings));
    assert.equal(video.muted, true);
    assert.equal(D.querySelectorAll('.rt-vs-host video, [data-rt-ui="visual-search"] video').length, 1, 'one at a time');
  }
  const { W, D, controller } = setupUi(t, { phone: true, settings: { visualSearch: true, videoStart: 'play' }, sendImpl: clipSend({ fetches: 0 }) });
  await controller.ready;
  await flush();
  inView(W, D);
  W.dispatchEvent(new W.Event('scroll'));
  await wait(700);
  assert.equal(D.querySelector('[data-rt-ui="visual-search"] video'), null, 'Play only: nothing starts by itself');
});

test('touch ⋯ sheet offers the tile’s actions, and Play preview plays it in the grid', async t => {
  const counter = { fetches: 0 };
  const { W, D, controller } = setupUi(t, { phone: true, settings: { visualSearch: true, videoStart: 'play' }, sendImpl: clipSend(counter) });
  await controller.ready;
  await flush();
  inView(W, D);
  D.querySelector('.rt-vs-tile[data-uuid="uuidTwo456"] .rt-vs-more-btn').click();
  await flush();
  const labels = [...D.querySelectorAll('.rt-fsheet-label')].map(n => n.textContent);
  assert.deepEqual(labels, ['Play preview here', 'Find visually similar', 'View larger', 'Download', 'Open post']);
  [...D.querySelectorAll('.rt-fsheet-label')].find(n => n.textContent === 'Play preview here').closest('button,a,[role="button"],li,div[tabindex]').click();
  await flush();
  assert.ok(D.querySelector('.rt-vs-tile[data-uuid="uuidTwo456"] video'), 'plays in place');
  // An image tile has no preview row.
  D.querySelector('.rt-vs-tile[data-uuid="uuidOne123"] .rt-vs-more-btn').click();
  await flush();
  assert.equal([...D.querySelectorAll('.rt-fsheet-label')].some(n => /preview/i.test(n.textContent)), false);
});

test('community icons: the colour Reddit paints behind an icon, and its coloured glyph when there is none', async t => {
  const { W, D, controller } = setupUi(t);
  W.RTCommunityIcons.color = sub => (sub === 'pics' ? '#AF6401' : '');
  await controller.ready;
  await flush();
  const icon = D.querySelector('.rt-vs-tile[data-uuid="uuidTwo456"] .rt-vs-sub-icon');
  assert.ok(icon.classList.contains('shreddit-subreddit-icon__icon'));
  // The test double's color() is added after load; CommunityIcons is captured at load, so re-render to read it.
  controller.renderHost();
  await flush();
  const img = D.querySelector('.rt-vs-tile[data-uuid="uuidTwo456"] .rt-vs-sub-avatar');
  assert.equal(img.style.background.replace(/\s/g, ''), 'rgb(175,100,1)');
});

// Player frames: an extension page streams clips (Reddit's media-src blocks infini.wtf). jsdom cannot load it, so the
// tests speak for the frame with the messages it would post.
function withFrames(W) {
  W.chrome = { runtime: { getURL: path => 'chrome-extension://abc/' + path } };
}
function frameSays(W, frame, data) {
  const id = new URLSearchParams(frame.src.split('#')[1]).get('id');
  W.dispatchEvent(new W.MessageEvent('message', { data: { rt: 'visual-player', id, paused: false, muted: true, ...data }, origin: 'chrome-extension://abc', source: frame.contentWindow }));
}

test('tile clips stream through the player frame, and the viewer continues from the same moment', async t => {
  const counter = { fetches: 0 };
  const { W, D, controller } = setupUi(t, { hover: true, settings: { visualSearch: true, visualClick: 'viewer' }, sendImpl: clipSend(counter) });
  withFrames(W);
  await controller.ready;
  await flush();
  inView(W, D);
  const tile = D.querySelector('.rt-vs-tile[data-uuid="uuidTwo456"]');
  const media = tile.querySelector('.rt-vs-media');
  tile.querySelector('img').dispatchEvent(new W.MouseEvent('mouseover', { bubbles: true }));
  await wait(260);
  const frame = media.querySelector('iframe.rt-vs-frame');
  assert.ok(frame, 'a player frame, not a download');
  const hash = new URLSearchParams(frame.src.split('#')[1]);
  assert.equal(hash.get('src'), 'https://video.infini.wtf/uuidTwo456/original.mp4');
  assert.equal(hash.get('mode'), 'preview');
  assert.equal(frame.getAttribute('allow'), 'autoplay; fullscreen');
  assert.equal(counter.fetches, 0, 'nothing downloaded');
  // A message from anywhere else is ignored.
  W.dispatchEvent(new W.MessageEvent('message', { data: { rt: 'visual-player', id: hash.get('id'), type: 'playing', time: 50 }, origin: 'https://evil.example', source: frame.contentWindow }));
  assert.equal(media.dataset.previewing, 'loading');
  frameSays(W, frame, { type: 'hello' });
  frameSays(W, frame, { type: 'playing', time: 3.4 });
  assert.equal(media.dataset.previewing, 'playing');

  // Visual click choice: Open in viewer.
  tile.querySelector('.rt-vs-media img').click();
  await flush();
  const viewer = D.querySelector('dialog.rt-vs-viewer');
  assert.ok(viewer, 'viewer open');
  assert.equal(media.querySelector('iframe'), null, 'the tile preview handed over');
  const vframe = viewer.querySelector('iframe.rt-vs-viewer-frame');
  const vhash = new URLSearchParams(vframe.src.split('#')[1]);
  assert.equal(vhash.get('mode'), 'viewer');
  assert.equal(vhash.get('t'), '3.40', 'continues from the tile’s moment');
  assert.equal(vhash.get('sound'), null, 'Keep muted by default (clickAudio)');
  assert.equal(viewer.querySelector('.rt-vs-viewer-title').textContent, SAMPLE_ITEMS[1].title);
  assert.equal(viewer.querySelector('.rt-vs-viewer-count').textContent, '2 / 2');

  // ← moves to the previous result; → back again.
  D.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  assert.equal(viewer.querySelector('.rt-vs-viewer-title').textContent, SAMPLE_ITEMS[0].title);
  assert.equal(viewer.querySelector('iframe'), null, 'an image has no player');
  D.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const vframe2 = viewer.querySelector('iframe.rt-vs-viewer-frame');
  frameSays(W, vframe2, { type: 'hello' });
  frameSays(W, vframe2, { type: 'time', time: 8.5, muted: false });

  // Open post: the viewer closes, the moment is handed to the post, and Reddit's router opens it.
  let handed = null, navigated = '';
  D.addEventListener('rt-visual-continue', e => { handed = e.detail; });
  D.addEventListener('click', e => { const a = e.target.closest?.('a[data-rt-ui="visual-nav-link"]'); if (a) { e.preventDefault(); navigated = a.href; } });
  viewer.querySelector('.rt-vs-viewer-open').click();
  assert.equal(D.querySelector('dialog.rt-vs-viewer'), null, 'the viewer goes away');
  assert.deepEqual({ ...handed }, { id: SAMPLE_ITEMS[1].postId, time: 8.5, source: 'viewer', muted: false });
  assert.equal(navigated, SAMPLE_ITEMS[1].permalink);
});

test('click choice Play here plays clips in the grid; a frame that never answers falls back to a download', async t => {
  const counter = { fetches: 0 };
  const { W, D, controller } = setupUi(t, { settings: { visualSearch: true, visualClick: 'inline', videoStart: 'play' }, sendImpl: clipSend(counter) });
  withFrames(W);
  await controller.ready;
  await flush();
  inView(W, D);
  const tile = D.querySelector('.rt-vs-tile[data-uuid="uuidTwo456"]');
  tile.querySelector('.rt-vs-media img').click();
  await flush();
  const frame = tile.querySelector('iframe.rt-vs-frame');
  assert.ok(frame, 'plays in place');
  await wait(2600);
  await flush();
  assert.equal(tile.querySelector('iframe'), null);
  assert.ok(tile.querySelector('video.rt-vs-video'), 'downloaded instead');
  assert.equal(counter.fetches, 1);
  tile.querySelector('.rt-vs-media img').click();
  assert.equal(tile.querySelector('video'), null, 'a second click stops it');
});

test('the image-search button is the lens mark only, and phone Home gets it inside Reddit’s Search bar', async t => {
  const { D, controller } = setupUi(t);
  await controller.ready;
  await flush();
  const btn = D.querySelector('[data-rt-visual-control="upload"]');
  assert.equal(btn.textContent.trim(), '');
  assert.equal(btn.getAttribute('aria-label'), 'Search with an image');
  assert.ok(btn.querySelector('svg[data-rt-icon="lens"]'));

  const home = setupUi(t, {
    url: 'https://www.reddit.com/',
    html: '<!doctype html><html><body><prominent-search class="prominent-search relative"><div class="relative"><button class="prominent-search-button w-full" id="expand-search-button" type="button"><span>Search Reddit</span></button></div></prominent-search><main></main></body></html>',
    phone: true
  });
  await home.controller.ready;
  await flush();
  home.controller.syncHeaderTriggers();
  const trigger = home.D.querySelector('prominent-search .relative > [data-rt-ui="visual-search-trigger"]');
  assert.ok(trigger, 'beside the fake search button, not inside it');
  assert.equal(trigger.style.position, 'absolute');
  assert.equal(home.D.querySelectorAll('[data-rt-ui="visual-search-trigger"]').length, 1);
  home.controller.syncHeaderTriggers();
  assert.equal(home.D.querySelectorAll('[data-rt-ui="visual-search-trigger"]').length, 1, 'added once');
});

test('a slow infini.wtf answer is retried once quietly, then explained with Try again', async t => {
  let calls = 0;
  const ok = { ok: true, items: SAMPLE_ITEMS, page: 1, hasMore: false };
  const one = setupUi(t, { sendImpl: async msg => { if (msg.action !== 'query') return { ok: true, items: [] }; calls++; return calls === 1 ? { ok: false, code: 'timeout', error: 'infini.wtf took too long to answer.' } : ok; } });
  await one.controller.ready;
  await wait(1700);
  await flush();
  assert.equal(calls, 2);
  assert.equal(one.D.querySelectorAll('.rt-vs-tile').length, 2, 'the retry filled the grid');

  const two = setupUi(t, { sendImpl: async msg => msg.action === 'query' ? { ok: false, code: 'timeout', error: 'infini.wtf took too long to answer.' } : { ok: true, items: [] } });
  await two.controller.ready;
  await wait(1700);
  await flush();
  const card = two.D.querySelector('[data-rt-ui="visual-search"] .rt-community-state');
  assert.match(card.textContent, /infini\.wtf is taking too long/);
  assert.ok([...card.querySelectorAll('button')].some(b => b.textContent === 'Try again'));
});
