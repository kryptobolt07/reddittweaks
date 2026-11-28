const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const SAMPLE_CELL = (uuid = 'abc1234', sub = 'pixelart', postId = '1gylby2') =>
  `<div class="grid-cell" data-uuid="${uuid}" data-title="Ice Cream" data-src="https://image.infini.wtf/${uuid}/400/80/thumbnail.webp" data-sub-html="https://reddit.com/r/${sub}/comments/${postId}/ice_cream/"></div>`;

function mkResponse(body = '', { status = 200, url = 'https://infini.wtf/', headers = {}, streamChunks = null } = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: k => headers[k] ?? headers[k.toLowerCase()] ?? null },
    body: streamChunks
      ? {
          getReader() {
            let idx = 0;
            return {
              async read() {
                if (idx >= streamChunks.length) return { done: true, value: undefined };
                return { done: false, value: streamChunks[idx++] };
              },
              async cancel() {},
              releaseLock() {}
            };
          }
        }
      : { async cancel() {} },
    async text() { return buf.toString('utf8'); },
    async arrayBuffer() { return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength); }
  };
}

function setup({
  settings = { visualSearch: true },
  origins = ['https://infini.wtf/*', 'https://image.infini.wtf/*', 'https://video.infini.wtf/*'],
  fetcher,
  downloadsImpl,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  let msgListener, storageListener, permRemovedListener;
  const calls = [];
  const downloads = [];
  const session = {};
  let stored = settings;
  const granted = new Set(origins);

  const chrome = {
    runtime: {
      id: 'own',
      onMessage: { addListener(fn) { msgListener = fn; } }
    },
    storage: {
      local: { async get() { return { 'rt-settings-v1': stored }; } },
      session: {
        async get(k) { return { [k]: session[k] }; },
        async set(vals) { Object.assign(session, JSON.parse(JSON.stringify(vals))); }
      },
      onChanged: { addListener(fn) { storageListener = fn; } }
    },
    permissions: {
      async contains({ origins: req }) { return req.every(o => granted.has(o)); },
      onRemoved: { addListener(fn) { permRemovedListener = fn; } }
    },
    downloads: {
      download(opts, cb) {
        downloads.push(opts);
        if (downloadsImpl) return downloadsImpl(opts, cb);
        cb?.(99);
        return Promise.resolve(99);
      }
    }
  };

  class FakeFormData {
    constructor() { this.fields = []; }
    append(name, value, filename) { this.fields.push({ name, value, filename }); }
  }

  const context = vm.createContext({
    URL,
    URLSearchParams,
    AbortController,
    Date,
    console,
    setTimeout: setTimer,
    clearTimeout: clearTimer,
    TextDecoder,
    Blob,
    FormData: FakeFormData,
    atob: s => Buffer.from(s, 'base64').toString('binary'),
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    crypto: crypto.webcrypto,
    chrome,
    fetch: async (url, init) => {
      calls.push([url, init]);
      return fetcher ? fetcher(url, init) : mkResponse(SAMPLE_CELL(), { url });
    }
  });

  for (const file of ['post-model.js', 'download-model.js', 'visual-search-model.js', 'visual-search-broker.js']) {
    vm.runInContext(fs.readFileSync('extension/' + file, 'utf8'), context);
  }

  return {
    calls,
    downloads,
    session,
    setSettings(next) {
      stored = next;
      storageListener?.({ 'rt-settings-v1': { newValue: next } }, 'local');
    },
    revokeOrigin(origin) {
      granted.delete(origin);
      permRemovedListener?.({ origins: [origin] });
    },
    grantOrigin(origin) { granted.add(origin); },
    send(message = {}, sender = {}) {
      return new Promise(resolve => {
        const ret = msgListener(
          { scope: 'rt-visual-search', ...message },
          { id: 'own', frameId: 0, url: 'https://www.reddit.com/search/?q=ice+cream&type=media&rt_visual=1', ...sender },
          resolve
        );
        if (ret !== true) resolve(undefined);
      });
    }
  };
}

test('broker rejects foreign callers and disabled setting', async () => {
  const b = setup({ settings: { visualSearch: false } });
  for (const sender of [
    { id: 'other-ext' },
    { frameId: 2 },
    { url: 'http://www.reddit.com/search/' },
    { url: 'https://reddit.com.evil/search/' }
  ]) {
    assert.equal((await b.send({ action: 'query', kind: 'popular' }, sender)).code, 'forbidden');
  }

  assert.equal((await b.send({ action: 'query', kind: 'popular' })).code, 'disabled');
  assert.equal(b.calls.length, 0);
});

test('the request deadline covers a stalled response body and releases its slot', async () => {
  const timers = new Map();
  let nextTimer = 0;
  const b = setup({
    setTimer(callback) { timers.set(++nextTimer, callback); return nextTimer; },
    clearTimer(id) { timers.delete(id); },
    fetcher: async (url, { signal }) => {
      if (url.includes('queued')) return mkResponse(SAMPLE_CELL(), { url });
      return {
        ok: true, status: 200, url, bodyUsed: true,
        body: {
          getReader() {
            return {
              read: () => new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('Aborted')), { once: true })),
              releaseLock() {}
            };
          }
        }
      };
    }
  });
  const requests = ['one', 'two', 'three', 'queued'].map(target => b.send({ action: 'query', kind: 'search', target }));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.calls.length, 3);
  assert.equal(timers.size, 3, 'the deadline remains armed after headers arrive');
  for (const callback of [...timers.values()]) callback();
  const replies = await Promise.all(requests);
  assert.deepEqual(replies.slice(0, 3).map(reply => reply.code), ['timeout', 'timeout', 'timeout']);
  assert.equal(replies[3].items[0].uuid, 'abc1234');
  assert.equal(timers.size, 0);
});

