const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const postModelSrc = fs.readFileSync(path.join(__dirname, '../extension/post-model.js'), 'utf8');
const coreSrc = fs.readFileSync(path.join(__dirname, '../extension/rt-core.js'), 'utf8');
const modelSrc = fs.readFileSync(path.join(__dirname, '../extension/comment-ergonomics-model.js'), 'utf8');
const ctrlSrc = fs.readFileSync(path.join(__dirname, '../extension/comment-ergonomics.js'), 'utf8');
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function setupPage(t, { url = 'https://www.reddit.com/r/pics/comments/abc12/demo_post/', html = '<main></main>', settings = {} } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body>' + html + '</body></html>', { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const W = dom.window;

  const ioRecords = { callback: null, observed: new Set() };
  W.IntersectionObserver = class {
    constructor(cb, opts) { ioRecords.callback = cb; ioRecords.opts = opts; }
    observe(el) { ioRecords.observed.add(el); }
    unobserve(el) { ioRecords.observed.delete(el); }
    disconnect() { ioRecords.observed.clear(); }
  };

  let scrollYVal = 0;
  const scrollCalls = [];
  Object.defineProperty(W, 'scrollY', { configurable: true, get: () => scrollYVal, set: v => { scrollYVal = v; } });
  W.scrollTo = opts => {
    scrollCalls.push(opts);
    if (typeof opts?.top === 'number') scrollYVal = opts.top;
  };
  W.matchMedia = () => ({ matches: false });

  W.__rtCommentErgonomicsTest = true;
  W.eval(postModelSrc);
  W.eval(coreSrc);
  W.eval(modelSrc);
  W.eval(ctrlSrc);

  const ctrl = new W.RTCommentErgonomics.Controller({
    win: W,
    doc: W.document,
    readSettings: async () => settings,
    observe: false
  });
  t.after(() => {
    ctrl.destroy();
    W.close();
  });

  return {
    W,
    D: W.document,
    M: W.RTCommentErgonomicsModel,
    ctrl,
    io: ioRecords,
    scrollCalls,
    setScrollY(v) { scrollYVal = v; W.dispatchEvent(new W.Event('scroll')); },
    intersect(targets, isIntersecting = true) {
      ioRecords.callback?.(targets.map(target => ({ target, isIntersecting })));
    }
  };
}

