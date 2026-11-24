const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const coreSource = fs.readFileSync(path.join(__dirname, '../extension/rt-core.js'), 'utf8');
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

function setupCore(t, { url = 'https://www.reddit.com/', localBoot = null, settingsResponse = { ok: true, settings: { smoothFeeds: true, commentThreadlines: 'classic' } }, sendMessageImpl } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main></main></body></html>', { url, runScripts: 'outside-only' });
  const W = dom.window;
  t.after(() => W.close());

  if (localBoot !== null) {
    W.localStorage.setItem('rt-boot-cfg-v1', typeof localBoot === 'string' ? localBoot : JSON.stringify(localBoot));
  }

  const frames = [];
  W.requestAnimationFrame = fn => { frames.push(fn); return frames.length; };

  const ipcs = [];
  const runtimeListeners = [];
  const storageListeners = [];
  W.chrome = {
    runtime: {
      id: 'ext-own',
      async sendMessage(msg) {
        ipcs.push(msg);
        if (sendMessageImpl) return sendMessageImpl(msg);
        return settingsResponse;
      },
      onMessage: { addListener(fn) { runtimeListeners.push(fn); } }
    },
    storage: {
      onChanged: { addListener(fn) { storageListeners.push(fn); } }
    }
  };

  W.eval(coreSource);
  return {
    W,
    D: W.document,
    core: W.RTCore,
    ipcs,
    flushRaf() { while (frames.length) frames.shift()(); },
    emitRuntime(msg, sender = { id: 'ext-own' }) { for (const fn of runtimeListeners) fn(msg, sender); },
    emitStorage(changes, area = 'local') { for (const fn of storageListeners) fn(changes, area); }
  };
}

test('RTCore.settings shares one get-settings IPC, mirrors allowlisted primitives cleanly, and ignores foreign senders', async t => {
  const { W, core, ipcs, emitRuntime, emitStorage } = setupCore(t, {
    localBoot: { commentThreadlines: 'muted', evilCookie: 'secret', badArr: [1, 2], longStr: 'x'.repeat(100) },
    settingsResponse: { ok: true, settings: { commentThreadlines: 'autumn', backToTop: true, stolenToken: 'abc' } }
  });

  // Sync mirror reads only allowlisted UI primitives.
  assert.deepEqual(JSON.parse(JSON.stringify(core.settings.readSync())), { commentThreadlines: 'muted' });

  const events = [];
  const unsub1 = core.settings.subscribe((s, meta) => events.push(['s1', s, meta]));
  const unsub2 = core.settings.subscribe((s, meta) => events.push(['s2', s, meta]));

  // Both subscribers got immediate sync delivery from mirror before IPC finished.
  assert.equal(events[0][0], 's1');
  assert.deepEqual(JSON.parse(JSON.stringify(events[0][1])), { commentThreadlines: 'muted' });
  assert.equal(events[0][2].sync, true);
  assert.equal(events[1][0], 's2');
  assert.equal(events[1][2].sync, true);
  assert.equal(ipcs.length, 1, 'multiple callers coalesce into a single get-settings IPC');

  // Extra getResponse/get reuses memoized promise.
  const [rA, rB] = await Promise.all([core.settings.getResponse(), core.settings.get()]);
  assert.equal(rA.ok, true);
  assert.equal(rB.commentThreadlines, 'autumn');
  assert.equal(ipcs.length, 1);

  await settle();
  const mirrorAfterWorker = JSON.parse(W.localStorage.getItem('rt-boot-cfg-v1'));
  assert.deepEqual(mirrorAfterWorker, { commentThreadlines: 'autumn', backToTop: true });
  assert.equal('stolenToken' in mirrorAfterWorker, false, 'non-allowlisted keys never enter rt-boot-cfg-v1');

  // Foreign extension sender is ignored.
  const countBefore = events.length;
  emitRuntime({ scope: 'rt-posts', action: 'settings-changed', settings: { backToTop: false } }, { id: 'foreign-ext' });
  assert.equal(events.length, countBefore);

  // Valid runtime settings-changed pushes live update and updates boot mirror.
  emitRuntime({ scope: 'rt-posts', action: 'settings-changed', settings: { commentThreadlines: 'classic', backToTop: false } });
  assert.equal(events.at(-1)[1].commentThreadlines, 'classic');
  assert.equal(JSON.parse(W.localStorage.getItem('rt-boot-cfg-v1')).commentThreadlines, 'classic');

  unsub1();
  emitStorage({ 'rt-settings-v1': { newValue: { commentThreadlines: 'off', backToTop: true } } });
  assert.equal(events.filter(e => e[0] === 's2').at(-1)[1].backToTop, true);
  unsub2();
});

