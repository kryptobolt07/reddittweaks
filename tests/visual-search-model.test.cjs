const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadModel() {
  const ctx = vm.createContext({ URL, URLSearchParams, Set, Map, Number, String, Array, Object, JSON, Math });
  vm.runInContext(fs.readFileSync('extension/visual-search-model.js', 'utf8'), ctx);
  return ctx.RTVisualSearchModel;
}

test('slugifyQuery and normalizeQuery strip Reddit operators and scope community/author cleanly', () => {
  const M = loadModel();
  assert.equal(M.slugifyQuery('Ice Cream &amp; Cones!'), 'ice-cream-cones');
  assert.equal(M.slugifyQuery("Don't Stop"), 'dont-stop');

  const q1 = M.normalizeQuery('subreddit:PixelArt author:Example_1 flair:"Art Show" nsfw:yes ice cream');
  assert.equal(q1.text, 'ice cream');
  assert.equal(q1.slug, 'ice-cream');
  assert.equal(q1.scopedSubreddit, 'PixelArt');
  assert.equal(q1.scopedAuthor, 'Example_1');
  assert.deepEqual(JSON.parse(JSON.stringify(q1.stripped)), ['subreddit:PixelArt', 'author:Example_1', 'flair:"Art Show"', 'nsfw:yes']);

  const q2 = M.normalizeQuery('title:sunset r/nature self:no site:i.redd.it');
  assert.equal(q2.text, 'sunset');
  assert.equal(q2.slug, 'sunset');
  assert.equal(q2.scopedSubreddit, 'nature');
  assert.ok(q2.stripped.includes('title:'));
  assert.ok(q2.stripped.includes('site:i.redd.it'));
});

test('normalizeFilters and cacheKey default nsfw off and strictly exclude gay/trans', () => {
  const M = loadModel();
  const f1 = M.normalizeFilters({ nsfw: '1', gay: true, trans: true, mediaType: 'bogus', time: 'day' });
  assert.deepEqual(JSON.parse(JSON.stringify(f1)), { nsfw: false, mediaType: '', time: '' });

  const f2 = M.normalizeFilters({ nsfw: true, gay: true, trans: 'true', mediaType: 'videos', time: 'month' });
  assert.deepEqual(JSON.parse(JSON.stringify(f2)), { nsfw: true, mediaType: 'videos', time: 'month' });
  assert.equal('gay' in f2, false);
  assert.equal('trans' in f2, false);

  const safeKey = M.cacheKey({ kind: 'search', slug: 'ice-cream', filters: { nsfw: false, mediaType: 'images' } });
  const nsfwKey = M.cacheKey({ kind: 'search', slug: 'ice-cream', filters: { nsfw: true, mediaType: 'images' } });
  assert.equal(safeKey, 'search|ice-cream|0|images|-');
  assert.equal(nsfwKey, 'search|ice-cream|1|images|-');
  assert.notEqual(safeKey, nsfwKey);
});

test('buildEndpoint builds exact allowlisted infini.wtf URLs without gay/trans and lowercases subreddit paths', () => {
  const M = loadModel();

  assert.equal(
    M.buildEndpoint({ kind: 'search', query: 'ice cream', filters: { nsfw: false, mediaType: 'gifs' } }),
    'https://infini.wtf/search/ice-cream.turbo_stream?page=1&media_type=gifs'
  );
  assert.equal(
    M.buildEndpoint({ kind: 'search', query: 'ice cream', filters: { nsfw: true, gay: true, trans: true, mediaType: 'images', time: 'year' } }),
    'https://infini.wtf/search/ice-cream.turbo_stream?page=1&nsfw=true&media_type=images&time=year'
  );
  assert.equal(
    M.buildEndpoint({ kind: 'subreddit', target: 'r/PixelArt', filters: { nsfw: false } }),
    'https://infini.wtf/search/r/pixelart?format=turbo_stream&page=1'
  );
  assert.equal(
    M.buildEndpoint({ kind: 'user', target: 'u/SomeUser', filters: { nsfw: true } }),
    'https://infini.wtf/search/u/SomeUser?page=1&nsfw=true'
  );
  assert.equal(
    M.buildEndpoint({ kind: 'popular', filters: { mediaType: 'videos', time: 'month' } }),
    'https://infini.wtf/popular.turbo_stream?page=1&media_type=videos&time=month'
  );
  // /view/... ignores filter params per infini.wtf behavior
  assert.equal(
    M.buildEndpoint({ kind: 'view', viewId: 'ice-cream-9IQd9DEfnVhMCMa2', filters: { nsfw: true, mediaType: 'gifs' } }),
    'https://infini.wtf/view/ice-cream-9IQd9DEfnVhMCMa2.turbo_stream?page=1'
  );
  assert.equal(
    M.buildEndpoint({ kind: 'upload', uuid: 'abc123_XYZ', filters: { nsfw: true } }),
    'https://infini.wtf/search-by-upload/abc123_XYZ.turbo_stream?page=1&nsfw=true'
  );
  assert.equal(
    M.buildEndpoint({ kind: 'permalink', subreddit: 'PixelArt', postId: 't3_1gylby2' }),
    'https://infini.wtf/r/pixelart/comments/1gylby2/'
  );
  assert.equal(
    M.buildEndpoint({ kind: 'image-query', hash: 'a'.repeat(64) }),
    'https://infini.wtf/image-queries/' + 'a'.repeat(64)
  );
  assert.equal(M.buildEndpoint({ kind: 'image-upload' }), 'https://infini.wtf/image-queries');
  assert.equal(M.buildEndpoint({ kind: 'related', query: 'ice cream' }), 'https://infini.wtf/related_searches?query=ice+cream');
  assert.equal(M.buildEndpoint({ kind: 'autocomplete', query: 'ice' }), 'https://infini.wtf/autocomplete?query=ice');
  assert.equal(M.buildEndpoint({ kind: 'image-query', hash: 'bad' }), '');
  assert.equal(M.buildEndpoint({ kind: 'unknown' }), '');
});