test('comment-ergonomics-model validates threadlines, permalinks, AutoMod bots, snippets, and jump targets', t => {
  const { W, D, M } = setupPage(t);
  assert.equal(M.buildThreadlineCss('off'), '');
  const classicCss = M.buildThreadlineCss('classic', false);
  assert.match(classicCss, /shreddit-comment\[depth="0"\]\{--color-tone-4:#ff4500;/);
  assert.match(classicCss, /shreddit-comment\[depth="15"\]/);
  const cvdCss = M.buildThreadlineCss('classic', true);
  assert.match(cvdCss, /--color-tone-4:#e69f00;/);

  assert.equal(M.isPostPage('/r/pics/comments/abc12/my_post/'), true);
  assert.equal(M.isPostPage('/user/Someone/comments/'), false);
  assert.equal(M.postIdOf('/r/pics/comments/ABC12/title/'), 'abc12');
  assert.equal(M.draftKey('/r/pics/comments/ABC12/title/'), 'rt-comment-draft:abc12');

  assert.equal(M.isCommentPermalink('/r/pics/comments/abc12/my_post/'), false);
  assert.equal(M.isCommentPermalink('/comments/abc12/'), false);
  assert.equal(M.isCommentPermalink('/r/pics/comments/abc12/my_post/def34/'), true);
  assert.equal(M.isCommentPermalink('/comments/abc12/comment/def34/'), true);
  assert.equal(M.isCommentPermalink('/r/pics/comments/abc12/my_post/', '?context=3'), true);
  assert.equal(M.permalinkCommentId('/r/pics/comments/abc12/my_post/DEF34/'), 'def34');

  D.body.innerHTML = `
    <shreddit-comment id="am" depth="0" author="AutoModerator"><p>Rule reminder</p></shreddit-comment>
    <shreddit-comment id="bot" depth="0" author="RemindMeBot" is-pinned></shreddit-comment>
    <shreddit-comment id="humanmod" depth="0" author="RealModerator" is-pinned distinguished="moderator"></shreddit-comment>
    <shreddit-comment id="nestedam" depth="1" author="AutoModerator"></shreddit-comment>`;
  assert.equal(M.isAutoModOrPinnedBot(D.getElementById('am')), true);
  assert.equal(M.isAutoModOrPinnedBot(D.getElementById('bot')), true);
  assert.equal(M.isAutoModOrPinnedBot(D.getElementById('humanmod')), false, 'human mod announcements are not collapsed');
  assert.equal(M.isAutoModOrPinnedBot(D.getElementById('nestedam')), false);

  assert.equal(M.previewSnippet('  Hello   world  ', 60), 'Hello world');
  const clipped = M.previewSnippet('x'.repeat(80), 60);
  assert.equal(clipped.length, 60);
  assert.ok(clipped.endsWith('…'));

  const els = [{ el: 'a', top: 40 }, { el: 'b', top: 180 }, { el: 'c', top: 500 }];
  assert.equal(M.findJumpTarget(els, 60, 1, 12), 'b');
  assert.equal(M.findJumpTarget(els, 180, -1, 12), 'a');
});

test('color-coded threadlines toggle on/off and switch to CVD Okabe-Ito cleanly', async t => {
  const { D, ctrl } = setupPage(t);
  await ctrl.ready;
  assert.equal(D.querySelector('[data-rt-sheet="rt-threadlines"]'), null);
  ctrl.configure({ commentThreadlines: 'autumn', commentThreadlinesCvd: false });
  const sheet = D.querySelector('[data-rt-sheet="rt-threadlines"]');
  assert.ok(sheet);
  assert.match(sheet.textContent, /#c8553d/);
  ctrl.configure({ commentThreadlines: 'autumn', commentThreadlinesCvd: true });
  assert.match(sheet.textContent, /#e69f00/);
  ctrl.configure({ commentThreadlines: 'off' });
  assert.equal(D.querySelector('[data-rt-sheet="rt-threadlines"]'), null);
});

test('Comment Jump pill supports Easy/Pro + Back-to-Top coordination, RTSmoothScroll reveal, shortcuts, and editable auto-hide', async t => {
  const html = `
    <shreddit-comment id="c1" depth="0" data-rt-smooth data-rt-skip><shreddit-comment id="c1a" depth="1"></shreddit-comment><shreddit-comment id="c1b" depth="1"></shreddit-comment></shreddit-comment>
    <shreddit-comment id="c2" depth="0" data-rt-smooth data-rt-skip></shreddit-comment>
    <shreddit-composer><textarea id="reply-box"></textarea></shreddit-composer>`;
  const { W, D, ctrl, scrollCalls, setScrollY } = setupPage(t, { html, settings: { commentJump: 'easy', commentJumpSide: 'left', backToTop: true } });
  let revealed = [];
  W.RTSmoothScroll = {
    reveal(el) { revealed.push(el.id); el.removeAttribute('data-rt-skip'); return true; }
  };
  await ctrl.ready;

  const pill = D.querySelector('[data-rt-ui="comment-jump"]');
  assert.ok(pill);
  assert.equal(pill.hidden, false);
  assert.equal(pill.dataset.side, 'left');
  assert.equal(pill.querySelector('[data-rt-jump-action="prev-sibling"]').hidden, true);
  assert.equal(pill.querySelector('[data-rt-jump-action="top"]').hidden, true, 'Back-to-Top hides when scrollY <= 300');

  setScrollY(500);
  assert.equal(pill.querySelector('[data-rt-jump-action="top"]').hidden, false);
  assert.equal(pill.querySelector('.rt-jump-sep').hidden, false, 'separator shows when both Comment Jump and Back-to-Top are active');

  // Set mock geometry so headerOffset = 60, c1 at 30, c2 at 400, c1b at 250.
  D.documentElement.style.setProperty('--rt-visible-header-height', '60px');
  D.getElementById('c1').getBoundingClientRect = () => ({ top: 30, height: 100 });
  D.getElementById('c1a').getBoundingClientRect = () => ({ top: 65, height: 60 });
  D.getElementById('c1b').getBoundingClientRect = () => ({ top: 250, height: 60 });
  D.getElementById('c2').getBoundingClientRect = () => ({ top: 400, height: 120 });

  // Next root jumps to c2, calling RTSmoothScroll.reveal before scrollTo.
  pill.querySelector('[data-rt-jump-action="next-root"]').click();
  assert.deepEqual(revealed, ['c2']);
  assert.equal(D.getElementById('c2').hasAttribute('data-rt-skip'), false);
  assert.equal(scrollCalls.at(-1).top, 500 + 400 - 60 - 8);

  // Switch to Pro mode and test Shift+J sibling jump + suppression inside textarea.
  ctrl.configure({ commentJump: 'pro', backToTop: true });
  assert.equal(pill.querySelector('[data-rt-jump-action="next-sibling"]').hidden, false);
  D.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'J', shiftKey: true, bubbles: true, cancelable: true }));
  // With c1a anchored right below header (<= 60 + 24 = 84), next sibling is c1b!
  assert.equal(scrollCalls.at(-1).top, (500 + 400 - 60 - 8) + 250 - 60 - 8);

  // Focusing textarea hides pill and blocks J/K shortcuts.
  const countBefore = scrollCalls.length;
  const ta = D.getElementById('reply-box');
  ta.focus();
  assert.equal(pill.getAttribute('data-rt-jump-hidden'), 'true');
  D.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true }));
  assert.equal(scrollCalls.length, countBefore, 'shortcuts suppressed while typing');
  ta.blur();
  assert.equal(pill.hasAttribute('data-rt-jump-hidden'), false);

  // Feed page with commentJump=pro + backToTop=true shows ONLY Back-to-Top once scrolled.
  W.history.pushState({}, '', '/');
  D.dispatchEvent(new W.Event('reddit:route'));
  assert.equal(pill.querySelector('[data-rt-jump-action="next-root"]').hidden, true);
  assert.equal(pill.querySelector('[data-rt-jump-action="top"]').hidden, false);
});