test('RTCore.observer pools a single MutationObserver lazily, batches per frame, and watchSelector cleans up on unsubscribe', async t => {
  const { W, D, core, flushRaf } = setupCore(t);
  let observerConstructions = 0;
  let disconnects = 0;
  const OrigMO = W.MutationObserver;
  W.MutationObserver = class extends OrigMO {
    constructor(cb) { super(cb); observerConstructions++; }
    disconnect() { disconnects++; return super.disconnect(); }
  };

  D.body.innerHTML = '<div class="item" id="i0"></div>';
  const addedIds = [];
  const removedIds = [];
  const off1 = core.observer.watchSelector('.item', {
    onAdd: el => addedIds.push(el.id),
    onRemove: el => removedIds.push(el.id)
  });
  assert.deepEqual(addedIds, ['i0'], 'existing elements delivered synchronously');

  const n1 = D.createElement('div');
  n1.className = 'wrap';
  n1.innerHTML = '<div class="item" id="i1"></div>';
  D.body.append(n1);
  await settle();
  flushRaf();
  assert.deepEqual(addedIds, ['i0', 'i1']);

  n1.remove();
  await settle();
  flushRaf();
  assert.deepEqual(removedIds, ['i1']);

  // Re-adding triggers onAdd again because seen WeakSet dropped removed element.
  D.body.append(n1);
  await settle();
  flushRaf();
  assert.deepEqual(addedIds, ['i0', 'i1', 'i1']);

  off1();
  const n2 = D.createElement('div');
  n2.className = 'item';
  n2.id = 'i2';
  D.body.append(n2);
  await settle();
  flushRaf();
  assert.deepEqual(addedIds, ['i0', 'i1', 'i1'], 'no notifications after unsubscribe');
  assert.equal(observerConstructions, 1, 'lazy observer created once on first subscription');
  assert.equal(disconnects, 1, 'unsubscribing the sole watcher disconnects the pooled observer');
});

test('RTCore.observer tears down its MutationObserver when the last subscriber leaves and restarts on next subscribe', async t => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.reddit.com/', runScripts: 'outside-only' });
  const W = dom.window;
  t.after(() => W.close());
  let observes = 0;
  let disconnects = 0;
  const OrigMO = W.MutationObserver;
  W.MutationObserver = class extends OrigMO {
    observe(target, opts) { observes++; return super.observe(target, opts); }
    disconnect() { disconnects++; return super.disconnect(); }
  };
  W.eval(coreSource);
  assert.equal(observes, 0, 'idle RTCore does not start MutationObserver until first subscriber');

  const u1 = W.RTCore.observer.subscribe(() => {});
  const u2 = W.RTCore.observer.subscribe(() => {});
  assert.equal(observes, 1, 'multiple subscribers share one MutationObserver');
  u1();
  assert.equal(disconnects, 0);
  u2();
  assert.equal(disconnects, 1, 'last unsubscribe disconnects shared observer');
});

test('RTCore.routes fires on navigation API, popstate, reddit:route, and deduplicates identical URLs', t => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://www.reddit.com/r/pics/', runScripts: 'outside-only' });
  const W = dom.window;
  t.after(() => W.close());
  const navBus = new W.EventTarget();
  W.navigation = navBus;
  W.eval(coreSource);

  const seen = [];
  const off = W.RTCore.routes.subscribe(info => seen.push([info.pathname, info.navType]));

  W.history.pushState({}, '', '/r/pics/comments/abc12/post/');
  const navEv = new W.Event('currententrychange');
  navEv.navigationType = 'push';
  navBus.dispatchEvent(navEv);
  assert.deepEqual(seen, [['/r/pics/comments/abc12/post/', 'push']]);

  // Duplicate URL via popstate without URL change is deduplicated.
  W.dispatchEvent(new W.PopStateEvent('popstate'));
  assert.equal(seen.length, 1);

  // Forced reddit:route delivers current route even if href matched.
  W.document.dispatchEvent(new W.CustomEvent('reddit:route'));
  assert.equal(seen.length, 2);
  assert.equal(seen[1][1], 'reddit');

  off();
});

test('RTCore.adoptStyles manages <style> fallback cleanly when CSSStyleSheet is unavailable and removes empty styles', t => {
  const { W, D, core } = setupCore(t);
  // Test fallback in jsdom (or force fallback check).
  const el1 = core.adoptStyles(D, 'rt-test', 'body { color: red; }');
  assert.ok(el1);
  assert.equal(D.querySelectorAll('[data-rt-sheet="rt-test"]').length <= 1, true);

  core.adoptStyles(D, 'rt-test', 'body { color: blue; }');
  const styleEl = D.querySelector('[data-rt-sheet="rt-test"]');
  if (styleEl) {
    assert.equal(styleEl.textContent, 'body { color: blue; }');
  } else {
    assert.ok(D.adoptedStyleSheets.includes(el1));
  }

  core.adoptStyles(D, 'rt-test', '');
  assert.equal(D.querySelector('[data-rt-sheet="rt-test"]'), null);
});
