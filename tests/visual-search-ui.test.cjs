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
    downloadUrl: 'https://infini.wtf/download/uuidTwo456?is_animated=false',
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
    matches: query.includes('max-width: 767.98px') ? phone : false,
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
    form.append(field);
    sr.append(form);
  }

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
        return { ok: true, items: SAMPLE_ITEMS, skippedCount: 0, endpointKind: msg.kind, filterable: msg.kind !== 'view', capped: true };
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
  assert.equal(visualTab.style.backgroundColor, 'var(--color-secondary-background-selected)');
  assert.equal(visualWrap.getAttribute('aria-selected'), 'true');
  assert.equal(mediaWrap.getAttribute('aria-selected'), 'false');
  assert.equal(mediaTab.style.backgroundColor, 'transparent');

  // Click native Media tab back -> reveals native Media in 0ms without departure hold and restores native selection
  mediaTab.click();
  await flush();
  assert.equal(D.querySelector('[data-rt-ui="visual-search"]'), null);
  assert.equal(controller.outgoing, null);
  assert.equal(D.getElementById('native-results').hidden, false);
  assert.equal(mediaTab.getAttribute('aria-current'), 'page');
  assert.equal(mediaTab.hasAttribute('faceplate-tab-selected'), true);
  assert.equal(mediaTab.style.backgroundColor, 'var(--color-secondary-background-selected)');
  assert.equal(mediaWrap.getAttribute('aria-selected'), 'true');
  assert.equal(visualWrap.getAttribute('aria-selected'), 'false');

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