test('URL validators enforce strict CDN/infini/Reddit hosts and HTTPS without credentials or ports', () => {
  const M = loadModel();
  assert.equal(M.safeImageUrl('https://image.infini.wtf/abc/400/80/thumbnail.webp'), 'https://image.infini.wtf/abc/400/80/thumbnail.webp');
  assert.equal(M.safeImageUrl('/download/abcd_1234'), 'https://infini.wtf/download/abcd_1234');
  for (const bad of [
    'http://image.infini.wtf/a.webp',
    'https://evil.com/a.webp',
    'https://user:pass@image.infini.wtf/a.webp',
    'https://image.infini.wtf:8443/a.webp',
    'javascript:alert(1)'
  ]) {
    assert.equal(M.safeImageUrl(bad), '', bad);
  }

  assert.equal(
    M.safeSrcset('https://image.infini.wtf/a/400/80/t.webp 400w, https://evil.com/x.webp 800w, https://image.infini.wtf/a/800/80/t.webp 800w'),
    'https://image.infini.wtf/a/400/80/t.webp 400w, https://image.infini.wtf/a/800/80/t.webp 800w'
  );

  assert.equal(M.safeVideoUrl('https://video.infini.wtf/abc123/original.mp4'), 'https://video.infini.wtf/abc123/original.mp4');
  assert.equal(M.safeVideoUrl('https://video.infini.wtf/abc123/original.webm'), '');
  assert.equal(M.safeVideoUrl('http://video.infini.wtf/abc123/original.mp4'), '');

  assert.equal(M.safeDownloadUrl('/download/abcd1234?is_animated=false', 'abcd1234'), 'https://infini.wtf/download/abcd1234?is_animated=false');
  assert.equal(M.safeDownloadUrl('https://evil.com/x', 'abcd1234'), 'https://infini.wtf/download/abcd1234?is_animated=false');

  assert.deepEqual(
    JSON.parse(JSON.stringify(M.safeRedditPermalink('<p>View on <a href="https://old.reddit.com/r/pixelart/comments/1gylby2/ice_cream/">r/pixelart</a></p>'))),
    { permalink: 'https://www.reddit.com/r/pixelart/comments/1gylby2/ice_cream/', subreddit: 'pixelart', postId: '1gylby2' }
  );
  assert.equal(M.safeRedditPermalink('https://reddit.com.evil/r/pics/comments/abc/'), null);
  assert.equal(M.parseViewUrl('https://infini.wtf/view/ice-cream-9IQd9DEfnVhMCMa2'), 'ice-cream-9IQd9DEfnVhMCMa2');
  assert.equal(M.parseViewUrl('https://evil.com/view/ice-cream-9IQd9DEfnVhMCMa2'), '');
});

