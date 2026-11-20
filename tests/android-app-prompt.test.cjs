const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const {test} = require('node:test');
const {JSDOM} = require('jsdom');

const source = () => readFileSync('extension/android-app-prompt.js', 'utf8');
const prompt = (title = 'Open in the Reddit app', browser = '<button>Continue in browser</button>') => `
  <dialog open aria-labelledby="app-prompt-title">
    <h2 id="app-prompt-title">${title}</h2>
    <button>Open in app</button>
    ${browser}
  </dialog>`;

function setup(t, markup = '', android = true, settings = {}, readSettings = Promise.resolve(settings), url = 'https://www.reddit.com/r/example/') {
  const {window} = new JSDOM(markup, {url, runScripts: 'outside-only'});
  if (android) Object.defineProperty(window.navigator, 'userAgentData', {value: {platform: android === true ? 'Android' : android}});
  const trace = [];
  const requests = [];
  let changed;
  window.chrome = {
    storage: {local: {get: async () => { throw new Error('Access to storage is not allowed from this context.'); }}},
    runtime: {
      id: 'extension',
      async sendMessage(request) { requests.push(request); return {ok:true, settings:await readSettings}; },
      onMessage: {addListener(listener) { changed = listener; }}
    }
  };
  const setSettings = (settings, id = 'extension') => changed?.({scope:'rt-posts', action:'settings-changed', settings}, {id});
  window.document.addEventListener('click', event => {
    trace.push(event.composedPath()[0].textContent.trim());
    event.preventDefault();
  });
  window.eval(source());
  t.after(() => window.close());
  return {window, document: window.document, requests, trace, setSettings, setOverlay: value => setSettings({hideMatureOverlay:value})};
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('Android chooses the native browser action once and keeps the current Reddit URL', async t => {
  const {window, document, trace} = setup(t, prompt());
  await settle();
  document.querySelector('dialog').append(document.createElement('span'));
  window.dispatchEvent(new window.Event('pageshow'));
  await settle();
  assert.deepEqual(trace, ['Continue in browser']);
  assert.equal(window.location.pathname, '/r/example/');
});

test('a late mobile app sheet can use the Chrome row with a plain Continue button', async t => {
  const {document, trace} = setup(t);
  const shell = document.createElement('div');
  const root = shell.attachShadow({mode: 'open'});
  root.innerHTML = prompt('See this post in the Reddit app', '<div><span>Chrome</span><button>Continue</button></div>');
  document.body.append(shell);
  shell.setAttribute('data-testid', 'xpromo-bottom-sheet');
  await settle();
  assert.deepEqual(trace, ['Continue']);
});

test('only a visible app prompt with an explicit browser choice is handled', async t => {
  const {document, trace} = setup(t, `
    ${prompt('This community is for mature audiences')}
    ${prompt('Open in the Reddit app', '<button>Continue</button>')}
    ${prompt('Open in the Reddit app', '<a href="https://app.example/">Continue in browser</a>')}
    ${prompt().replace('<dialog open', '<dialog aria-hidden="true"')}`);
  await settle();
  assert.deepEqual(trace, []);
  const pending = document.querySelector('dialog[aria-hidden]');
  pending.removeAttribute('aria-hidden');
  pending.setAttribute('open', '');
  await settle();
  assert.deepEqual(trace, ['Continue in browser']);
});

test('desktop and non-Android mobile browsers keep the native app prompt', async t => {
  const {trace} = setup(t, prompt(), false);
  await settle();
  assert.deepEqual(trace, []);
});

const appOnly = `<configured-xpromo-modal data-xpromo-view-san="xpromo|view|blocking_xpromo_nsfw_blocking">
  <rpl-dialog open blocking dialog-id="configured-xpromo-blocking_xpromo_nsfw_blocking">
    <template><rpl-modal-card><h3 slot="title">Mature Content</h3>
      <a slot="primary-button" href="https://app.example/">View In App</a><button slot="tertiary-button">Go Home</button>
    </rpl-modal-card></template>
  </rpl-dialog>
</configured-xpromo-modal>`;

test('the installed Android script removes Reddit’s app-only promotion while leaving the feed and other dialogs in place', async t => {
  const {window, document, requests, trace} = setup(t, `
    <main><article>Existing web content</article></main>${appOnly}
    <rpl-dialog open blocking dialog-id="confirm-account"><button>Sign in</button></rpl-dialog>`);
  await settle();
  assert.deepEqual(requests.map(({scope, action}) => [scope, action]), [['rt-posts', 'get-settings']]);
  assert.equal(document.querySelector('configured-xpromo-modal'), null);
  assert.equal(document.querySelector('main article').textContent, 'Existing web content');
  assert.ok(document.querySelector('[dialog-id="confirm-account"][open]'));
  assert.equal(window.location.pathname, '/r/example/');
  assert.deepEqual(trace, []);
});

test('the blocking app promotion is removed when Reddit adds it in a mobile emulation and stays on desktop', async t => {
  const mobile = setup(t, '<main></main>', 'iOS');
  const desktop = setup(t, appOnly, false);
  mobile.document.body.insertAdjacentHTML('beforeend', appOnly);
  await settle();
  assert.equal(mobile.document.querySelector('configured-xpromo-modal'), null);
  assert.ok(desktop.document.querySelector('configured-xpromo-modal'));
  assert.deepEqual(mobile.trace, []);
});

test('a normal link mutation cannot interrupt discovery of the blocking app promotion', async t => {
  const {document} = setup(t, '<main><a href="https://www.reddit.com/r/example/">Community</a></main>', 'iOS');
  await settle();
  document.querySelector('a').append(document.createElement('span'));
  document.body.insertAdjacentHTML('beforeend', appOnly);
  await settle();
  assert.equal(document.querySelector('configured-xpromo-modal'), null);
});

test('the mobile overlay follows its saved preference and changes to that preference', async t => {
  const {document, setOverlay, setSettings} = setup(t, appOnly, true, {hideMatureOverlay:false});
  await settle();
  assert.ok(document.querySelector('configured-xpromo-modal'));
  setSettings({hideMatureOverlay:true}, 'foreign');
  assert.ok(document.querySelector('configured-xpromo-modal'));
  setOverlay(true);
  await settle();
  assert.equal(document.querySelector('configured-xpromo-modal'), null);
  setOverlay(false);
  document.body.insertAdjacentHTML('beforeend', appOnly);
  await settle();
  assert.ok(document.querySelector('configured-xpromo-modal'));
});

test('the blocking promotion waits for settings and a newer toggle wins over the first read', async t => {
  let resolveSettings;
  const pending = new Promise(resolve => { resolveSettings = resolve; });
  const {document, setOverlay} = setup(t, appOnly, true, {}, pending);
  await settle();
  assert.ok(document.querySelector('configured-xpromo-modal'));
  setOverlay(false);
  resolveSettings({hideMatureOverlay:true});
  await settle();
  assert.ok(document.querySelector('configured-xpromo-modal'));
});

test('a configured Reddit promotional dialog with an explicit browser action can continue', async t => {
  const {trace} = setup(t, `
    <configured-xpromo-modal>
      <rpl-dialog open dialog-id="configured-xpromo-app_prompt">
        <h3 slot="title">See Reddit in the app</h3><a slot="primary-button" href="https://app.example/">View In App</a>
        <button slot="secondary-button">Continue in browser</button>
      </rpl-dialog>
    </configured-xpromo-modal>`);
  await settle();
  assert.deepEqual(trace, ['Continue in browser']);
});

test('revealing NSFW media is opt-in and only uses the native control on the opened mobile post', async t => {
  const mediaGate = reason => `<shreddit-blurred-container reason="${reason}" blurred></shreddit-blurred-container>`;
  const {document, trace, setSettings} = setup(t, `<main><shreddit-post id="t3_abc123">
    <div slot="post-media-container">${mediaGate('nsfw')}${mediaGate('spoiler')}</div>
  </shreddit-post><shreddit-post id="t3_other"><div slot="post-media-container">${mediaGate('nsfw')}</div></shreddit-post></main>`,
  'iOS', {}, undefined, 'https://www.reddit.com/r/example/comments/abc123/example/');
  for (const gate of document.querySelectorAll('shreddit-blurred-container')) {
    const root = gate.attachShadow({mode:'open'});
    root.innerHTML = `<button>${gate.getAttribute('reason')}</button>`;
  }
  await settle();
  assert.deepEqual(trace, []);
  setSettings({revealNsfwPostMedia:true});
  await settle();
  assert.deepEqual(trace, ['nsfw']);
});

test('a saved media preference reveals the opened post on load through the trusted worker', async t => {
  const {document, trace} = setup(t, `<main><shreddit-post id="t3_abc123"><div slot="post-media-container">
    <shreddit-blurred-container reason="nsfw" blurred></shreddit-blurred-container>
  </div></shreddit-post></main>`, 'iOS', {revealNsfwPostMedia:true}, undefined,
  'https://www.reddit.com/r/example/comments/abc123/example/');
  document.querySelector('shreddit-blurred-container').attachShadow({mode:'open'}).innerHTML = '<button>Reveal NSFW media</button>';
  await settle();
  assert.deepEqual(trace, ['Reveal NSFW media']);
});

test('Reddit can replace its reveal button when hydration reapplies the post blur', async t => {
  const {document, trace} = setup(t, `<main><shreddit-post id="t3_abc123"><div slot="post-media-container">
    <shreddit-blurred-container reason="nsfw" blurred></shreddit-blurred-container>
  </div></shreddit-post></main>`, 'iOS', {revealNsfwPostMedia:true}, undefined,
  'https://www.reddit.com/r/example/comments/abc123/example/');
  const gate = document.querySelector('shreddit-blurred-container');
  const shadow = gate.attachShadow({mode:'open'});
  shadow.addEventListener('click', () => {
    gate.removeAttribute('blurred');
    shadow.replaceChildren();
  });
  shadow.innerHTML = '<button>Reveal NSFW media</button>';
  await settle();
  assert.equal(gate.hasAttribute('blurred'), false);
  gate.setAttribute('blurred', '');
  shadow.innerHTML = '<button>Reveal NSFW media</button>';
  await settle();
  assert.equal(gate.hasAttribute('blurred'), false);
  assert.deepEqual(trace, ['Reveal NSFW media', 'Reveal NSFW media']);
});

const inlinePromotion = '<xpromo-nsfw-blocking-container><shreddit-blurred-container reason="nsfw" blurred>' +
  '<div slot="revealed"><shreddit-player></shreddit-player></div></shreddit-blurred-container>' +
  '<a slot="view-in-app-button" href="https://app.example/">View in app</a></xpromo-nsfw-blocking-container>';
const inlinePost = (id, promotion = inlinePromotion) =>
  `<shreddit-post id="t3_${id}"><div slot="post-media-container">${promotion}</div></shreddit-post>`;
const inlinePostURL = 'https://www.reddit.com/r/example/comments/abc123/example/';
const attachPromotion = host => {
  const shadow = host.attachShadow({mode:'open'});
  shadow.innerHTML = '<slot></slot><div class="prompt"><h3>Mature Content</h3><slot name="view-in-app-button"></slot></div>';
  return shadow;
};

test('only the opened mobile post hides its inline app promotion independently of media blur', async t => {
  const {window, document, setOverlay, trace} = setup(t, `<main>${inlinePost('abc123')}${inlinePost('other')}</main>`,
    'iOS', {hideMatureOverlay:false}, undefined, inlinePostURL);
  const [current, other] = document.querySelectorAll('xpromo-nsfw-blocking-container');
  const promotion = attachPromotion(current);
  attachPromotion(other);
  const player = current.querySelector('shreddit-player');
  const hidden = 'data-rt-hide-post-app-prompt';
  await settle();
  assert.equal(current.hasAttribute(hidden), false);
  setOverlay(true);
  await settle();
  assert.equal(current.hasAttribute(hidden), true);
  assert.match(promotion.querySelector('style').textContent, /:host\(\[data-rt-hide-post-app-prompt\]\).*\.prompt.*display:\s*none/s);
  assert.equal(other.hasAttribute(hidden), false);
  assert.equal(current.querySelector('shreddit-player'), player);
  assert.ok(current.querySelector('shreddit-blurred-container[blurred]'));
  assert.deepEqual(trace, []);

  window.history.pushState(null, '', '/r/example/comments/other/example/');
  document.dispatchEvent(new window.Event('reddit:route'));
  assert.equal(current.hasAttribute(hidden), false);
  assert.equal(other.hasAttribute(hidden), true);
  setOverlay(false);
  assert.equal(other.hasAttribute(hidden), false);
});

test('a late inline shadow root is handled and desktop keeps its promotion', async t => {
  const markup = `<main>${inlinePost('abc123')}</main>`;
  const phone = setup(t, markup, true, {}, undefined, inlinePostURL);
  const desktop = setup(t, markup, false, {}, undefined, inlinePostURL);
  await settle();
  const mobileShadow = attachPromotion(phone.document.querySelector('xpromo-nsfw-blocking-container'));
  const desktopShadow = attachPromotion(desktop.document.querySelector('xpromo-nsfw-blocking-container'));
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.ok(mobileShadow.querySelector('style'));
  assert.equal(desktopShadow.querySelector('style'), null);
});
