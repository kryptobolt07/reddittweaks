const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

function preview(t) {
  const dir = path.join(__dirname, '../demo/prototype');
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  const dom = new JSDOM(html, {url:'https://synthetic.invalid/preview/', runScripts:'outside-only'});
  t.after(() => dom.window.close());
  const w = dom.window, d = w.document;
  let clock = 0, nextId = 0;
  const timers = new Map();
  w.setTimeout = (fn, delay = 0) => { const id = ++nextId; timers.set(id, {fn, at:clock + delay}); return id; };
  w.clearTimeout = id => timers.delete(id);
  w.requestAnimationFrame = fn => w.setTimeout(fn, 0);
  w.cancelAnimationFrame = w.clearTimeout;
  w.HTMLElement.prototype.scrollIntoView = function() {};
  w.HTMLDialogElement.prototype.showModal = function() { this.open = true; };
  w.HTMLDialogElement.prototype.close = function() { this.open = false; };
  // A thrown network call makes an accidental integration with live data fail this suite.
  w.fetch = () => { throw new Error('Synthetic preview must not fetch'); };
  w.XMLHttpRequest = function() { throw new Error('Synthetic preview must not use XHR'); };
  w.eval(fs.readFileSync(path.join(dir, 'model.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(dir, 'app.js'), 'utf8'));
  function tick(ms) {
    const end = clock + ms;
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
      if (!due) break;
      clock = due[1].at; timers.delete(due[0]); due[1].fn();
    }
    clock = end;
  }
  const find = selector => { const el = d.querySelector(selector); assert.ok(el, `Missing ${selector}`); return el; };
  const click = selector => find(selector).click();
  const input = find('#search-input');
  const type = query => { input.value = query; input.dispatchEvent(new w.Event('input', {bubbles:true})); };
  const key = (name, target = input) => target.dispatchEvent(new w.KeyboardEvent('keydown', {key:name, bubbles:true, cancelable:true}));
  const search = query => { type(query); tick(180); };
  return {w,d,find,click,input,type,key,tick,search,state:w.ChatPrototype.state,model:w.ChatPrototypeModel};
}

test('one search field debounces by 180ms and reveals counted scopes on focus', t => {
  const p = preview(t);
  assert.equal(p.d.querySelectorAll('input[type="search"]').length, 1);
  assert.equal(p.find('#scope-tabs').hidden, true);
  p.input.focus();
  assert.equal(p.find('#scope-tabs').hidden, false);
  const initialResults = p.state.results;
  p.type('coffee'); p.tick(179);
  assert.equal(p.state.results, initialResults);
  p.type('coffee tomorrow'); p.tick(179);
  assert.equal(p.state.results, initialResults);
  p.tick(1);
  assert.ok(p.state.results.messages.length > 0);
  assert.ok(p.state.results.messages.every(m => /coffee/i.test(m.text) && /tomorrow/i.test(m.text)));
  assert.match(p.find('[data-scope="messages"]').textContent, /Messages\s+\d/);
});

test('scope tabs, filters, operators and whole words compose in the real UI', t => {
  const p = preview(t);
  p.input.focus(); p.search('coffee');
  assert.ok(p.state.results.people.length > 0);
  p.click('[data-scope="messages"]');
  assert.equal(p.d.querySelectorAll('.chat-result').length, 0);
  p.click('#filter-control'); p.click('[data-menu="filter"][data-value="groups"]');
  assert.ok(p.state.results.messages.length > 0);
  assert.ok(p.state.results.messages.every(m => m.chat.type === 'group'));
  p.click('#from-control'); p.click('[data-menu="from"][data-value="me"]');
  assert.ok(p.state.results.messages.every(m => m.sender === 'me'));
  p.search('from:them has:link');
  assert.equal(p.state.results.messages.length, 0);
  p.click('[data-remove="from"]');
  assert.ok(p.state.results.messages.length > 0);
  assert.ok(p.state.results.messages.every(m => m.sender === 'them' && /https?:/.test(m.text)));
  p.click('[data-remove="filter"]'); p.search('coff');
  assert.ok(p.state.results.messages.length > 0);
  assert.equal(p.find('#word-control').hidden, false);
  p.click('#word-control');
  assert.equal(p.state.results.messages.length, 0);
  assert.equal(p.find('#word-control').getAttribute('aria-pressed'), 'true');
});

test('arrow navigation opens highlighted message and can reopen after returning', t => {
  const p = preview(t);
  p.input.focus(); p.click('[data-scope="messages"]'); p.search('"coffee tomorrow"');
  p.key('ArrowDown');
  assert.ok(p.state.keyboard.startsWith('message:'));
  assert.equal(p.find('.keyboard-focus').id, p.input.getAttribute('aria-activedescendant'));
  p.key('Enter'); p.tick(0);
  assert.equal(p.find('#chat-shell').classList.contains('show-room'), true);
  assert.equal(p.d.querySelectorAll('.jump-highlight').length, 1);
  const opened = p.state.jump;
  p.click('#back-to-results');
  assert.equal(p.find('#chat-shell').classList.contains('show-room'), false);
  p.key('Enter');
  assert.equal(p.state.jump, opened);
  assert.equal(p.find('#chat-shell').classList.contains('show-room'), true);
  p.click('#back-to-results'); p.key('Escape');
  assert.equal(p.input.value, '');
  assert.equal(p.input.hasAttribute('aria-activedescendant'), false);
});

test('group expansion, context and message clicks expose same-chat surroundings', t => {
  const p = preview(t);
  p.input.focus(); p.click('[data-scope="messages"]'); p.search('coffee');
  const group = p.find('.message-group');
  const chatId = group.querySelector('[data-expand]').dataset.expand;
  p.click(`[data-expand="${chatId}"]`);
  assert.ok(p.state.expanded.has(chatId));
  assert.ok(p.state.items.filter(item => item.kind === 'message').length > 1);
  assert.ok(p.d.querySelectorAll('.message-result').length > 1);
  const id = p.find('[data-context]').dataset.context;
  p.click(`[data-context="${id}"]`);
  assert.equal(p.find(`[data-context="${id}"]`).getAttribute('aria-expanded'), 'true');
  assert.match(p.find('.message-context').textContent, /Previous/);
  assert.match(p.find('.message-context').textContent, /Next/);
  const context = p.model.context(id);
  assert.ok(p.find('.message-context').textContent.includes(context.previous.text));
  p.click(`[data-open-message="${id}"]`);
  assert.equal(p.state.jump, id);
  assert.ok(p.find(`#timeline-${id}`).classList.contains('jump-highlight'));
});

test('between dates select start and exclusive end within the same calendar, then clear', t => {
  const p = preview(t);
  p.click('#date-control');
  p.click('[data-date-mode="between"]');
  p.click('[data-date="2026-10-01"]');
  assert.equal(p.find('#search-popover').hidden, false);
  assert.match(p.find('.calendar-hint').textContent, /end date/);
  p.click('[data-date="2026-10-11"]');
  assert.equal(p.find('#search-popover').hidden, true);
  assert.equal(p.state.after, '2026-10-01'); assert.equal(p.state.before, '2026-10-11');
  assert.ok(p.state.results.messages.length > 0);
  assert.ok(p.state.results.messages.every(m => m.at >= new Date(2026,9,1).getTime() && m.at < new Date(2026,9,11).getTime()));
  p.click('#date-control'); p.click('.calendar-clear');
  assert.equal(p.state.after, ''); assert.equal(p.state.before, '');
  assert.equal(p.find('#active-filters').hidden, true);
});

test('minimized search restores floating mode and preserves query across layouts', t => {
  const p = preview(t);
  p.search('coffee'); p.click('#minimize-chat');
  assert.equal(p.state.layout, 'minimized');
  assert.ok(p.find('#chat-shell').classList.contains('minimized'));
  assert.match(p.find('.minimized-count').textContent, /\d+ unread/);
  p.click('#minimized-search');
  assert.equal(p.state.layout, 'floating');
  assert.equal(p.d.activeElement, p.input); assert.equal(p.input.value, 'coffee');
  p.click('[data-layout="full"]');
  assert.equal(p.state.layout, 'full');
  p.click('#minimize-chat'); p.key('/', p.d.body);
  assert.equal(p.state.layout, 'floating'); assert.equal(p.d.activeElement, p.input);
});

test('all saved messages stay searchable while only a small window of results is mounted', t => {
  const p = preview(t);
  p.input.focus(); p.click('[data-scope="messages"]');
  assert.equal(p.state.results.messages.length, p.model.messages.length);
  assert.ok(p.model.messages.length >= 1800);
  assert.ok(p.d.querySelectorAll('.message-result').length < 20);
  assert.ok(p.state.items.length > p.d.querySelectorAll('.virtual-item').length);
  p.key('ArrowDown');
  assert.ok(p.input.hasAttribute('aria-activedescendant'));
  const first = p.find('.message-group').dataset.key;
  const viewport = p.find('#search-results');
  viewport.scrollTop = Math.max(0, p.state.totalHeight - 600);
  viewport.dispatchEvent(new p.w.Event('scroll')); p.tick(0);
  assert.notEqual(p.find('.message-group').dataset.key, first);
  assert.equal(p.input.hasAttribute('aria-activedescendant'), false);
  assert.ok(p.d.querySelectorAll('.message-result').length < 20);
  assert.match(p.find('.virtual-spacer').getAttribute('style'), /height:[1-9]\d*px/);
});

test('empty/loading states, coverage explanation and icon controls communicate usable actions', t => {
  const p = preview(t);
  p.search('zzzz-no-synthetic-message');
  assert.match(p.find('.empty-state').textContent, /Try a different/);
  p.click('#from-control'); p.click('[data-menu="from"][data-value="me"]');
  assert.match(p.find('.empty-state').textContent, /removing a filter/);
  p.click('[data-clear-filters]');
  assert.equal(p.state.from, 'all');
  p.click('#refresh-results');
  assert.ok(p.find('.skeleton-list')); assert.equal(p.find('#refresh-results').disabled, true);
  p.tick(700);
  assert.equal(p.d.querySelector('.skeleton-list'), null);
  assert.equal(p.find('#refresh-results').disabled, false);
  assert.match(p.find('.coverage-footer').textContent, /History may be incomplete/);
  p.click('#learn-why'); assert.equal(p.find('#coverage-dialog').open, true);
  p.click('#close-help'); assert.equal(p.find('#coverage-dialog').open, false);
  for (const button of p.d.querySelectorAll('.icon-button')) {
    assert.ok(button.getAttribute('aria-label')?.trim(), `Icon button ${button.id} needs an accessible name`);
    assert.ok(button.getAttribute('title')?.trim(), `Icon button ${button.id} needs a tooltip`);
  }
  p.click('#theme-toggle');
  assert.ok(p.d.body.classList.contains('dark'));
  assert.equal(p.find('#theme-toggle').getAttribute('aria-label'), 'Switch to light theme');
  p.click('#theme-toggle'); assert.equal(p.d.body.classList.contains('dark'), false);
});

test('query edits reset keyboard selection and recent searches can be reused and removed', t => {
  const p = preview(t);
  p.input.focus(); p.search('coffee'); p.key('ArrowDown');
  assert.ok(p.input.getAttribute('aria-activedescendant'));
  p.search('tomorrow');
  assert.equal(p.state.keyboard, '');
  assert.equal(p.input.hasAttribute('aria-activedescendant'), false);
  p.key('ArrowDown'); p.key('Enter'); p.click('#back-to-results'); p.key('Escape');
  assert.ok(p.find('[data-recent="tomorrow"]'));
  p.click('[data-recent="tomorrow"]');
  assert.equal(p.input.value, 'tomorrow'); assert.ok(p.state.results.messages.length > 0);
  p.key('Escape'); p.click('[data-delete-recent="tomorrow"]');
  assert.equal(p.d.querySelector('[data-recent="tomorrow"]'), null);
  assert.equal(p.w.localStorage.getItem('rcs-design-preview:recent'), '[]');
});

test('menus offer radio semantics, keyboard traversal and Escape dismissal', t => {
  const p = preview(t);
  p.click('#sort-control');
  const menu = p.find('#search-popover');
  assert.equal(menu.getAttribute('role'), 'menu');
  assert.equal(p.find('[data-value="newest"]').getAttribute('aria-checked'), 'true');
  p.key('ArrowDown', p.d.body);
  assert.equal(p.d.activeElement, p.find('[data-value="newest"]'));
  p.key('ArrowDown', p.d.activeElement);
  assert.equal(p.d.activeElement, p.find('[data-value="oldest"]'));
  p.click('[data-value="oldest"]');
  assert.equal(p.state.sort, 'oldest');
  assert.equal(p.d.activeElement, p.find('#sort-control'));
  p.click('#sort-control'); p.key('Escape', p.d.activeElement);
  assert.equal(menu.hidden, true);
});

test('search this conversation includes both senders and exposes a removable conversation filter', t => {
  const p = preview(t);
  p.click('[data-open-chat="rkt"]'); p.click('#room-search');
  assert.equal(p.state.scope, 'messages');
  assert.equal(p.state.chatId, 'rkt');
  const expected = p.model.messages.filter(m => m.chatId === 'rkt');
  assert.equal(p.state.results.messages.length, expected.length);
  assert.ok(p.state.results.messages.some(m => m.sender === 'me'));
  assert.ok(p.state.results.messages.some(m => m.sender === 'them'));
  assert.ok(p.state.results.messages.every(m => m.chatId === 'rkt'));
  p.click('[data-remove="chat"]');
  assert.equal(p.state.chatId, '');
  assert.equal(p.state.results.messages.length, p.model.messages.length);
});