test('AutoMod collapse shows 60-char snippet, removes on expand, and child collapse respects permalinks', async t => {
  const html = `
    <shreddit-comment id="am" thingid="t1_am1" depth="0" author="AutoModerator">
      <div slot="commentMeta"><span>AutoModerator</span></div>
      <div slot="comment"><p>Welcome to our weekly megathread, please read the full rules carefully before posting links.</p></div>
    </shreddit-comment>
    <shreddit-comment id="r0" thingid="t1_r0" depth="0" author="User1">
      <shreddit-comment id="r1" thingid="t1_r1" depth="1" author="User2"></shreddit-comment>
    </shreddit-comment>`;

  const s1 = setupPage(t, { html, settings: { collapseAutoMod: true, collapseChildComments: true } });
  await s1.ctrl.ready;

  const am = s1.D.getElementById('am');
  assert.equal(am.hasAttribute('collapsed'), true);
  const preview = am.querySelector('[data-rt-automod-preview]');
  assert.ok(preview);
  assert.ok(preview.textContent.length <= 63);
  assert.match(preview.textContent, /Welcome to our weekly megathread/);

  // Clicking to expand removes preview and does not re-collapse on rescan.
  am.removeAttribute('collapsed');
  am.click();
  await flush();
  assert.equal(am.querySelector('[data-rt-automod-preview]'), null);
  s1.ctrl.scanDocument();
  assert.equal(am.hasAttribute('collapsed'), false, 'user manual expand is preserved');

  assert.equal(s1.D.getElementById('r0').hasAttribute('collapsed'), false, 'top-level comment remains expanded');
  assert.equal(s1.D.getElementById('r1').hasAttribute('collapsed'), true, 'depth=1 child reply collapsed');

  // Direct comment permalink skips both child collapse and permalink AutoMod collapse.
  const s2 = setupPage(t, { url: 'https://www.reddit.com/r/pics/comments/abc12/post/am1/', html, settings: { collapseAutoMod: true, collapseChildComments: true } });
  await s2.ctrl.ready;
  assert.equal(s2.D.getElementById('am').hasAttribute('collapsed'), false, 'direct permalink target is never collapsed');
  assert.equal(s2.D.getElementById('r1').hasAttribute('collapsed'), false, 'comment permalink bypasses child collapse');
});

