/* Shared brute-force search oracle for differential correctness verification (PLAN.md 3.10).
 * Scans every stored message with RCSCore.prepareQuery and nothing else — no prefilter, no shortcuts. */
'use strict';

function buildOracleMessages(eventsByRoom, owner, people = {}, directory = {}) {
  const out = [];
  const allMediaTypes = new Set();
  const order = (a, b) => (a.origin_server_ts || 0) - (b.origin_server_ts || 0) || a.event_id.localeCompare(b.event_id);

  for (const [roomId, rawEvents] of eventsByRoom.entries()) {
    const ledger = new Map();
    for (const raw of rawEvents) {
      if (!raw?.event_id || raw.event_id.startsWith('~')) continue;
      if (!['m.room.message', 'm.sticker', 'm.room.redaction'].includes(raw.type)) continue;
      if (!ledger.has(raw.event_id)) ledger.set(raw.event_id, raw);
    }
    const removed = new Set();
    for (const ev of ledger.values()) {
      if (ev.unsigned?.redacted_because) removed.add(ev.event_id);
      const red = ev.redacts || ev.content?.redacts;
      if (ev.type === 'm.room.redaction' && red) removed.add(red);
    }
    const edits = new Map();
    for (const ev of ledger.values()) {
      const rel = ev.content?.['m.relates_to'];
      if (rel?.rel_type !== 'm.replace' || !rel.event_id || removed.has(ev.event_id) || removed.has(rel.event_id)) continue;
      const orig = ledger.get(rel.event_id);
      if (!orig || orig.sender !== ev.sender) continue;
      const prev = edits.get(rel.event_id);
      if (!prev || order(prev, ev) < 0) edits.set(rel.event_id, ev);
    }
    for (const ev of ledger.values()) {
      if (ev.type === 'm.room.redaction' || ev.content?.['m.relates_to']?.rel_type === 'm.replace' || removed.has(ev.event_id)) continue;
      const best = edits.get(ev.event_id);
      const src = best || ev;
      const bc = src.content?.['m.new_content'] || src.content || {};
      const attachmentType = src.type === 'm.sticker' ? 'image' : ({ 'm.image': 'image', 'm.video': 'video', 'm.audio': 'audio', 'm.file': 'file' }[bc.msgtype] || '');
      const attachmentMime = attachmentType ? String(bc.info?.mimetype || '').slice(0, 200).trim().toLowerCase().split(';')[0] : '';
      const rawBody = typeof bc.body === 'string' && bc.body ? bc.body.slice(0, 65536)
        : (typeof bc.formatted_body === 'string' && bc.formatted_body ? bc.formatted_body.slice(0, 65536).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '');
      const text = rawBody || (src.type === 'm.sticker' ? 'Sticker' : ({ image: 'Image', video: 'Video', audio: 'Audio', file: 'File' }[attachmentType] || ''));
      if (!text) continue;
      if (attachmentType) allMediaTypes.add(attachmentType);
      if (attachmentType === 'image' && attachmentMime === 'image/gif') allMediaTypes.add('gif');
      if (/\b(?:https?:\/\/|www\.)\S+/i.test(text)) allMediaTypes.add('link');

      const person = people[ev.sender] || directory?.identities?.[ev.sender] || {};
      const self = ev.sender === owner;
      const aliases = [...new Set([...(person.aliases || []), ...(directory?.identities?.[ev.sender]?.aliases || [])])];
      out.push({
        id: ev.event_id,
        roomId,
        text,
        sender: ev.sender,
        time: Number.isFinite(ev.origin_server_ts) ? ev.origin_server_ts : 0,
        timestamp: Number.isFinite(ev.origin_server_ts) ? ev.origin_server_ts : NaN,
        attachmentType,
        attachmentMime,
        author: self ? 'You' : (person.name || ev.sender),
        authorSelf: self,
        ...(aliases.length ? { authorAliases: aliases } : {}),
      });
    }
  }
  return { messages: out, availableMediaTypes: ['image', 'gif', 'video', 'audio', 'file', 'link'].filter(t => allMediaTypes.has(t)) };
}

function oracleSearch(RCSCore, corpus, { query = '', roomId, roomIds, dates = {}, from = 'all', wholeWord = false, sort = 'newest', limit = 200, offset = 0 } = {}) {
  const parsed = RCSCore.parseQuery(query);
  const matchIgnoreMedia = RCSCore.prepareQuery(parsed, { from, wholeWord, dates, ignoreMedia: true });
  const matchFinal = RCSCore.prepareQuery(parsed, { from, wholeWord, dates });
  const mediaEntries = Object.entries(RCSCore.mediaKinds);
  const mediaCounts = Object.fromEntries(mediaEntries.map(([t]) => [t, 0]));
  const allowed = roomIds ? new Set(roomIds) : null;

  const hits = [];
  for (const msg of corpus.messages) {
    if (roomId && msg.roomId !== roomId) continue;
    if (allowed && !allowed.has(msg.roomId)) continue;
    if (!matchIgnoreMedia(msg)) continue;
    const fl = RCSCore.mediaFlags(msg);
    for (const [t, bit] of mediaEntries) if (fl & bit) mediaCounts[t]++;
    if (matchFinal(msg)) hits.push(msg);
  }

  const scores = sort === 'relevant' ? new Map(hits.map(m => [m, RCSCore.relevanceScore(m.text, parsed, { wholeWord })])) : null;
  const dir = sort === 'oldest' ? 1 : -1;
  hits.sort((a, b) => (scores ? scores.get(b) - scores.get(a) : 0) || dir * (a.time - b.time) || a.roomId.localeCompare(b.roomId) || a.id.localeCompare(b.id));

  const rooms = new Set(hits.map(h => h.roomId));
  return {
    total: hits.length,
    matchedRooms: rooms.size,
    mediaCounts,
    availableMediaTypes: corpus.availableMediaTypes,
    ids: hits.slice(offset, offset + limit).map(h => h.roomId + '\0' + h.id),
    allIds: hits.map(h => h.roomId + '\0' + h.id),
    hasMore: offset + limit < hits.length,
  };
}

module.exports = { buildOracleMessages, oracleSearch };