test('query uses credential-free fetch, caches separately for safe vs nsfw, and clears nsfw cache on nsfwOnly reset', async () => {
  const b = setup({
    fetcher: async url => {
      const nsfw = url.includes('nsfw=true');
      return mkResponse(SAMPLE_CELL(nsfw ? 'nsfwUuid1' : 'safeUuid1'));
    }
  });

  const safeRes = await b.send({ action: 'query', kind: 'search', target: 'ice cream', filters: { nsfw: false } });
  assert.equal(safeRes.ok, true);
  assert.equal(safeRes.items[0].uuid, 'safeUuid1');
  const [safeUrl, safeInit] = b.calls[0];
  assert.equal(safeUrl, 'https://infini.wtf/search/ice-cream.turbo_stream?page=1');
  assert.equal(safeInit.credentials, 'omit');
  assert.equal(safeInit.referrerPolicy, 'no-referrer');
  assert.equal(safeInit.headers.Accept, 'text/vnd.turbo-stream.html');

  // Cached hit on repeat safe search
  const safeCached = await b.send({ action: 'query', kind: 'search', target: 'ice cream', filters: { nsfw: false } });
  assert.equal(safeCached.cached, true);
  assert.equal(b.calls.length, 1);

  // NSFW query uses separate cache key and omits gay/trans
  const nsfwRes = await b.send({ action: 'query', kind: 'search', target: 'ice cream', filters: { nsfw: true, gay: true, trans: true } });
  assert.equal(nsfwRes.items[0].uuid, 'nsfwUuid1');
  assert.equal(b.calls[1][0], 'https://infini.wtf/search/ice-cream.turbo_stream?page=1&nsfw=true');
  assert.equal(b.calls[1][0].includes('gay'), false);
  assert.equal(b.calls[1][0].includes('trans'), false);

  // Turning NSFW off clears |1| entries only
  await b.send({ action: 'clear-cache', nsfwOnly: true });
  const safeStillCached = await b.send({ action: 'query', kind: 'search', target: 'ice cream', filters: { nsfw: false } });
  assert.equal(safeStillCached.cached, true);
  assert.equal(b.calls.length, 2);

  const nsfwRefetched = await b.send({ action: 'query', kind: 'search', target: 'ice cream', filters: { nsfw: true } });
  assert.equal(nsfwRefetched.cached, false);
  assert.equal(b.calls.length, 3);
});

