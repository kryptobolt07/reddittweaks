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

function setup(t, markup = '', android = true) {
  const {window} = new JSDOM(markup, {url: 'https://www.reddit.com/r/example/', runScripts: 'outside-only'});
  if (android) Object.defineProperty(window.navigator, 'userAgentData', {value: {platform: 'Android'}});
  const trace = [];
  window.document.addEventListener('click', event => {
    trace.push(event.composedPath()[0].textContent.trim());
    event.preventDefault();
  });
  window.eval(source());
  t.after(() => window.close());
  return {window, document: window.document, trace};
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
