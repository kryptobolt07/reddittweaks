const {test} = require('node:test');
const assert = require('node:assert/strict');
const model = require('../demo/prototype/model.js');

test('synthetic prototype has varied history and derives chat previews from latest messages', () => {
  assert.ok(model.chats.length >= 35);
  assert.ok(model.messages.length >= 1500);
  assert.equal(new Set(model.messages.map(item => item.id)).size, model.messages.length);
  assert.ok(model.messages.some(item => model.now - item.at > 365 * 86400000));
  for (const chat of model.chats) {
    const latest = model.messages.filter(item => item.chatId === chat.id).sort((a,b) => b.at-a.at)[0];
    assert.equal(chat.lastAt, latest.at);
    assert.equal(chat.preview, latest.text);
  }
  assert.match(model.avatar(model.chats[0]), /^data:image\/svg\+xml,/);
});

test('parser separates exact phrases, text terms, sender, link and date operators', () => {
  const parsed = model.parseQuery('coffee "quiet place" from:R-K-T after:2026-10-01 before:2026-10-12 has:link');
  assert.deepEqual(parsed.terms, ['coffee']);
  assert.deepEqual(parsed.phrases, ['quiet place']);
  assert.deepEqual(parsed.from, ['r-k-t']);
  assert.deepEqual(parsed.after, ['2026-10-01']);
  assert.deepEqual(parsed.before, ['2026-10-12']);
  assert.equal(parsed.hasLink, true);
  assert.equal(parsed.invalid, false);
  assert.equal(model.parseQuery('before:2026-02-30').invalid, true);
});

test('all operators and UI filters compose with AND; message operators do not match people', () => {
  const result = model.search({query:'from:R-K-T has:link after:2026-10-11 before:2026-10-12', filter:'unread'});
  assert.ok(result.messages.some(item => item.id === 'featured-3'));
  assert.ok(result.messages.every(item => item.chatId === 'rkt' && item.sender === 'them' && /https?:/.test(item.text)));
  assert.equal(result.people.length, 0);
  assert.equal(model.search({query:'from:me', from:'them'}).messages.length, 0);
  assert.equal(model.search({query:'coffee', after:'2026-10-12', before:'2026-10-01'}).messages.length, 0);
  assert.equal(model.search({query:'before:2026-02-30'}).messages.length, 0);
  assert.ok(model.search({filter:'groups'}).messages.every(item => item.chat.type === 'group'));
  assert.ok(model.search({filter:'requests'}).people.every(item => item.type === 'request'));
});

test('date operators include after midnight and exclude before midnight', () => {
  const result = model.search({query:'after:2026-10-10 before:2026-10-11'});
  assert.ok(result.messages.length > 0);
  assert.ok(result.messages.every(item => item.at >= Date.parse('2026-10-10T00:00:00Z') && item.at < Date.parse('2026-10-11T00:00:00Z')));
});

test('text is conjunctive, quotes are exact, and whole-word mode excludes partial words', () => {
  const combined = model.search({query:'coffee tomorrow'}).messages;
  assert.ok(combined.length > 0);
  assert.ok(combined.every(item => /coffee/i.test(item.text) && /tomorrow/i.test(item.text)));
  assert.equal(model.search({query:'"tomorrow coffee"'}).messages.length, 0);
  assert.ok(model.search({query:'"coffee tomorrow"'}).messages.length > 0);
  assert.ok(model.search({query:'coff'}).messages.length > 0);
  assert.equal(model.search({query:'coff', wholeWord:true}).messages.length, 0);
  assert.equal(model.search({query:'deleted', scope:'people'}).people.find(item => item.id === 'historical').name, 'Historical-Tour3674');
  assert.equal(model.search({query:'R-K-T', scope:'people'}).messages.length, 0);
  assert.equal(model.search({scope:'messages'}).people.length, 0);
});

test('ranges are end exclusive and snippets center the first match with adjusted highlights', () => {
  const result = model.search({query:'"perfect coffee spot"'}).messages[0];
  assert.ok(result);
  assert.deepEqual(result.ranges.map(([a,b]) => result.text.slice(a,b)), ['perfect coffee spot']);
  assert.deepEqual(result.snippetRanges.map(([a,b]) => result.snippet.slice(a,b)), ['perfect coffee spot']);
  assert.ok(result.snippet.startsWith('…'));
  assert.ok(result.snippet.endsWith('…'));
  assert.ok(result.snippet.length < result.text.length);
  const repeated = model.search({query:'the'}).messages.find(item => item.ranges.length > 1);
  assert.ok(repeated.ranges.every(([a,b]) => repeated.text.slice(a,b).toLowerCase() === 'the'));
  assert.equal(model.search({query:'the'}).commonWord, true);
});

test('sort orders and grouped results preserve the same filtered message set', () => {
  const newest = model.search({query:'coffee', sort:'newest'});
  const oldest = model.search({query:'coffee', sort:'oldest'});
  assert.deepEqual(newest.messages.map(item => item.id), oldest.messages.map(item => item.id).reverse());
  const relevant = model.search({query:'coffee', sort:'relevant'});
  assert.equal(relevant.messages.length, newest.messages.length);
  assert.equal(newest.groups.reduce((count, group) => count + group.messages.length, 0), newest.messages.length);
  assert.ok(newest.groups.every(group => group.messages.every(item => item.chatId === group.chat.id)));
});

test('context contains immediate chronological neighbors from the same chat', () => {
  const room = model.messages.filter(item => item.chatId === 'rkt').sort((a,b) => a.at-b.at);
  const center = room[12];
  const context = model.context(center.id);
  assert.equal(context.previous.id, room[11].id);
  assert.equal(context.next.id, room[13].id);
  assert.equal(model.context(room[0].id).previous, null);
  assert.equal(model.context(room.at(-1).id).next, null);
  assert.deepEqual(model.context('missing'), {previous:null, next:null});
});

test('compact dates distinguish today, yesterday, weekday, month and previous year', () => {
  const now = new Date(2026,9,11,14,32).getTime();
  assert.match(model.compactTime(new Date(2026,9,11,9,5).getTime(),now), /9:05/);
  assert.equal(model.compactTime(new Date(2026,9,10,21).getTime(),now), 'Yesterday');
  assert.equal(model.compactTime(new Date(2026,9,8,12).getTime(),now), 'Thu');
  assert.equal(model.compactTime(new Date(2026,9,3,12).getTime(),now), 'Oct 3');
  assert.equal(model.compactTime(new Date(2025,9,3,12).getTime(),now), 'Oct 3, 2025');
  assert.match(model.fullTime(now), /2026/);
});