test('rate limits persist backoff and concurrent queries stay capped at 3', async () => {
  const gates = [];
  const b = setup({
    fetcher: () => new Promise(resolve => gates.push(() => resolve(mkResponse(SAMPLE_CELL('u' + gates.length)))))
  });

  const p1 = b.send({ action: 'query', kind: 'search', target: 'one' });
  const p2 = b.send({ action: 'query', kind: 'search', target: 'two' });
  const p3 = b.send({ action: 'query', kind: 'search', target: 'three' });
  const p4 = b.send({ action: 'query', kind: 'search', target: 'four' });
  await new Promise(r => setImmediate(r));
  assert.equal(b.calls.length, 3);
  gates[0]();
  await p1;
  await new Promise(r => setImmediate(r));
  assert.equal(b.calls.length, 4);
  gates[1]();
  gates[2]();
  gates[3]();
  await Promise.all([p2, p3, p4]);

  const rate = setup({
    fetcher: async () => mkResponse('', { status: 429, headers: { 'Retry-After': '30' } })
  });
  const first = await rate.send({ action: 'query', kind: 'popular' });
  assert.equal(first.code, 'rate-limited');
  assert.ok(rate.session['rt-visual-backoff-v1'].cooldownUntil > Date.now());
  const second = await rate.send({ action: 'query', kind: 'search', target: 'cats' });
  assert.equal(second.code, 'rate-limited');
  assert.equal(rate.calls.length, 1);
});

test('bounded reader rejects oversized HTML streams', async () => {
  const bigChunk = new Uint8Array(2_000_001);
  const b = setup({
    fetcher: async () => mkResponse('', { status: 200, streamChunks: [bigChunk] })
  });
  const res = await b.send({ action: 'query', kind: 'popular' });
  assert.equal(res.code, 'invalid-response');
});

test('resolve-post uses lowercase subreddit HEAD lookup, falls back to GET on 405, and flags unindexed posts without uploading', async () => {
  const b = setup({
    fetcher: async (url, init) => {
      if (url.includes('/r/pixelart/comments/1gylby2/') && init.method === 'HEAD') {
        return mkResponse('', { status: 405 });
      }
      if (url.includes('/r/pixelart/comments/1gylby2/') && init.method === 'GET') {
        return mkResponse('', { status: 200, url: 'https://infini.wtf/view/ice-cream-9IQd9DEfnVhMCMa2' });
      }
      return mkResponse('', { status: 404, url });
    }
  });

  const hit = await b.send({ action: 'resolve-post', subreddit: 'PixelArt', postId: 't3_1gylby2' });
  assert.equal(hit.ok, true);
  assert.equal(hit.indexed, true);
  assert.equal(hit.viewId, 'ice-cream-9IQd9DEfnVhMCMa2');
  assert.equal(b.calls[0][0], 'https://infini.wtf/r/pixelart/comments/1gylby2/');

  const miss = await b.send({ action: 'resolve-post', subreddit: 'pics', postId: '9xyz1' });
  assert.equal(miss.ok, true);
  assert.equal(miss.indexed, false);
  // Zero POST /image-queries calls triggered automatically for unindexed post
  assert.equal(b.calls.some(([u, i]) => i?.method === 'POST'), false);
});