test('parseGridCells parses Turbo Stream cells safely with quoted > attributes, entities, video JSON, and skips incomplete rows', () => {
  const M = loadModel();
  const stream = `
<turbo-stream action="append" target="grid">
  <template>
    <div class="grid-cell card"
         data-uuid="uuidOne123"
         data-title="Sweet &amp; &quot;Cold&quot; Cone"
         data-poster="https://image.infini.wtf/uuidOne123/400/80/thumbnail.webp"
         data-src="https://image.infini.wtf/uuidOne123/800/80/original.webp"
         data-srcset="https://image.infini.wtf/uuidOne123/400/80/thumbnail.webp 400w"
         data-video='{"source":[{"src":"https://video.infini.wtf/uuidOne123/original.mp4","type":"video/mp4"}]}'
         data-download-url="/download/uuidOne123?is_animated=true"
         data-sub-html="&lt;div class=&quot;cap&quot;&gt;&lt;a href=&quot;https://reddit.com/r/pixelart/comments/1gylby2/sweet_cone/&quot;&gt;Reddit&lt;/a&gt;&lt;/div&gt;">
      <a href="/view/sweet-cone-uuidOne123">View</a>
    </div>
    <div class="grid-cell"
         data-uuid="uuidOne123"
         data-src="https://image.infini.wtf/uuidOne123/400/80/thumbnail.webp"
         data-sub-html="https://reddit.com/r/pixelart/comments/1gylby2/">
    </div>
    <div class="grid-cell"
         data-uuid="missingPermalink"
         data-src="https://image.infini.wtf/missingPermalink/400/80/thumbnail.webp">
    </div>
    <div class="grid-cell"
         data-uuid="uuidTwo456"
         data-title="Second &gt; Item"
         data-src="https://image.infini.wtf/uuidTwo456/600/80/original.webp"
         data-sub-html="https://reddit.com/r/pics/comments/9xyz1/second/">
    </div>
  </template>
</turbo-stream>`;

  const parsed = M.parseGridCells(stream);
  assert.equal(parsed.skippedCount, 1);
  assert.equal(parsed.items.length, 2);

  assert.deepEqual(JSON.parse(JSON.stringify(parsed.items[0])), {
    uuid: 'uuidOne123',
    title: 'Sweet & "Cold" Cone',
    thumb: 'https://image.infini.wtf/uuidOne123/400/80/thumbnail.webp',
    src: 'https://image.infini.wtf/uuidOne123/800/80/original.webp',
    srcset: 'https://image.infini.wtf/uuidOne123/400/80/thumbnail.webp 400w',
    videoUrl: 'https://video.infini.wtf/uuidOne123/original.mp4',
    isVideo: true,
    isGif: true,
    downloadUrl: 'https://infini.wtf/download/uuidOne123?is_animated=true',
    permalink: 'https://www.reddit.com/r/pixelart/comments/1gylby2/sweet_cone/',
    subreddit: 'pixelart',
    postId: '1gylby2',
    viewId: 'sweet-cone-uuidOne123'
  });

  assert.equal(parsed.items[1].title, 'Second > Item');
  assert.equal(parsed.items[1].isVideo, false);
  assert.equal(parsed.items[1].viewId, 'second-item-uuidTwo456');
});

test('parseSuggestions parses JSON and HTML suggestions and deduplicates against active query', () => {
  const M = loadModel();
  assert.deepEqual(
    JSON.parse(JSON.stringify(M.parseSuggestions(JSON.stringify(['ice cream', 'gelato cone', 'Soft Serve']), 'ice cream'))),
    [
      { label: 'gelato cone', slug: 'gelato-cone' },
      { label: 'Soft Serve', slug: 'soft-serve' }
    ]
  );

  const html = '<a href="/search/ice-cream">Ice Cream</a><a href="/search/neon-art">Neon Art</a>';
  assert.deepEqual(
    JSON.parse(JSON.stringify(M.parseSuggestions(html, 'ice cream'))),
    [{ label: 'Neon Art', slug: 'neon-art' }]
  );
});

test('searchScopeFromUrl, parseVisualUrl, stripVisualParams, and buildVisualUrl round-trip cleanly', () => {
  const M = loadModel();
  assert.deepEqual(JSON.parse(JSON.stringify(M.searchScopeFromUrl('https://www.reddit.com/r/pics/search/?q=sunset&type=media'))), {
    surface: 'subreddit',
    path: '/r/pics/search/',
    name: 'pics'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(M.searchScopeFromUrl('https://www.reddit.com/user/Alex_1/search/?q=cats'))), {
    surface: 'user',
    path: '/user/Alex_1/search/',
    username: 'Alex_1'
  });

  const built = M.buildVisualUrl('https://www.reddit.com/r/pics/search/?q=ice+cream&type=media&cId=abc&iId=def', {
    filters: { nsfw: true, gay: true, trans: true, mediaType: 'images', time: 'year' },
    cleanNav: true
  });
  assert.equal(built.searchParams.get('rt_visual'), '1');
  assert.equal(built.searchParams.get('rt_vnsfw'), '1');
  assert.equal(built.searchParams.get('rt_vmedia'), 'images');
  assert.equal(built.searchParams.get('rt_vtime'), 'year');
  assert.equal(built.searchParams.has('cId'), false);
  assert.equal(built.searchParams.has('gay'), false);
  assert.equal(built.searchParams.has('trans'), false);

  const parsed = M.parseVisualUrl(built.href);
  assert.equal(parsed.active, true);
  assert.equal(parsed.kind, 'search');
  assert.equal(parsed.target, 'ice-cream');
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.filters)), { nsfw: true, mediaType: 'images', time: 'year' });

  const stripped = M.stripVisualParams(built);
  assert.equal(stripped.searchParams.has('rt_visual'), false);
  assert.equal(stripped.searchParams.has('rt_vnsfw'), false);
  assert.equal(stripped.searchParams.get('type'), 'media');
  assert.equal(stripped.searchParams.get('q'), 'ice cream');
});
