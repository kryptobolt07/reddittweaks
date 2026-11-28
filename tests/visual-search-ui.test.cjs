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
  runtime,
  observe = false,
  boot = false
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

  if (boot) {
    W.sessionStorage.setItem('rt-visual-enabled-v1', '1');
    W.eval(read('visual-search-boot.js'));
  }

  W.RTCommunityIcons = {
    peek(sub) { return sub.toLowerCase() === 'pixelart' ? 'https://styles.redditmedia.com/t5_pixel/styles/communityIcon_a.png' : undefined; },
    async get(sub) { return sub.toLowerCase() === 'pics' ? 'https://styles.redditmedia.com/t5_pics/styles/communityIcon_b.png' : null; }
  };

  for (const file of ['post-model.js', 'download-model.js', 'post-menu-dom.js', 'feed-sheet.js', 'video-overlay.js', 'visual-search-model.js']) {
    W.eval(read(file));
  }
  W.__rtVisualSearchTest = true;
  if (runtime) W.browser = { runtime };
  W.eval(read('visual-search.js'));

  const controller = new W.RTVisualSearch.VisualSearchController({
    observe,
    readSettings: async () => (typeof settings === 'function' ? settings() : settings),
    send: runtime ? undefined : async msg => {
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

test('Firefox Promise-only runtime receives a single message argument for post lookup', async t => {
  const messages = [];
  const { D, controller } = setupUi(t, {
    url: 'https://www.reddit.com/search/?type=media&rt_visual=1&rt_vpost=pics/abc123',
    runtime: {
      async sendMessage(...args) {
        if (args.length !== 1) throw new TypeError('Expected a message and optional options object');
        const [message] = args;
        messages.push(message);
        if (message.action === 'resolve-post') return { ok: true, indexed: true, viewId: SAMPLE_ITEMS[0].viewId };
        if (message.action === 'query') return { ok: true, items: SAMPLE_ITEMS };
        return { ok: true, items: [] };
      }
    }
  });
  await controller.ready;
  await flush();
  assert.equal(messages[0].scope, 'rt-visual-search');
  assert.equal(messages[0].action, 'resolve-post');
  assert.ok(messages.some(message => message.action === 'query' && message.target === SAMPLE_ITEMS[0].viewId));
  assert.match(D.querySelector('[data-rt-ui="visual-search"]').textContent, /Gelato Cone/);
});

test('canvas upload serializes the prepared Firefox Blob through FileReader', async t => {
  const { W, controller, sent } = setupUi(t, {
    sendImpl: async msg => msg.action === 'upload-image' ? { ok: false, error: 'stop here' } : { ok: true, items: [] }
  });
  await controller.ready;
  await flush();

  const file = new W.Blob(['input'], { type: 'image/png' });
  const prepared = new W.Blob(['encoded'], { type: 'image/webp' });
  prepared.arrayBuffer = () => { throw Error('Permission denied to access property "constructor"'); };
  W.URL.createObjectURL = () => 'blob:fixture';
  W.URL.revokeObjectURL = () => {};
  W.Image = class {
    naturalWidth = 1600;
    naturalHeight = 800;
    set src(url) { this.onload(); }
  };
  W.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  W.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,AA==';
  W.HTMLCanvasElement.prototype.toBlob = function (resolve, type) {
    assert.equal(this.width, 1280);
    assert.equal(this.height, 640);
    assert.equal(type, 'image/webp');
    resolve(prepared);
  };

  await controller.uploadAndSearch(file);
  const upload = sent.find(msg => msg.action === 'upload-image');
  assert.equal(upload?.mimeType, 'image/webp');
  assert.equal(upload?.dataBase64, 'ZW5jb2RlZA==');
});

test('visual-search modules contain zero unsafe HTML DOM injection sinks', () => {
  for (const file of ['visual-search-boot.js', 'visual-search-model.js', 'visual-search-broker.js', 'visual-search.js', 'video-overlay.js']) {
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
function hoverClip(W, target, type = 'pointerover', relatedTarget = null) {
  const event = new W.MouseEvent(type, { bubbles: true, relatedTarget });
  Object.defineProperty(event, 'pointerType', { value: 'mouse' });
  target.dispatchEvent(event);
}

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
  hoverClip(W, wrap.querySelector('img'));
  await wait(260);
  await flush();
  assert.ok(media.querySelector('video.rt-vs-video'), 'hovering plays the clip');
  assert.equal(media.dataset.previewing, 'playing');
  // Moving onto the tile's own buttons keeps it playing.
  const btn = wrap.querySelector('.rt-vs-icon-btn');
  hoverClip(W, wrap.querySelector('img'), 'pointerout', btn);
  assert.ok(media.querySelector('video'), 'buttons are part of the tile');
  hoverClip(W, wrap.querySelector('img'), 'pointerout', D.body);
  assert.equal(media.querySelector('video'), null, 'leaving the tile stops it');
  hoverClip(W, wrap.querySelector('img'));
  await wait(260);
  await flush();
  assert.equal(counter.fetches, 1, 'the clip is fetched once');

  controller.applySettings({ visualSearch: true, videoStart: 'play' });
  assert.equal(media.querySelector('video'), null, 'Only when I press Play stops automatic previews');
  hoverClip(W, wrap.querySelector('img'));
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

test('a blocked Visual clip retries in the same player during the next page gesture', async t => {
  for (const streaming of [true, false]) {
    const counter = { fetches: 0 };
    const { W, D, controller } = setupUi(t, { phone: true, sendImpl: clipSend(counter) });
    if (streaming) withFrames(W);
    await controller.ready;
    await flush();
    inView(W, D);
    const media = D.querySelector('.rt-vs-media[data-video-url]');
    let duringGesture = false, attempts = 0;
    W.HTMLMediaElement.prototype.play = function () {
      assert.equal(this.muted, true);
      attempts++;
      return duringGesture ? Promise.resolve() : Promise.reject(new W.DOMException('Autoplay blocked', 'NotAllowedError'));
    };
    controller.startPreview(media);
    await flush();
    const player = media.querySelector(streaming ? 'iframe' : 'video');
    assert.ok(player);
    if (streaming) {
      player.contentWindow.postMessage = data => {
        if (data.cmd === 'play') { assert.equal(duringGesture, true); attempts++; }
      };
      frameSays(W, player, { type: 'blocked', paused: true });
    }
    const before = attempts;
    const gesture = () => D.body.dispatchEvent(new W.Event('pointerup', { bubbles: true }));
    W.__rtVisualSearchTest = false;
    gesture();
    assert.equal(attempts, before, 'an untrusted event cannot retry');
    W.__rtVisualSearchTest = true;
    duringGesture = true;
    gesture();
    duringGesture = false;
    assert.equal(attempts, before + 1, 'retry dispatched during the page gesture');
    assert.equal(media.querySelector(streaming ? 'iframe' : 'video'), player);
    if (streaming) frameSays(W, player, { type: 'playing' });
    await flush();
    assert.equal(media.dataset.previewing, 'playing');
    assert.equal(counter.fetches, streaming ? 0 : 1);
    if (streaming) frameSays(W, player, { type: 'blocked', paused: true });
    controller.stopVideoPreview();
    gesture();
    assert.equal(attempts, before + 1, 'stopped previews have no retry listener');
  }
});

test('tile clips stream through the player frame, and the viewer continues from the same moment', async t => {
  const counter = { fetches: 0 };
  const { W, D, controller } = setupUi(t, { hover: true, settings: { visualSearch: true, visualClick: 'viewer' }, sendImpl: clipSend(counter) });
  withFrames(W);
  await controller.ready;
  await flush();
  inView(W, D);
  const tile = D.querySelector('.rt-vs-tile[data-uuid="uuidTwo456"]');
  const media = tile.querySelector('.rt-vs-media');
  hoverClip(W, tile.querySelector('img'));
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
  assert.equal(vhash.get('deferred'), '1', 'first playback waits for the parent’s visible overlay');
  assert.equal(vhash.get('t'), '3.40', 'continues from the tile’s moment');
  assert.equal(vhash.get('sound'), null, 'Keep muted by default (clickAudio)');
  assert.equal(viewer.querySelector('.rt-vs-viewer-title').textContent, SAMPLE_ITEMS[1].title);
  assert.equal(viewer.querySelector('.rt-vs-viewer-count').textContent, '2 / 2');
  const mark = viewer.querySelector('[data-rt-video-play]');
  assert.equal(mark.hidden, false);
  frameSays(W, vframe, { type: 'time', paused: false, time: 3.4 });
  assert.equal(mark.hidden, false, 'a seek or time update is not playback');
  frameSays(W, vframe, { type: 'blocked', paused: true });
  assert.equal(viewer.querySelector('.rt-vs-viewer-stage').dataset.frameInteraction, 'true');
  frameSays(W, vframe, { type: 'playing' });
  assert.equal(viewer.querySelector('.rt-vs-viewer-stage').dataset.playing, 'true');
  assert.equal(viewer.querySelector('.rt-vs-viewer-stage').dataset.frameInteraction, undefined);

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
  if (controller.hasHeaderLens()) assert.equal(btn, null, 'the lens in the search bar is the only image-search button');
  else {
    assert.equal(btn.textContent.trim(), '');
    assert.equal(btn.getAttribute('aria-label'), 'Search with an image');
    assert.ok(btn.querySelector('svg[data-rt-icon="lens"]'));
  }
  D.querySelectorAll('[data-rt-ui="visual-search-trigger"]').forEach(node => node.remove());
  for (const host of D.querySelectorAll('reddit-search-large, reddit-search-small')) host.shadowRoot?.querySelectorAll('[data-rt-ui="visual-search-trigger"]').forEach(node => node.remove());
  controller.renderHost();
  const fallback = D.querySelector('[data-rt-visual-control="upload"]');
  assert.ok(fallback?.querySelector('svg[data-rt-icon="lens"]'), 'without the search bar lens the row keeps one');
  assert.equal(fallback.getAttribute('aria-label'), 'Search with an image');

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

test('lens on Reddit media (separate toggle): searches with the picture, uploading it when infini.wtf has not indexed the post', async t => {
  const feed = (blurred = '') => `<!doctype html><html><body><main>
    <shreddit-post id="t3_abc123" post-type="video" permalink="/r/pics/comments/abc123/clip/" post-title="A clip"><div slot="post-media-container"><div style="position:relative"><shreddit-player poster="https://preview.redd.it/clip-thumb.jpg?width=640&s=x"></shreddit-player></div></div></shreddit-post>
    <shreddit-post id="t3_def456" post-type="image" permalink="/r/pics/comments/def456/pic/" post-title="A pic">${blurred}<div slot="post-media-container"><div style="position:relative"><img src="https://i.redd.it/pic.jpg"></div></div></shreddit-post>
    <shreddit-post id="t3_ghi789" post-type="text" permalink="/r/pics/comments/ghi789/text/"><div slot="post-media-container"><div style="position:relative"></div></div></shreddit-post>
  </main></body></html>`;
  const off = setupUi(t, { url: 'https://www.reddit.com/r/pics/', html: feed(), settings: { visualSearch: true } });
  await off.controller.ready;
  off.controller.sync();
  assert.equal(off.D.querySelectorAll('[data-rt-ui="visual-media-lens"]').length, 0, 'off unless its own toggle is on');

  const on = setupUi(t, { url: 'https://www.reddit.com/r/pics/', html: feed('<shreddit-blurred-container blurred></shreddit-blurred-container>'), settings: { visualSearch: true, visualSearchMediaButton: true } });
  await on.controller.ready;
  on.controller.sync();
  const lenses = [...on.D.querySelectorAll('[data-rt-ui="visual-media-lens"]')];
  assert.equal(lenses.length, 1, 'video gets one; blurred image and text post get none');
  assert.equal(lenses[0].closest('shreddit-post').id, 't3_abc123');
  assert.equal(lenses[0].parentElement.parentElement.getAttribute('slot'), 'post-media-container');
  on.controller.sync();
  assert.equal(on.D.querySelectorAll('[data-rt-ui="visual-media-lens"]').length, 1, 'added once');

  let navigated = '';
  on.D.addEventListener('click', e => { const a = e.target.closest?.('a[data-rt-ui="visual-nav-link"]'); if (a) { e.preventDefault(); navigated = a.href; } });
  let cardClicks = 0;
  on.D.querySelector('#t3_abc123').addEventListener('click', () => cardClicks++);
  lenses[0].click();
  assert.equal(cardClicks, 0, 'the card does not open the post');
  assert.equal(new URL(navigated).searchParams.get('rt_vpost'), 'pics/abc123');
  const seed = JSON.parse(on.W.sessionStorage.getItem('rt-visual-seed:pics/abc123'));
  assert.equal(seed.autoUpload, true);
  assert.equal(seed.fallbackImageUrl, 'https://preview.redd.it/clip-thumb.jpg?width=640&s=x', 'a video searches with its thumbnail');

  // On the Visual tab: not indexed → the thumbnail is uploaded as an image search instead of asking.
  const uploads = [], stills = [];
  const vis = setupUi(t, {
    url: 'https://www.reddit.com/search/?type=media&rt_visual=1&rt_vpost=pics/abc123',
    sendImpl: async msg => {
      if (msg.action === 'resolve-post') return { ok: true, indexed: false };
      if (msg.action === 'fetch-still') {
        stills.push(msg.url);
        return { ok: true, base64: 'eA==', mimeType: 'image/jpeg' };
      }
      if (msg.action === 'upload-image') { uploads.push(msg); return { ok: false, error: 'stop here' }; }
      return { ok: true, items: [] };
    }
  });
  vis.W.sessionStorage.setItem('rt-visual-seed:pics/abc123', JSON.stringify(seed));
  vis.W.fetch = async () => { throw new TypeError('Cross-origin read blocked'); };
  vis.W.URL.revokeObjectURL = () => {};
  vis.controller.prepareImage = async blob => {
    assert.equal(blob.type, 'image/jpeg');
    assert.equal(blob.size, 1);
    return { dataBase64: 'AAAA', mimeType: 'image/webp', previewUrl: 'blob:x' };
  };
  await vis.controller.ready;
  await flush();
  await flush();
  assert.equal(vis.D.querySelector('[data-rt-ui="visual-search"] .rt-community-state-title')?.textContent === 'This post is not in infini.wtf’s index yet', false, 'no extra step');
  assert.deepEqual(stills, ['https://preview.redd.it/clip-thumb.jpg?width=640&s=x']);
  assert.equal(uploads.length, 1, 'the picture was searched');
  assert.deepEqual({ ...uploads[0] }, { action: 'upload-image', dataBase64: 'AAAA', mimeType: 'image/webp' });

  on.controller.applySettings({ visualSearch: true, visualSearchMediaButton: false });
  assert.equal(on.D.querySelectorAll('[data-rt-ui="visual-media-lens"]').length, 0, 'turning it off removes them');
});

test('the header lens is drawn at document start, before visual-search.js has its settings', async t => {
  let release;
  const gate = new Promise(r => { release = r; });
  const { W, D, controller, searchHeader } = setupUi(t, { boot: true, settings: () => gate });
  await wait(40);
  const field = searchHeader.shadowRoot.querySelector('faceplate-search-input');
  const lens = field.querySelector(':scope > [data-rt-ui="visual-search-trigger"]');
  assert.ok(lens, 'drawn with the bar, from the session flag');
  assert.ok(lens.querySelector('svg[data-rt-icon="lens"]'));
  assert.equal(controller.enabled, false, 'the controller has not started yet');
  lens.click();
  assert.equal(D.querySelector('[data-rt-ui="visual-upload-popover"]'), null);
  release({ visualSearch: true });
  await controller.ready;
  await flush();
  assert.equal(field.querySelectorAll('[data-rt-ui="visual-search-trigger"]').length, 1, 'the controller reuses it');
  assert.ok(D.querySelector('[data-rt-ui="visual-upload-popover"]'), 'the early click is answered once ready');
  controller.applySettings({ visualSearch: false });
  assert.equal(field.querySelector('[data-rt-ui="visual-search-trigger"]'), null, 'off removes it');
  assert.equal(W.sessionStorage.getItem('rt-visual-enabled-v1'), '0');
});

test('profile search keeps its own tabs: no Visual tab, and an image search started there goes to the global tab', async t => {
  const html = searchHtml().replace(/\/search\/\?q=ice\+cream/g, '/user/example_user/search/?q=ice+cream');
  const { D, controller } = setupUi(t, { url: 'https://www.reddit.com/user/example_user/search/?q=ice+cream&type=posts', html });
  await controller.ready;
  controller.sync();
  assert.equal(D.querySelector('[data-rt-ui="visual-search-tab"]'), null);
  assert.equal(D.querySelector('#search-results-page-tabgroup').shadowRoot.querySelector('[data-rt-ui="visual-search-slot"]'), null);
});

test('viewer on phones: swipes reported by the clip frame move between results, and a bottom bar has Previous and Next', async t => {
  const counter = { fetches: 0 };
  const { W, D, controller } = setupUi(t, { phone: true, settings: { visualSearch: true, visualClick: 'viewer' }, sendImpl: clipSend(counter) });
  withFrames(W);
  await controller.ready;
  await flush();
  inView(W, D);
  controller.openLightbox(SAMPLE_ITEMS[1]);
  const viewer = D.querySelector('dialog.rt-vs-viewer');
  const bar = viewer.querySelector('.rt-vs-viewer-bar');
  assert.equal(bar.hidden, false);
  assert.equal(bar.querySelector('.rt-vs-viewer-bar-count').textContent, '2 / 2');
  assert.equal(bar.querySelector('.rt-vs-viewer-bar-next').disabled, true, 'last result');
  const frame = viewer.querySelector('iframe.rt-vs-viewer-frame');
  frameSays(W, frame, { type: 'hello' });
  frameSays(W, frame, { type: 'swipe', direction: 'previous' });
  assert.equal(viewer.querySelector('.rt-vs-viewer-title').textContent, SAMPLE_ITEMS[0].title, 'a swipe over the clip moved back');
  bar.querySelector('.rt-vs-viewer-bar-next').click();
  assert.equal(viewer.querySelector('.rt-vs-viewer-title').textContent, SAMPLE_ITEMS[1].title);
  const frame2 = viewer.querySelector('iframe.rt-vs-viewer-frame');
  frameSays(W, frame2, { type: 'hello' });
  frameSays(W, frame2, { type: 'swipe', direction: 'down' });
  assert.equal(D.querySelector('dialog.rt-vs-viewer'), null, 'swipe down closes');
  assert.match(read('visual-player.js'), /post\('swipe', \{ direction: dx < 0 \? 'next' : 'previous' \}\)/);
});

test('touch: pressing and holding a clip previews it while held; lifting stops it and is not a tap', async t => {
  const counter = { fetches: 0 };
  const { W, D, controller } = setupUi(t, { phone: true, settings: { visualSearch: true, videoStart: 'play' }, sendImpl: clipSend(counter) });
  withFrames(W);
  await controller.ready;
  await flush();
  inView(W, D);
  const tile = D.querySelector('.rt-vs-tile[data-uuid="uuidTwo456"]');
  const img = tile.querySelector('.rt-vs-media img');
  const pointer = (type, target, x = 10) => target.dispatchEvent(new W.MouseEvent(type, { bubbles: true, composed: true, clientX: x, clientY: 10 }));
  const down = target => { const e = new W.MouseEvent('pointerdown', { bubbles: true, composed: true, clientX: 10, clientY: 10 }); Object.defineProperty(e, 'pointerType', { value: 'touch' }); target.dispatchEvent(e); };
  // A moving finger is a scroll.
  down(img);
  pointer('pointermove', D, 40);
  await wait(350);
  assert.equal(tile.querySelector('iframe'), null, 'a scroll starts nothing');
  W.dispatchEvent(new W.MouseEvent('pointerup', { bubbles: true }));
  // Holding still plays it.
  down(img);
  await wait(350);
  assert.ok(tile.querySelector('iframe.rt-vs-frame'), 'held clip plays (even with Play only)');
  W.dispatchEvent(new W.MouseEvent('pointerup', { bubbles: true }));
  assert.equal(tile.querySelector('iframe'), null, 'lifting stops it');
  let opened = false;
  D.addEventListener('click', e => { if (e.target.closest?.('a')) { opened = !e.defaultPrevented; e.preventDefault(); } });
  img.click();
  assert.equal(opened, false, 'the click after a hold does not open the post');
});

test('Back after the post lens: the image search replaces the post entry instead of adding one', async t => {
  const { W, controller } = setupUi(t, { url: 'https://www.reddit.com/search/?type=media&rt_visual=1&rt_vpost=pics/abc123' });
  await controller.ready;
  const before = W.history.length;
  controller.commitUploadUuid('12345678-1234-4234-8234-123456789abc', {});
  assert.equal(W.history.length, before, 'replaced, not pushed');
  assert.match(W.location.search, /rt_vupload=12345678-1234-4234-8234-123456789abc/);
  assert.doesNotMatch(W.location.search, /rt_vpost/);
});

test('lens on embedded media searches with the embed’s still, Reddit’s own copy first', async t => {
  const html = `<!doctype html><html><body><main>
    <shreddit-post id="t3_emb111" post-type="link" permalink="/r/videos/comments/emb111/a_video/" post-title="A video"><img slot="thumbnail" src="https://external-preview.redd.it/still.jpg?width=640&s=y"><div slot="post-media-container"><div style="position:relative"><shreddit-embed providername="YouTube" thumbnail-url="https://i.ytimg.com/vi/x/hqdefault.jpg"></shreddit-embed></div></div></shreddit-post>
    <shreddit-post id="t3_emb222" post-type="link" permalink="/r/videos/comments/emb222/other/" post-title="Other"><div slot="post-media-container"><div style="position:relative"><shreddit-embed providername="Vimeo" thumbnail-url="https://i.vimeocdn.com/video/1.jpg"></shreddit-embed></div></div></shreddit-post>
  </main></body></html>`;
  const { D, W, controller } = setupUi(t, { url: 'https://www.reddit.com/r/videos/', html, settings: { visualSearch: true, visualSearchMediaButton: true } });
  await controller.ready;
  controller.sync();
  const lenses = [...D.querySelectorAll('[data-rt-ui="visual-media-lens"]')];
  assert.equal(lenses.length, 2);
  D.addEventListener('click', e => { if (e.target.closest?.('a[data-rt-ui="visual-nav-link"]')) e.preventDefault(); });
  lenses[0].click();
  assert.equal(JSON.parse(W.sessionStorage.getItem('rt-visual-seed:videos/emb111')).fallbackImageUrl, 'https://external-preview.redd.it/still.jpg?width=640&s=y');
  lenses[1].click();
  assert.equal(JSON.parse(W.sessionStorage.getItem('rt-visual-seed:videos/emb222')).fallbackImageUrl, 'https://i.vimeocdn.com/video/1.jpg');
});

test('lens on a YouTube embed that hasn’t drawn its player yet: the still comes from the embed’s address', async t => {
  const iframe = '<iframe width="356" height="200" src="https://www.youtube.com/embed/4_RV_5-nZFg?feature=oembed" frameborder="0"></iframe>';
  const html = `<!doctype html><html><body><main>
    <shreddit-post id="t3_yt1111" post-type="link" permalink="/r/videos/comments/yt1111/clip/" post-title="Clip"><div slot="post-media-container"><div style="position:relative"><shreddit-async-loader><shreddit-embed providername="YouTube"></shreddit-embed></shreddit-async-loader></div></div></shreddit-post>
  </main></body></html>`;
  const { D, W, controller } = setupUi(t, { url: 'https://www.reddit.com/r/videos/', html, settings: { visualSearch: true, visualSearchMediaButton: true } });
  D.querySelector('shreddit-embed').setAttribute('html', iframe);
  await controller.ready;
  controller.sync();
  const lens = D.querySelector('[data-rt-ui="visual-media-lens"]');
  assert.ok(lens, 'placed without a drawn player');
  D.addEventListener('click', e => { if (e.target.closest?.('a[data-rt-ui="visual-nav-link"]')) e.preventDefault(); });
  lens.click();
  assert.equal(JSON.parse(W.sessionStorage.getItem('rt-visual-seed:videos/yt1111')).fallbackImageUrl, 'https://i.ytimg.com/vi/4_RV_5-nZFg/hqdefault.jpg');
});

test('Reddit’s Media tab viewer starts on Play, retains the poster before playback and retries another MP4', async t => {
  const pm = JSON.stringify({ playbackMp4s: { permutations: [
    { source: { url: 'https://packaged-media.redd.it/a/pb/m2-res_360p.mp4?s=1', dimensions: { height: 360 } } },
    { source: { url: 'https://packaged-media.redd.it/a/pb/m2-res_720p.mp4?s=2', dimensions: { height: 720 } } },
    { source: { url: 'https://packaged-media.redd.it/a/pb/m2-res_1080p.mp4?s=3', dimensions: { height: 1080 } } },
    { source: { url: 'https://evil.example/x.mp4', dimensions: { height: 480 } } }] } }).replace(/"/g, '&quot;');
  const tile = (id, inner) => `<div data-id="search-media-post-unit"><search-telemetry-tracker data-faceplate-tracking-context="${JSON.stringify({ post: { id: 't3_' + id, title: 'Title ' + id } }).replace(/"/g, '&quot;')}"><a href="/r/pics/comments/${id}/t/"><div class="rounded-2">${inner}</div></a></search-telemetry-tracker></div>`;
  const html = `<!doctype html><html><body><reddit-search-large></reddit-search-large><main><search-media-feed>
    ${tile('vid111', `<shreddit-player player-type="search_results" poster="https://external-preview.redd.it/p.png?s=1" packaged-media-json="${pm}"></shreddit-player>`)}
    ${tile('img222', '<img data-post-media-primary src="https://preview.redd.it/i.jpg?s=2" alt="An image">')}
  </search-media-feed></main></body></html>`;
  const { W, D, controller } = setupUi(t, { url: 'https://www.reddit.com/search/?q=dog&type=media', html, settings: { visualSearch: true, videoStart: 'play' } });
  inView(W, D);
  const plays = [];
  W.HTMLMediaElement.prototype.play = function () { plays.push(this.src); return Promise.resolve(); };
  await controller.ready;
  W.HTMLElement.prototype.scrollIntoView = function () {};
  controller.sync();
  const buttons = D.querySelectorAll('[data-rt-ui="native-media-expand"]');
  assert.equal(buttons.length, 2);
  assert.equal(buttons[0].parentElement.dataset.id, 'search-media-post-unit', 'beside Reddit’s link, not inside it');
  controller.sync();
  assert.equal(D.querySelectorAll('[data-rt-ui="native-media-expand"]').length, 2, 'added once');
  let cardClicks = 0;
  D.querySelector('search-media-feed').addEventListener('click', () => cardClicks++);
  buttons[0].click();
  assert.equal(cardClicks, 0);
  const viewer = D.querySelector('dialog.rt-vs-viewer');
  const video = viewer.querySelector('video.rt-vs-viewer-video');
  const stage = video.parentElement;
  const play = stage.querySelector('[aria-label="Play video"]');
  assert.equal(video.getAttribute('src'), 'https://packaged-media.redd.it/a/pb/m2-res_720p.mp4?s=2', 'the tallest MP4 up to 720p');
  assert.deepEqual(plays, []);
  assert.equal(play.hidden, false);
  assert.equal(stage.dataset.playing, undefined);
  play.click();
  assert.deepEqual(plays, [video.src]);
  video.dispatchEvent(new W.Event('error'));
  assert.match(plays[1], /m2-res_360p\.mp4/);
  video.dispatchEvent(new W.Event('playing'));
  assert.equal(play.hidden, true);
  assert.equal(stage.dataset.playing, 'true');
  assert.equal(viewer.querySelector('.rt-vs-viewer-title').textContent, 'Title vid111');
  assert.equal(viewer.querySelector('.rt-vs-viewer-count').textContent, '1 / 2');
  assert.equal(viewer.querySelector('button[aria-label="Download"]').hidden, true);
  D.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  assert.equal(viewer.querySelector('video'), null);
  assert.equal(viewer.querySelector('[data-rt-video-play]'), null);
  assert.equal(stage.dataset.playing, undefined);
  assert.equal(viewer.querySelector('.rt-vs-viewer-img').getAttribute('src'), 'https://preview.redd.it/i.jpg?s=2');
  // Open post hands the clip's moment to the post.
  D.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  let handed = null, navigated = '';
  D.addEventListener('rt-visual-continue', e => { handed = e.detail; });
  D.addEventListener('click', e => { const a = e.target.closest?.('a[data-rt-ui="visual-nav-link"]'); if (a) { e.preventDefault(); navigated = a.getAttribute('href'); } });
  viewer.querySelector('.rt-vs-viewer-open').click();
  assert.equal(handed.id, 'vid111');
  assert.match(navigated, /\/r\/pics\/comments\/vid111\/t\/$/);
});

test('Reddit’s Media viewer keeps its result order through feed replacements and ignores duplicate posts', async t => {
  const tile = id => `<div data-id="search-media-post-unit"><a href="/r/pics/comments/${id}/post/"><img data-post-media-primary src="https://i.redd.it/${id}.jpg"><faceplate-screen-reader-content>${id}</faceplate-screen-reader-content></a></div>`;
  const feed = ids => `<search-media-feed>${ids.map(tile).join('')}</search-media-feed>`;
  const { W, D, controller } = setupUi(t, {
    url: 'https://www.reddit.com/search/?q=dog&type=media',
    html: `<!doctype html><main>${feed(['one', 'two', 'three', 'four', 'five', 'six', 'seven'])}</main>`
  });
  await controller.ready;
  controller.sync();
  D.querySelector('.rt-vs-native-expand').click();
  const move = key => D.dispatchEvent(new W.KeyboardEvent('keydown', { key, bubbles: true }));
  const count = () => D.querySelector('.rt-vs-viewer-count').textContent;
  const title = () => D.querySelector('.rt-vs-viewer-title').textContent;
  for (let i = 0; i < 5; i++) move('ArrowRight');
  assert.equal(count(), '6 / 7');
  assert.equal(title(), 'six');
  D.querySelector('main').innerHTML = feed(['four', 'seven', 'eight', 'eight', 'nine']);
  controller.sync();
  assert.equal(count(), '6 / 9');
  for (const expected of ['seven', 'eight', 'nine']) {
    move('ArrowRight');
    assert.equal(title(), expected);
  }
  for (const expected of ['eight', 'seven', 'six', 'five']) {
    move('ArrowLeft');
    assert.equal(title(), expected);
  }
  assert.equal(count(), '5 / 9');
});

test('a Media result with only a poster can use the post player’s direct preview and shows the loading ring', async t => {
  const tile = (id, badge = '') => `<div data-id="search-media-post-unit"><a href="/r/pics/comments/${id}/post/"><div class="search-media-post-image"><img data-post-media-primary src="https://preview.redd.it/${id}.jpg">${badge}</div></a></div>`;
  const badge = '<button class="button-media"><svg icon-name="play-fill"></svg></button>';
  const { W, D, controller } = setupUi(t, {
    url: 'https://www.reddit.com/search/?q=&type=media',
    settings: { visualSearch: true, videoStart: 'play' }, hover: true,
    html: `<!doctype html><main><search-media-feed>${tile('video1', badge)}${tile('image1')}</search-media-feed></main>`
  });
  inView(W, D);
  const requests = [];
  const src = 'https://v.redd.it/fixture/CMAF_96.mp4';
  let resolvePost;
  W.fetch = path => {
    requests.push(path);
    return new Promise(resolve => { resolvePost = () => resolve({
      ok: true, text: async () => `<shreddit-post id="t3_video1"><shreddit-player post-id="t3_video1" src="https://cf.v.redd.it/fixture/HLSPlaylist.m3u8" preview="${src}"></shreddit-player></shreddit-post>`
    }); });
  };
  await controller.ready;
  const media = D.querySelector('[data-rt-native-video]');
  assert.ok(media?.querySelector('[data-rt-ui="native-media-play"]'));
  assert.equal(D.querySelectorAll('[data-rt-native-video]').length, 1, 'the ordinary image has no Play button');
  D.querySelector('.rt-vs-native-expand').click();
  const viewer = D.querySelector('.rt-vs-viewer-stage');
  const play = viewer.querySelector('[data-rt-video-play]');
  assert.equal(play.hidden, false);
  assert.equal(play.querySelector('[data-rt-video-loading]'), null);
  await flush();
  assert.deepEqual(requests, [], 'Play only keeps the source lookup idle');
  play.click();
  assert.ok(play.querySelector('[data-rt-video-loading]'), 'an actual playback request shows a ring around Play');
  resolvePost();
  await flush();
  const video = viewer.querySelector('video');
  assert.equal(video.src, src);
  video.dispatchEvent(new W.Event('playing'));
  assert.equal(play.hidden, true);
  assert.equal(play.querySelector('[data-rt-video-loading]'), null, 'playback clears the ring');
  controller.closeLightbox({ restoreFocus: false });
  controller.applySettings({ visualSearch: true, videoStart: 'preview' });
  hoverClip(W, media.querySelector('img'));
  await wait(250);
  await flush();
  assert.equal(media.querySelector('video').src, src);
  assert.equal(media.dataset.previewing, 'playing');
  assert.deepEqual(requests, ['/svc/shreddit/partial-feed-post/t3_video1']);
});

test('Media viewer requests Reddit’s continuation and can keep navigating after another page arrives', async t => {
  const tile = id => `<div data-id="search-media-post-unit"><a href="/r/pics/comments/${id}/post/"><img data-post-media-primary src="https://i.redd.it/${id}.jpg"></a></div>`;
  const partial = cursor => `<faceplate-loader loading="eager"></faceplate-loader><faceplate-partial loading="lazy" src="/svc/shreddit/search/?q=dog&amp;type=media&amp;cursor=${cursor}"></faceplate-partial>`;
  const { W, D, controller } = setupUi(t, {
    url: 'https://www.reddit.com/search/?q=dog&type=media',
    html: `<!doctype html><main><search-media-feed>${['one', 'two', 'three', 'four'].map(tile).join('')}</search-media-feed>${partial('one')}</main>`
  });
  await controller.ready;
  const requests = [];
  D.addEventListener('rt-load-media-page', event => {
    event.preventDefault();
    requests.push(new W.URL(event.target.getAttribute('src'), W.location.href).searchParams.get('cursor'));
  });
  W.HTMLElement.prototype.scrollIntoView = () => assert.fail('paging should not move the grid when its loader handles the request');
  D.querySelector('.rt-vs-native-expand').click();
  const move = () => D.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const count = () => D.querySelector('.rt-vs-viewer-count').textContent;
  assert.deepEqual(requests, []);
  for (let i = 0; i < 7; i++) move();
  assert.deepEqual(requests, ['one'], 'holding Next only requests the current continuation once');
  assert.equal(count(), '4 / 4');
  assert.equal(D.querySelector('.rt-vs-viewer-next').hidden, false);
  const grid = D.querySelector('search-media-feed');
  grid.insertAdjacentHTML('beforeend', ['five', 'six', 'seven', 'eight'].map(tile).join(''));
  D.querySelector('faceplate-partial').remove();
  D.querySelector('main').insertAdjacentHTML('beforeend', partial('two'));
  controller.sync();
  assert.equal(count(), '4 / 8');
  move();
  move();
  assert.equal(count(), '6 / 8');
  assert.deepEqual(requests, ['one', 'two']);
  controller.closeLightbox({ restoreFocus: false });
});

test('NSFW results by default: the Visual tab follows the reader’s choice, and a search can still switch it off', async t => {
  const { W, controller, sent } = setupUi(t, { settings: { visualSearch: true, visualNsfw: true } });
  await controller.ready;
  await flush();
  const Model = W.RTVisualSearchModel;
  assert.equal(Model.parseVisualUrl(W.location.href).filters.nsfw, true, 'no rt_vnsfw: the default applies');
  assert.equal(sent.find(m => m.action === 'query').filters.nsfw, true, 'the first search already includes NSFW');
  const off = Model.buildVisualUrl(W.location.href, { q: 'ice cream', filters: { nsfw: false } });
  assert.equal(off.searchParams.get('rt_vnsfw'), '0', 'switching it off is written down');
  assert.equal(Model.parseVisualUrl(off.href).filters.nsfw, false);
  assert.equal(Model.buildVisualUrl(W.location.href, { q: 'ice cream', filters: { nsfw: true } }).searchParams.has('rt_vnsfw'), false, 'the default needs no parameter');
  controller.applySettings({ visualSearch: true, visualNsfw: false });
  assert.equal(Model.parseVisualUrl('https://www.reddit.com/search/?q=a&type=media&rt_visual=1').filters.nsfw, false);
});

test('embedded media with no still on the page: the lens is there, and the Visual tab reads the still from the post’s data', async t => {
  const html = `<!doctype html><html><body><main>
    <shreddit-post id="t3_gif111" post-type="link" permalink="/r/clips/comments/gif111/clip/" post-title="Clip"><shreddit-post-overflow-menu></shreddit-post-overflow-menu><div slot="post-media-container"><div style="position:relative"><shreddit-embed providername="Clips" html="&lt;iframe src=&quot;https://clips.example/ifr/abc&quot;&gt;&lt;/iframe&gt;"></shreddit-embed></div></div></shreddit-post>
  </main></body></html>`;
  const feed = setupUi(t, { url: 'https://www.reddit.com/r/clips/', html, settings: { visualSearch: true, visualSearchMediaButton: true, visualSearchPostMenu: true } });
  await feed.controller.ready;
  feed.controller.sync();
  const lens = feed.D.querySelector('[data-rt-ui="visual-media-lens"]');
  assert.ok(lens, 'an embed gets the lens without a still');
  assert.ok(feed.D.querySelector('[data-rt-visual-menu="item"]'), 'and the ⋯ menu item');
  feed.D.addEventListener('click', e => { if (e.target.closest?.('a[data-rt-ui="visual-nav-link"]')) e.preventDefault(); });
  lens.click();
  const seed = JSON.parse(feed.W.sessionStorage.getItem('rt-visual-seed:clips/gif111'));
  assert.equal(seed.fallbackImageUrl, '');

  const uploads = [], fetched = [];
  const vis = setupUi(t, {
    url: 'https://www.reddit.com/search/?type=media&rt_visual=1&rt_vpost=clips/gif111',
    sendImpl: async msg => {
      if (msg.action === 'resolve-post') return { ok: true, indexed: false };
      if (msg.action === 'upload-image') { uploads.push(msg); return { ok: false, error: 'stop here' }; }
      return { ok: true, items: [] };
    }
  });
  vis.W.sessionStorage.setItem('rt-visual-seed:clips/gif111', JSON.stringify(seed));
  vis.W.fetch = async url => {
    fetched.push(String(url));
    if (/\/comments\/gif111\.json/.test(url)) return { ok: true, json: async () => [{ data: { children: [{ data: { preview: { images: [{ source: { url: 'https://external-preview.redd.it/still.jpg?s=1' }, resolutions: [] }] } } }] } }] };
    if (/external-preview/.test(url)) return { ok: true, blob: async () => new vis.W.Blob(['x'], { type: 'image/jpeg' }) };
    return { ok: false };
  };
  vis.controller.prepareImage = async () => ({ dataBase64: 'AAAA', mimeType: 'image/webp', previewUrl: 'blob:x' });
  vis.W.URL.revokeObjectURL = () => {};
  vis.W.URL.createObjectURL = () => 'blob:x';
  await vis.controller.ready;
  for (let i = 0; i < 4; i++) await flush();
  assert.ok(fetched.some(u => /\/comments\/gif111\.json/.test(u)), 'the post’s own data was read');
  assert.equal(JSON.parse(vis.W.sessionStorage.getItem('rt-visual-seed:clips/gif111')).fallbackImageUrl, 'https://external-preview.redd.it/still.jpg?s=1');
  assert.equal(uploads.length, 1, 'and its still searched');
});
