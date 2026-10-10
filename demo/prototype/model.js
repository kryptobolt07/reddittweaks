/* Synthetic interaction data. This prototype never reads Reddit or makes requests. */
(function (root, factory) {
  const model = factory();
  if (typeof module === 'object' && module.exports) module.exports = model;
  if (root) root.ChatPrototypeModel = model;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const now = Date.UTC(2026, 9, 11, 14, 32);
  const day = 86400000;
  const names = [
    'R-K-T', 'Fantastic_Care9298', 'Historical-Tour3674', 'coffeeandcode', 'MiraMakesThings',
    'Weekend Wanderers', 'pixelpioneer', 'Trail Mix Club', 'noodle_enthusiast', 'PaperMoon42',
    'Sunday Sketchbook', 'fern_and_fable', 'OrbitObserver', 'quiet_keyboard', 'Design After Hours',
    'tangerine_sky', 'Photo Walk Crew', 'riverstone_reads', 'MapleCircuit', 'Late Night Lo-fi',
    'AdaOnTheMove', 'smallbatchbread', 'Bookmarked', 'MountainMoss', 'bright_side_up',
    'Tea & Tangents', 'neon_cactus', 'SignalAndNoise', 'garden_gnome99', 'City Cyclists',
    'not_a_bot_2026', 'cobaltcloud', 'Playlist Exchange', 'SunsetSketches', 'WeekendBuilds',
    'FinchInFlight', 'curious_penguin', 'Kitchen Experiments', 'tiny_planets', 'Museum Sundays',
    'JuniperJournal', 'FriendlyAstronaut'
  ];
  const colors = ['#d88450', '#6689a7', '#8f78aa', '#b58a43', '#658f7a', '#b77189', '#6d83b1'];
  const groupIndices = new Set([5, 7, 10, 14, 16, 19, 22, 25, 29, 32, 37, 39]);
  const requestIndices = new Set([2, 12, 23, 30, 36, 41]);
  const chats = names.map((name, i) => ({
    id: ['rkt', 'fantastic', 'historical'][i] || 'chat-' + (i + 1), name,
    initials: name.split(/[\s_-]+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase(),
    color: colors[i % colors.length],
    type: requestIndices.has(i) ? 'request' : groupIndices.has(i) ? 'group' : 'direct',
    unread: i % 4 === 0 ? 2 + (i % 7) : 0,
    unavailable: i === 2 || i === 34,
    lastAt: 0, preview: ''
  }));
  const texts = [
    'Hey! How has your week been?',
    'I was thinking we could get coffee tomorrow. Same little place near the station?',
    'That sounds good to me! Let me check my calendar.',
    'Thanks for sending this over. I will take a look tonight.',
    'Here is the article I mentioned: https://example.com/reading/slow-weekends',
    'The project is coming together. A few more details to work through, but I like where it is going.',
    'Did you see the photos from the weekend? The light was incredible.',
    'Yes! The one with the little boat is my favorite.',
    'I can bring the snacks if someone else brings a picnic blanket.',
    'What time works for everyone on Saturday?',
    'Around 10 works. I am happy to meet a little earlier too.',
    'I saved the route here: https://example.org/maps/river-walk — about an hour, with a coffee stop.',
    'Just checking in. No rush to reply, I know it has been a busy week.',
    'The new playlist is so good. I have had it on all afternoon.',
    'I finally finished the book you recommended! We need to talk about that ending.',
    'Oh wow, I had exactly the same thought about the last chapter.',
    'One small update: the meetup moved to Sunday. Everything else is the same.',
    'Perfect, thank you for the heads up.',
    'Does anyone have a good recipe for a quick dinner?',
    'Try roasted tomatoes, pasta, and a ridiculous amount of basil. Always works.',
    'I made a quick sketch of the idea. There is something nice about keeping it simple.',
    'Can you send me the link when you have a chance?',
    'Of course — https://example.net/share/sketchbook?view=latest',
    'I think the blue version feels calmer. What do you think?',
    'Agreed. The contrast is better and it is easier to read.',
    'The weather looks good this weekend. Maybe we should take the longer trail.',
    'That is the plan! I will message you when I am on my way.',
    'I found this in my bookmarks and thought of you: https://example.com/notes/creative-routines',
    'Remember our conversation about starting small? I finally tried it today.',
    'Nice! Tell me how it went when you get a moment.',
    'Honestly, much better than expected. Thanks for the encouragement.',
    'No problem. Always happy to talk things through.',
    'Long update from me: I spent the afternoon rearranging the workspace, sorting out the cables, and trying a few different setups. After a lot of trial and error I found the perfect coffee spot beside the window. It catches the morning light, leaves room for the sketchbook, and makes the whole room feel much more welcoming. I will send a photo later.',
    'We should revisit the weekend plan after the next update.',
    'I am around if you want to chat later.',
    'Sounds like a plan. See you soon!'
  ];
  const messages = [];
  chats.forEach((chat, ci) => {
    for (let i = 0; i < 44; i++) {
      // Include older searchable history and dense recent conversations.
      const age = i < 10 ? (390 - i * 7 + ci) * day : (43 - i) * day / 3 + ci * 19 * 60000;
      messages.push({id: chat.id + '-m' + (i + 1), chatId: chat.id,
        sender: i % 3 === 0 ? 'me' : 'them', text: texts[(i + ci * 3) % texts.length],
        at: now - age - ((i * 17) % 53) * 60000});
    }
    const latest = messages.filter(message => message.chatId === chat.id).sort((a, b) => b.at - a.at)[0];
    chat.lastAt = latest.at;
    chat.preview = latest.text;
  });
  // Explicit conversations support discoverable example searches.
  const special = [
    ['rkt', 'them', 'Coffee tomorrow at 10? I found a quiet place near the park.', 46],
    ['rkt', 'me', 'Coffee tomorrow sounds perfect. Send me the link!', 39],
    ['rkt', 'them', 'Here you go: https://example.com/places/park-cafe', 31],
    ['fantastic', 'them', 'I saved the travel photos here: https://example.org/albums/autumn', 93],
    ['historical', 'them', 'Thanks again for the museum recommendations. The weekend plan was a success.', 150]
  ];
  special.forEach(([chatId, sender, text, minutes], i) => {
    const message = {id: 'featured-' + (i + 1), chatId, sender, text, at: now - minutes * 60000};
    messages.push(message);
    const chat = chats.find(item => item.id === chatId);
    if (message.at > chat.lastAt) { chat.lastAt = message.at; chat.preview = text; }
  });
  const chatMap = new Map(chats.map(chat => [chat.id, chat]));
  const fold = value => String(value || '').normalize('NFKC').toLocaleLowerCase();
  function dateValue(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return NaN;
    const [year, month, date] = value.split('-').map(Number);
    const local = new Date(year, month - 1, date);
    return local.getFullYear() === year && local.getMonth() === month - 1 && local.getDate() === date ? local.getTime() : NaN;
  }
  function parseQuery(query) {
    const parsed = {terms: [], phrases: [], from: [], after: [], before: [], hasLink: false, invalid: false};
    const tokens = String(query || '').match(/(?:[^\s"]*"[^"]*"|[^\s"]+)/g) || [];
    tokens.forEach(token => {
      const operator = token.match(/^(from|after|before|has):(.*)$/i);
      if (operator) {
        const key = operator[1].toLowerCase(), value = operator[2].replace(/^"|"$/g, '');
        if (key === 'has') {
          if (fold(value) === 'link') parsed.hasLink = true;
          else parsed.invalid = true;
        } else if (key === 'from') {
          if (value) parsed.from.push(fold(value).replace(/^u\//, ''));
          else parsed.invalid = true;
        } else {
          if (!Number.isFinite(dateValue(value))) parsed.invalid = true;
          parsed[key].push(value);
        }
      } else if (token.startsWith('"') && token.endsWith('"')) {
        const phrase = token.slice(1, -1);
        if (phrase) parsed.phrases.push(phrase);
      } else parsed.terms.push(token.replace(/"/g, ''));
    });
    return parsed;
  }
  const wordChar = char => !!char && /[\p{L}\p{N}_]/u.test(char);
  function rangesFor(text, needles, wholeWord) {
    const normalized = fold(text), ranges = [];
    for (const needle of needles) {
      const search = fold(needle);
      let offset = 0, found = false;
      while (search && (offset = normalized.indexOf(search, offset)) !== -1) {
        const end = offset + search.length;
        if (!wholeWord || (!wordChar(normalized[offset - 1]) && !wordChar(normalized[end]))) {
          ranges.push([offset, end]); found = true;
        }
        offset = end;
      }
      if (!found) return null;
    }
    ranges.sort((a, b) => a[0] - b[0]);
    return ranges.reduce((merged, range) => {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push(range.slice());
      return merged;
    }, []);
  }
  function excerpt(text, ranges) {
    const max = 164, match = ranges[0] || [0, 0];
    let start = Math.max(0, match[0] - 54), end = Math.min(text.length, Math.max(start + max, match[1]));
    if (end === text.length) start = Math.max(0, end - max);
    // Avoid cutting through words while keeping match offsets exact.
    if (start && start < match[0]) { const space = text.indexOf(' ', start); if (space < match[0]) start = space + 1; }
    const prefix = start > 0 ? '…' : '', suffix = end < text.length ? '…' : '';
    return {snippet: prefix + text.slice(start, end) + suffix,
      snippetRanges: ranges.filter(([a, b]) => b > start && a < end).map(([a, b]) => [Math.max(a, start) - start + prefix.length, Math.min(b, end) - start + prefix.length])};
  }
  function search(options) {
    const opts = Object.assign({query: '', scope: 'all', filter: 'all', from: 'all', wholeWord: false, sort: 'newest', after: '', before: ''}, options);
    const parsed = parseQuery(opts.query);
    const needles = [...parsed.terms, ...parsed.phrases];
    const after = [...parsed.after, ...(opts.after ? [opts.after] : [])].map(dateValue);
    const before = [...parsed.before, ...(opts.before ? [opts.before] : [])].map(dateValue);
    const invalid = parsed.invalid || [...after, ...before].some(value => !Number.isFinite(value));
    const chatAllowed = chat => (!opts.chatId || chat.id === opts.chatId) && (opts.filter === 'all' || (opts.filter === 'unread' ? chat.unread > 0 : chat.type === (opts.filter === 'groups' ? 'group' : 'request')));
    const senderAllowed = (message, chat) => (opts.from === 'all' || message.sender === opts.from) && parsed.from.every(from =>
      from === 'me' || from === 'them' ? message.sender === from : message.sender === 'them' && fold(chat.name).includes(from));
    const resultMessages = invalid || opts.scope === 'people' ? [] : messages.filter(message => {
      const chat = chatMap.get(message.chatId);
      return chatAllowed(chat) && senderAllowed(message, chat) && after.every(date => message.at >= date) && before.every(date => message.at < date)
        && (!parsed.hasLink || /\b(?:https?:\/\/|www\.)\S+/i.test(message.text)) && rangesFor(message.text, needles, opts.wholeWord) !== null;
    }).map(message => {
      const ranges = rangesFor(message.text, needles, opts.wholeWord);
      return Object.assign({}, message, {chat: chatMap.get(message.chatId), ranges}, excerpt(message.text, ranges));
    });
    const relevance = message => message.ranges.reduce((score, [start, end]) => score + end - start, 0) + (message.ranges[0]?.[0] === 0 ? 20 : 0);
    resultMessages.sort((a, b) => opts.sort === 'oldest' ? a.at - b.at : opts.sort === 'relevant' ? relevance(b) - relevance(a) || b.at - a.at : b.at - a.at);
    const messageOnly = parsed.from.length || parsed.after.length || parsed.before.length || parsed.hasLink || opts.from !== 'all' || opts.after || opts.before;
    const people = invalid || opts.scope === 'messages' || messageOnly ? [] : chats.filter(chat => chatAllowed(chat) &&
      rangesFor(chat.name + (chat.unavailable ? ' deleted unavailable' : ''), needles, opts.wholeWord) !== null).sort((a, b) => opts.sort === 'oldest' ? a.lastAt - b.lastAt : b.lastAt - a.lastAt);
    const groups = [];
    const groupMap = new Map();
    resultMessages.forEach(message => {
      if (!groupMap.has(message.chatId)) { const group = {chat: message.chat, messages: []}; groupMap.set(message.chatId, group); groups.push(group); }
      groupMap.get(message.chatId).messages.push(message);
    });
    return {people, messages: resultMessages, groups, commonWord: needles.length > 0 && (resultMessages.length > 300 || needles.every(term => ['the', 'a', 'i', 'and', 'to', 'it', 'you', 'me', 'thanks', 'yes'].includes(fold(term)))), parsed};
  }
  function context(messageId) {
    const message = messages.find(item => item.id === messageId);
    if (!message) return {previous: null, next: null};
    const room = messages.filter(item => item.chatId === message.chatId).sort((a, b) => a.at - b.at);
    const index = room.findIndex(item => item.id === messageId);
    const enrich = item => item ? Object.assign({}, item, {chat: chatMap.get(item.chatId)}) : null;
    return {previous: enrich(room[index - 1]), next: enrich(room[index + 1])};
  }
  function compactTime(at, reference = now) {
    const date = new Date(at), today = new Date(reference);
    const midnight = value => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const age = Math.round((midnight(today) - midnight(date)) / day);
    if (age === 0) return date.toLocaleTimeString('en-US', {hour: 'numeric', minute: '2-digit'});
    if (age === 1) return 'Yesterday';
    if (age > 1 && age < 7) return date.toLocaleDateString('en-US', {weekday: 'short'});
    return date.toLocaleDateString('en-US', {month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? {year: 'numeric'} : {})});
  }
  function fullTime(at) { return new Date(at).toLocaleString('en-US', {weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'}); }
  function avatar(chat) {
    const safe = text => String(text).replace(/[<>&"']/g, '');
    return 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="32" fill="' + safe(chat.color || '#6689a7') + '"/><text x="32" y="39" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="22" font-weight="600">' + safe(chat.initials || '?') + '</text></svg>');
  }
  return {now, chats, messages, parseQuery, search, context, compactTime, fullTime, avatar};
});