test('post stills are returned to the canvas pipeline with bounded, anonymous reads', async () => {
  const b = setup({
    origins: ['https://cf.preview.redd.it/*', 'https://i.ytimg.com/*'],
    fetcher: async url => mkResponse(Buffer.from('still'), {
      url,
      headers: {
        'content-type': url.endsWith('bad.jpg') ? 'text/html' : 'image/jpeg',
        ...(url.endsWith('big.jpg') ? { 'content-length': '10000001' } : {})
      }
    })
  });
  const redditStill = 'https://cf.preview.redd.it/still.jpg?width=640&s=x';
  const youTubeStill = 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg';
  for (const url of [redditStill, youTubeStill]) {
    const res = await b.send({ action: 'fetch-still', url });
    assert.equal(res.ok, true);
    assert.equal(res.mimeType, 'image/jpeg');
    assert.equal(Buffer.from(res.base64, 'base64').toString(), 'still');
  }
  for (const [url, init] of b.calls) {
    assert.ok([redditStill, youTubeStill].includes(url));
    assert.equal(init.credentials, 'omit');
    assert.equal(init.referrerPolicy, 'no-referrer');
    assert.equal(init.redirect, 'error');
  }
  for (const url of ['https://evil.test/photo.jpg', 'https://i.ytimg.com/elsewhere.jpg', 'https://user@cf.preview.redd.it/still.jpg']) {
    assert.equal((await b.send({ action: 'fetch-still', url })).code, 'invalid-request');
  }
  assert.equal((await b.send({ action: 'fetch-still', url: 'https://preview.redd.it/still.jpg' })).code, 'permission-required');
  assert.equal(b.calls.length, 2);
  assert.equal((await b.send({ action: 'fetch-still', url: 'https://cf.preview.redd.it/bad.jpg' })).code, 'reddit-image-error');
  assert.equal((await b.send({ action: 'fetch-still', url: 'https://cf.preview.redd.it/big.jpg' })).code, 'invalid-request');
  b.grantOrigin('https://infini.wtf/*');
  assert.equal((await b.send({ action: 'upload-image', redditImageUrl: redditStill })).code, 'invalid-request', 'the broker never uploads a raw still');
  assert.equal(b.calls.length, 4);
});

test('post lookup and queries only require access to the search service', async () => {
  const b = setup({ origins: ['https://infini.wtf/*'] });
  assert.equal((await b.send({ action: 'query', kind: 'popular' })).ok, true);
  assert.equal((await b.send({ action: 'fetch-video', url: 'https://video.infini.wtf/v1/original.mp4' })).code, 'permission-required');
  assert.equal(b.calls.length, 1);
});

test('upload-image checks image-queries hash first and skips POST when already indexed', async () => {
  const bytes = Buffer.from('fake-webp-bytes');
  const b64 = bytes.toString('base64');
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');

  const hitBroker = setup({
    fetcher: async url => {
      if (url.endsWith('/image-queries/' + hash)) {
        return mkResponse(JSON.stringify({ uuid: 'existingUuid1', has_embedding: true }));
      }
      throw Error('Should not POST when hash exists');
    }
  });
  const hit = await hitBroker.send({ action: 'upload-image', dataBase64: b64, mimeType: 'image/webp' });
  assert.equal(hit.ok, true);
  assert.equal(hit.uploaded, false);
  assert.equal(hit.uuid, 'existingUuid1');
  assert.equal(hit.hasEmbedding, true);
  assert.equal(hitBroker.calls.length, 1);

  const newBroker = setup({
    fetcher: async (url, init) => {
      if (url.endsWith('/image-queries/' + hash) && init.method === 'GET') {
        return mkResponse('', { status: 404 });
      }
      if (url === 'https://infini.wtf/image-queries' && init.method === 'POST') {
        assert.equal(init.credentials, 'omit');
        assert.equal(init.body.fields.find(f => f.name === 'image_hash')?.value, hash);
        return mkResponse(JSON.stringify({ uuid: 'uploadedUuid2', has_embedding: false }));
      }
      throw Error('Unexpected fetch: ' + url);
    }
  });
  const created = await newBroker.send({ action: 'upload-image', dataBase64: b64, mimeType: 'image/webp' });
  assert.equal(created.ok, true);
  assert.equal(created.uploaded, true);
  assert.equal(created.uuid, 'uploadedUuid2');
  assert.equal(created.hasEmbedding, false);
});

