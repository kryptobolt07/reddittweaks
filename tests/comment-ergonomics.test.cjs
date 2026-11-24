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
  assert.match(classicCss, /shreddit-comment\[depth="0"\] > details > \.comment-main-grid\{--thread-color:#ff4500;/);
  assert.match(classicCss, /shreddit-comment\[depth="0"\]:not\(:has\(> details\)\)\{--color-tone-4:#ff4500;/);
  assert.doesNotMatch(classicCss, /shreddit-comment\[depth="0"\]\{--color-tone-4:/, 'never overwrite --color-tone-4 on live details comments so flairs keep Reddit colors');
  assert.match(classicCss, /shreddit-comment\[depth="15"\]/);
  const cvdCss = M.buildThreadlineCss('classic', true);
  assert.match(cvdCss, /> \.comment-main-grid\{--thread-color:#e69f00;/);

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

test('AutoMod & child collapse control native <details open>, restore on toggle-off, keep legacy fallback, and respect permalinks', async t => {
  const detailsHtml = `
    <shreddit-comment id="am" thingid="t1_am1" depth="0" author="AutoModerator">
      <details open>
        <summary><div slot="commentMeta"><span>AutoModerator</span></div></summary>
        <div class="comment-main-grid"><div slot="comment"><p>Welcome to our weekly megathread, please read the full rules carefully before posting links.</p></div></div>
      </details>
    </shreddit-comment>
    <shreddit-comment id="r0" thingid="t1_r0" depth="0" author="User1">
      <details open>
        <summary><div slot="commentMeta">User1</div></summary>
        <div class="comment-main-grid">
          <div id="comment-children">
            <shreddit-comment id="r1" thingid="t1_r1" depth="1" author="User2">
              <details open><summary>User2</summary><div slot="comment"><p>Child reply</p></div></details>
            </shreddit-comment>
            <shreddit-comment id="r1closed" thingid="t1_r1c" depth="1" author="User3">
              <details><summary>User3</summary><div slot="comment"><p>Already collapsed</p></div></details>
            </shreddit-comment>
          </div>
        </div>
      </details>
    </shreddit-comment>`;

  const s1 = setupPage(t, { html: detailsHtml, settings: { collapseAutoMod: true, collapseChildComments: true } });
  await s1.ctrl.ready;

  const am = s1.D.getElementById('am');
  const amDetails = am.querySelector(':scope > details');
  assert.equal(amDetails.open, false);
  assert.equal(amDetails.hasAttribute('open'), false);
  const preview = am.querySelector('[data-rt-automod-preview]');
  assert.ok(preview);
  assert.ok(preview.textContent.length <= 63);
  assert.match(preview.textContent, /Welcome to our weekly megathread/);

  // Expanding AutoMod <details> removes the preview snippet via toggle event and stays open across rescans.
  amDetails.open = true;
  amDetails.setAttribute('open', '');
  amDetails.dispatchEvent(new s1.W.Event('toggle'));
  assert.equal(am.querySelector('[data-rt-automod-preview]'), null);
  s1.ctrl.scanDocument();
  assert.equal(amDetails.open, true, 'user manual expand is preserved');

  assert.equal(s1.D.getElementById('r0').querySelector(':scope > details').open, true, 'top-level comment remains expanded');
  const r1Details = s1.D.getElementById('r1').querySelector(':scope > details');
  const r1ClosedDetails = s1.D.getElementById('r1closed').querySelector(':scope > details');
  assert.equal(r1Details.open, false, 'depth=1 child reply collapsed via <details>');
  assert.equal(r1ClosedDetails.open, false);

  // Same-URL reddit:route / pageshow after collapse must not clear childAutoCollapsed.
  s1.D.dispatchEvent(new s1.W.CustomEvent('reddit:route'));
  const ps = new s1.W.Event('pageshow');
  ps.persisted = false;
  s1.W.dispatchEvent(ps);

  // Turning collapseChildComments OFF restores comments we auto-collapsed, without expanding originally-closed ones.
  s1.ctrl.configure({ collapseAutoMod: true, collapseChildComments: false });
  assert.equal(r1Details.open, true, 'auto-collapsed child restores open when toggled off even after same-URL route/pageshow');
  assert.equal(r1ClosedDetails.open, false, 'originally-closed child stays closed');

  // Legacy non-<details> fallback still works when <shreddit-comment> uses collapsed attribute directly.
  const legacyHtml = `
    <shreddit-comment id="lam" thingid="t1_lam" depth="0" author="AutoModerator">
      <div slot="commentMeta"><span>AutoModerator</span></div>
      <div slot="comment"><p>Legacy rule notice</p></div>
    </shreddit-comment>
    <shreddit-comment id="lr1" thingid="t1_lr1" depth="1" author="User2"><p>Legacy child</p></shreddit-comment>`;
  const sLegacy = setupPage(t, { html: legacyHtml, settings: { collapseAutoMod: true, collapseChildComments: true } });
  await sLegacy.ctrl.ready;
  assert.equal(sLegacy.D.getElementById('lam').hasAttribute('collapsed'), true);
  assert.equal(sLegacy.D.getElementById('lr1').hasAttribute('collapsed'), true);

  // Direct comment permalink skips both child collapse and permalink AutoMod collapse.
  const s2 = setupPage(t, { url: 'https://www.reddit.com/r/pics/comments/abc12/post/am1/', html: detailsHtml, settings: { collapseAutoMod: true, collapseChildComments: true } });
  await s2.ctrl.ready;
  assert.equal(s2.D.getElementById('am').querySelector(':scope > details').open, true, 'direct permalink target is never collapsed');
  assert.equal(s2.D.getElementById('r1').querySelector(':scope > details').open, true, 'comment permalink bypasses child collapse');
});

test('Auto-load more comments skips invisible/loading buttons, respects closed details and cooldowns, and pumps live toggles', async t => {
  const html = `
    <shreddit-comment-tree>
      <shreddit-comment id="c0" depth="0">
        <details id="d0" open>
          <faceplate-partial src="/svc/shreddit/more-comments/r/pics/t3_abc?startingDepth=1">
            <button id="nested-vis" type="button">3 more replies</button>
            <span class="invisible"><button id="nested-inv" type="button">3 more replies</button></span>
            <span slot="loading"><button id="nested-spin" type="button" aria-label="Loading"></button></span>
          </faceplate-partial>
          <shreddit-comment id="c1" depth="1">
            <details id="d1">
              <faceplate-partial src="/svc/shreddit/more-comments/r/pics/t3_abc?startingDepth=2">
                <button id="hidden-in-closed" type="button">1 more reply</button>
              </faceplate-partial>
            </details>
          </shreddit-comment>
        </details>
      </shreddit-comment>
      <faceplate-partial id="p-top1" src="/svc/shreddit/more-comments/r/pics/t3_abc?top-level=1">
        <div><button id="top1-vis" type="button">View more comments</button></div>
        <div class="invisible"><button id="top1-inv" type="button">View more comments</button></div>
      </faceplate-partial>
      <faceplate-partial id="p-top2" src="/svc/shreddit/more-comments/r/pics/t3_abc?top-level=1">
        <button id="top2-vis" type="button">View more comments</button>
      </faceplate-partial>
    </shreddit-comment-tree>`;
  const { W, D, ctrl, io, intersect } = setupPage(t, { html, settings: { autoLoadMoreComments: true, collapseChildComments: true } });
  const clicked = [];
  for (const btn of D.querySelectorAll('button')) {
    btn.addEventListener('click', () => clicked.push(btn.id));
  }
  await ctrl.ready;

  // Invisible / loading / closed-details buttons must not even be observed.
  assert.equal(io.observed.has(D.getElementById('top1-inv')), false, 'never observes .invisible duplicate button');
  assert.equal(io.observed.has(D.getElementById('nested-inv')), false);
  assert.equal(io.observed.has(D.getElementById('nested-spin')), false, 'never observes aria-label="Loading" spinner button');
  assert.equal(io.observed.has(D.getElementById('hidden-in-closed')), false, 'never observes loader inside closed <details>');

  intersect([
    D.getElementById('nested-vis'),
    D.getElementById('nested-inv'),
    D.getElementById('top1-inv'),
    D.getElementById('top1-vis'),
    D.getElementById('top2-vis')
  ], true);
  assert.deepEqual(clicked, ['top1-vis'], 'clicks visible top loader only; nested skipped under collapseChildComments; second waits 900ms');
  await new Promise(resolve => setTimeout(resolve, 950));
  assert.deepEqual(clicked, ['top1-vis', 'top2-vis'], 'second top loader fires after 900ms cooldown');

  // Mock in-viewport geometry on nested-vis, then toggle collapseChildComments OFF live:
  // it must immediately pump nested-vis after cooldown without requiring a new scroll.
  const nestedBtn = D.getElementById('nested-vis');
  nestedBtn.getBoundingClientRect = () => ({ top: 200, bottom: 232, width: 107, height: 32 });
  await new Promise(resolve => setTimeout(resolve, 950));
  ctrl.configure({ autoLoadMoreComments: true, collapseChildComments: false });
  assert.deepEqual(clicked, ['top1-vis', 'top2-vis', 'nested-vis'], 'toggling collapseChildComments OFF immediately loads visible nested replies');

  // Expanding a previously-closed <details> reveals and triggers its nested loader once cooled down.
  const hiddenBtn = D.getElementById('hidden-in-closed');
  hiddenBtn.getBoundingClientRect = () => ({ top: 260, bottom: 292, width: 95, height: 32 });
  await new Promise(resolve => setTimeout(resolve, 950));
  const d1 = D.getElementById('d1');
  d1.open = true;
  d1.setAttribute('open', '');
  d1.dispatchEvent(new W.Event('toggle'));
  assert.deepEqual(clicked, ['top1-vis', 'top2-vis', 'nested-vis', 'hidden-in-closed']);
});

test('Better comment composer opens light and shadow reddit-rte toolbars, submits via Ctrl/Cmd+Enter, and keeps session drafts', async t => {
  const html = `
    <shreddit-composer id="legacy-comp">
      <button id="fmt" type="button" aria-label="Show formatting options" aria-expanded="false"></button>
      <textarea id="draft-field"></textarea>
      <button id="submit" type="submit">Comment</button>
    </shreddit-composer>`;
  const { W, D, ctrl } = setupPage(t, { url: 'https://www.reddit.com/r/pics/comments/post9/title/', html, settings: { betterComposer: true } });
  let fmtOpens = 0;
  const fmt = D.getElementById('fmt');
  fmt.addEventListener('click', () => { fmtOpens++; fmt.setAttribute('aria-expanded', 'true'); });

  await ctrl.ready;
  assert.equal(fmtOpens, 1, 'opens formatting toolbar automatically once');

  const field = D.getElementById('draft-field');
  field.value = 'Work in progress reply';
  field.dispatchEvent(new W.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(W.sessionStorage.getItem('rt-comment-draft:post9'), 'Work in progress reply');

  // Re-mounting a live Shreddit <shreddit-composer> with shadow <reddit-rte> + hidden <rte-toolbar>
  D.body.innerHTML = `<shreddit-composer id="rte-comp"><div slot="rte" contenteditable="true" id="rte-edit"></div><button id="submit2" type="submit">Comment</button></shreddit-composer>`;
  const rteComp = D.getElementById('rte-comp');
  const compShadow = rteComp.attachShadow({ mode: 'open' });
  const rte = D.createElement('reddit-rte');
  const rteShadow = rte.attachShadow({ mode: 'open' });
  const bar = D.createElement('rte-toolbar');
  bar.className = 'toolbar-top-responsive order-1 hidden';
  rteShadow.append(bar);
  compShadow.append(rte);

  ctrl.scanDocument();
  assert.equal(D.getElementById('rte-edit').textContent, 'Work in progress reply', 'restores draft into contenteditable slot');
  assert.equal(bar.classList.contains('hidden'), false, 'unhides reddit-rte shadow formatting toolbar once');

  // If user manually hides the toolbar again, focusin respects their choice.
  bar.classList.add('hidden');
  D.getElementById('rte-edit').dispatchEvent(new W.Event('focusin', { bubbles: true }));
  assert.equal(bar.classList.contains('hidden'), true, 'never re-opens a toolbar the user closed');

  // Cmd+Enter inside reddit-rte shadow root submits and clears draft.
  let sub2 = 0;
  D.getElementById('submit2').addEventListener('click', () => sub2++);
  rteShadow.dispatchEvent(new W.KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
  assert.equal(sub2, 1);
  assert.equal(W.sessionStorage.getItem('rt-comment-draft:post9'), null, 'draft cleared after submit');

  // Delayed Shadow DOM upgrade after document_idle still gets toolbar unhidden within bounded retries.
  D.body.innerHTML = `<shreddit-composer id="late-comp"><div slot="rte" contenteditable="true" id="late-edit"></div></shreddit-composer>`;
  ctrl.scanDocument();
  await new Promise(resolve => setTimeout(resolve, 100));
  const lateComp = D.getElementById('late-comp');
  const lateCompShadow = lateComp.attachShadow({ mode: 'open' });
  const lateRte = D.createElement('reddit-rte');
  const lateRteShadow = lateRte.attachShadow({ mode: 'open' });
  const lateBar = D.createElement('rte-toolbar');
  lateBar.className = 'toolbar-top-responsive order-1 hidden';
  lateRteShadow.append(lateBar);
  lateCompShadow.append(lateRte);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(lateBar.classList.contains('hidden'), false, 'delayed shadow upgrade still unhides rte-toolbar automatically');
});