test('Auto-load more comments enforces 900ms rate limit and skips nested reply loaders when collapseChildComments is active', async t => {
  const html = `
    <shreddit-comment-tree>
      <shreddit-comment depth="0">
        <faceplate-partial src="/svc/shreddit/more-comments/r/pics/t3_abc?startingDepth=1"><button id="nested">3 more replies</button></faceplate-partial>
      </shreddit-comment>
      <faceplate-partial src="/svc/shreddit/more-comments/r/pics/t3_abc?top-level=1"><button id="top1">View more comments</button></faceplate-partial>
      <faceplate-partial src="/svc/shreddit/more-comments/r/pics/t3_abc?top-level=1"><button id="top2">View more comments</button></faceplate-partial>
    </shreddit-comment-tree>`;
  const { D, ctrl, intersect } = setupPage(t, { html, settings: { autoLoadMoreComments: true, collapseChildComments: true } });
  const clicked = [];
  for (const id of ['nested', 'top1', 'top2']) D.getElementById(id).addEventListener('click', () => clicked.push(id));
  await ctrl.ready;

  intersect([D.getElementById('nested'), D.getElementById('top1'), D.getElementById('top2')], true);
  assert.deepEqual(clicked, ['top1'], 'nested skipped under collapseChildComments; second top loader waits for 900ms cooldown');
  await new Promise(resolve => setTimeout(resolve, 950));
  assert.deepEqual(clicked, ['top1', 'top2'], 'second loader fires after 900ms cooldown');
});

test('Better comment composer auto-opens toolbar, submits on Ctrl/Cmd+Enter, and preserves sessionStorage drafts', async t => {
  const html = `
    <shreddit-composer>
      <button id="fmt" type="button" aria-label="Show formatting options" aria-expanded="false"></button>
      <textarea id="draft-field"></textarea>
      <button id="submit" type="submit">Comment</button>
    </shreddit-composer>`;
  const { W, D, ctrl } = setupPage(t, { url: 'https://www.reddit.com/r/pics/comments/post9/title/', html, settings: { betterComposer: true } });
  let fmtOpens = 0, submits = 0;
  const fmt = D.getElementById('fmt');
  fmt.addEventListener('click', () => { fmtOpens++; fmt.setAttribute('aria-expanded', 'true'); });
  D.getElementById('submit').addEventListener('click', () => submits++);

  await ctrl.ready;
  assert.equal(fmtOpens, 1, 'opens formatting toolbar automatically once');

  const field = D.getElementById('draft-field');
  field.value = 'Work in progress reply';
  field.dispatchEvent(new W.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(W.sessionStorage.getItem('rt-comment-draft:post9'), 'Work in progress reply');

  // Re-mounting a fresh composer on the same thread restores the draft into empty field.
  const html2 = '<shreddit-composer><textarea id="draft2"></textarea><button id="submit2" type="submit">Comment</button></shreddit-composer>';
  D.body.innerHTML = html2;
  ctrl.scanDocument();
  assert.equal(D.getElementById('draft2').value, 'Work in progress reply');

  // Cmd+Enter submits and clears draft.
  let sub2 = 0;
  D.getElementById('submit2').addEventListener('click', () => sub2++);
  D.getElementById('draft2').dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
  assert.equal(sub2, 1);
  assert.equal(W.sessionStorage.getItem('rt-comment-draft:post9'), null, 'draft cleared after submit');
});
