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
  let changed;
  window.chrome = {storage: {local: {get: async key => ({[key]: await readSettings})}, onChanged: {addListener(listener) { changed = listener; }}}};
  const setSettings = settings => changed?.({'rt-settings-v1': {newValue: settings}}, 'local');
  window.document.addEventListener('click', event => {
    trace.push(event.composedPath()[0].textContent.trim());
    event.preventDefault();
  });
  window.eval(source());
  t.after(() => window.close());
  return {window, document: window.document, trace, setSettings, setOverlay: value => setSettings({hideMatureOverlay:value})};
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
  const {window, document, trace} = setup(t, `
    <main><article>Existing web content</article></main>${appOnly}
    <rpl-dialog open blocking dialog-id="confirm-account"><button>Sign in</button></rpl-dialog>`);
  await settle();
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

test('the mobile overlay follows its saved preference and changes to that preference', async t => {
  const {document, setOverlay} = setup(t, appOnly, true, {hideMatureOverlay:false});
  await settle();
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