test('fetch-video returns base64 for blob CSP compliance, and download invokes chrome.downloads', async () => {
  const b = setup({
    fetcher: async url => mkResponse(Buffer.from('mp4bytes'), { status: 200, url })
  });
  const vid = await b.send({ action: 'fetch-video', url: 'https://video.infini.wtf/v1/original.mp4' });
  assert.equal(vid.ok, true);
  assert.equal(vid.mimeType, 'video/mp4');
  assert.equal(Buffer.from(vid.base64, 'base64').toString('utf8'), 'mp4bytes');
  assert.equal(b.calls[0][1].redirect, 'error');

  const dl = await b.send({ action: 'download', url: '/download/abc1234?is_animated=false', filename: 'ice/cream?.webp' });
  assert.equal(dl.ok, true);
  assert.equal(b.downloads[0].url, 'https://infini.wtf/download/abc1234?is_animated=false');
  assert.equal(b.downloads[0].filename.includes('/'), false);
});

test('broker supports multi-page pagination and strictly separates videos vs gifs', async () => {
  const gifCell = `<div class="grid-cell" data-uuid="gifOnly1" data-poster="https://image.infini.wtf/gifOnly1/480/80/t.webp" data-video='{"source":[{"src":"https://video.infini.wtf/gifOnly1/original.mp4"}],"attributes":{"muted":true,"loop":true}}' data-download-url="/download/gifOnly1?is_animated=true" data-sub-html="https://reddit.com/r/pics/comments/a1/"></div>`;
  const vidCell = `<div class="grid-cell" data-uuid="vidOnly2" data-poster="https://image.infini.wtf/vidOnly2/480/80/t.webp" data-video='{"source":[{"src":"https://video.infini.wtf/vidOnly2/original.mp4"}],"attributes":{"controls":true,"loop":true}}' data-download-url="/download/vidOnly2?is_animated=true" data-sub-html="https://reddit.com/r/funny/comments/b2/"></div>`;
  const b = setup({
    fetcher: async url => {
      if (url.includes('page=2')) {
        return mkResponse(SAMPLE_CELL('page2Uuid'));
      }
      if (url.includes('media_type=videos') || url.includes('media_type=gifs')) {
        return mkResponse(gifCell + vidCell);
      }
      return mkResponse(SAMPLE_CELL('page1Uuid') + '<div data-infinite-scroll-url-value="/search/ice-cream.turbo_stream?page=2"></div>');
    }
  });

  const p1 = await b.send({ action: 'query', kind: 'search', target: 'ice cream', page: 1 });
  assert.equal(p1.page, 1);
  assert.equal(p1.hasMore, true);
  assert.equal(p1.nextPage, 2);
  assert.equal(p1.items[0].uuid, 'page1Uuid');

  const p2 = await b.send({ action: 'query', kind: 'search', target: 'ice cream', page: 2 });
  assert.equal(p2.page, 2);
  assert.equal(p2.hasMore, false);
  assert.equal(p2.nextPage, 0);
  assert.equal(p2.items[0].uuid, 'page2Uuid');

  const videosOnly = await b.send({ action: 'query', kind: 'search', target: 'ice cream', filters: { mediaType: 'videos' } });
  assert.deepEqual([...videosOnly.items].map(i => i.uuid), ['vidOnly2']);

  const gifsOnly = await b.send({ action: 'query', kind: 'search', target: 'ice cream', filters: { mediaType: 'gifs' } });
  assert.deepEqual([...gifsOnly.items].map(i => i.uuid), ['gifOnly1']);
});
