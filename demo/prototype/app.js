/* Standalone synthetic design preview. Never imports the live extension or contacts Reddit. */
(function () {
  'use strict';
  const M = window.ChatPrototypeModel;
  const $ = (id) => document.getElementById(id);
  const icons = {
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4.5 4.5"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    filter: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="currentColor"/><circle cx="15" cy="17" r="2" fill="currentColor"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    calendar: '<rect x="3.5" y="5" width="17" height="16" rx="3"/><path d="M7 3v4M17 3v4M4 10h16M8 14h1M14 14h1M8 18h1"/>',
    sort: '<path d="M8 4v16m-4-4 4 4 4-4M15 6h5M15 11h4M15 16h2"/>',
    refresh: '<path d="M20 8a8 8 0 1 0 0 8M20 3v5h-5"/>',
    minimize: '<path d="M5 16h14"/>',
    back: '<path d="m14 5-7 7 7 7"/>',
    forward: '<path d="m10 5 7 7-7 7"/>',
    settings: '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
    history: '<path d="M4 5v5h5M4 10a8 8 0 1 1 1 7M12 7v5l3 2"/>',
    send: '<path d="m3 3 18 9-18 9 3-9-3-9ZM6 12h15"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.search}</svg>`;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const avatar = (chat) => `<img class="avatar" src="${esc(M.avatar(chat))}" alt="" width="36" height="36">`;
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem('rcs-design-preview:recent') || '[]').filter((v) => typeof v === 'string').slice(0, 5); } catch (_) {}
  const state = { query: '', chatId: '', scope: 'all', filter: 'all', from: 'all', wholeWord: false, sort: 'newest', after: '', before: '', focused: false, layout: 'full', popover: '', selected: '', keyboard: '', expanded: new Set(), contexts: new Set(), activeChat: M.chats[0].id, jump: '', loading: false, results: null, items: [], heights: [], totalHeight: 0 };
  const input = $('search-input');
  const viewport = $('search-results');
  let queryTimer, loadingTimer, toastTimer, jumpTimer, scrollFrame;
  let calendarMonth = new Date(M.now).getMonth(), calendarYear = new Date(M.now).getFullYear(), dateMode = 'between', dateStart = '';
  const DAY = 86400000;
  const isSearching = () => Boolean(state.query.trim() || state.chatId || state.scope === 'messages' || state.from !== 'all' || state.after || state.before || state.wholeWord);
  const hasFilters = () => state.chatId || state.filter !== 'all' || state.from !== 'all' || state.after || state.before || state.wholeWord;
  const shortDate = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('en-US', {month:'short', day:'numeric'});
  const dayLabel = (at) => {
    const d = new Date(at), today = new Date(M.now);
    const days = Math.round((new Date(today.getFullYear(), today.getMonth(), today.getDate()) - new Date(d.getFullYear(),d.getMonth(),d.getDate())) / DAY);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    return d.toLocaleDateString('en-US', {weekday: 'short', month:'short', day:'numeric', ...(d.getFullYear() !== today.getFullYear() ? {year:'numeric'} : {})});
  };
  function mark(text, ranges) {
    let out = '', last = 0;
    (ranges || []).forEach(([start, end]) => { if (start < last) return; out += esc(text.slice(last,start)) + '<mark>' + esc(text.slice(start,end)) + '</mark>'; last = end; });
    return out + esc(text.slice(last));
  }
  function time(at) { return `<time class="row-time" datetime="${new Date(at).toISOString()}" title="${esc(M.fullTime(at))}">${esc(M.compactTime(at,M.now))}</time>`; }
  function announce(text) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 2800); }
  function saveRecent() {
    const q = state.query.trim();
    if (!q) return;
    recent = [q, ...recent.filter((v) => v !== q)].slice(0,5);
    try { localStorage.setItem('rcs-design-preview:recent',JSON.stringify(recent)); } catch (_) {}
  }
  function controls() {
    $('scope-tabs').hidden = !(state.focused || state.query || state.scope !== 'all');
    const r = state.results, counts = state.counts;
    $('scope-tabs').innerHTML = ['all','people','messages'].map((scope) => `<button class="scope-tab${state.scope === scope ? ' active' : ''}" role="tab" tabindex="${state.scope === scope ? 0 : -1}" aria-selected="${state.scope === scope}" data-scope="${scope}">${scope === 'all' ? 'All' : scope === 'people' ? 'People' : 'Messages'}${state.query && scope !== 'all' ? ` <span class="tab-count">${(scope === 'people' ? counts.people.length : counts.messages.length).toLocaleString()}</span>` : ''}</button>`).join('');
    $('clear-search').hidden = !state.query;
    $('search-shortcut').hidden = Boolean(state.query || state.focused);
    const names = {all:'Filters',unread:'Unread',groups:'Groups',requests:'Requests'};
    $('filter-control').innerHTML = icon('filter') + `<span>${names[state.filter]}</span>`;
    $('from-control').innerHTML = icon('user') + `<span>${state.from === 'all' ? 'From' : state.from === 'me' ? 'Me' : 'Them'}</span>`;
    $('date-control').innerHTML = icon('calendar') + '<span>Date</span>';
    $('sort-control').innerHTML = icon('sort') + `<span>${state.sort === 'newest' ? 'Newest' : state.sort === 'oldest' ? 'Oldest' : 'Relevant'}</span>`;
    [['filter',state.filter !== 'all'],['from',state.from !== 'all'],['date',Boolean(state.after || state.before)],['sort',state.sort !== 'newest']].forEach(([name,active]) => { $(`${name}-control`).classList.toggle('active',active); $(`${name}-control`).setAttribute('aria-expanded',String(state.popover === name)); });
    const plainLength = state.query.trim().replace(/\b(?:from|before|after|has):\S+/gi,'').trim().length;
    $('word-control').hidden = !state.wholeWord && (plainLength === 0 || plainLength > 5);
    $('word-control').classList.toggle('active',state.wholeWord);
    $('word-control').setAttribute('aria-pressed',String(state.wholeWord));
    const chips = [];
    if (state.chatId) chips.push(`<button class="filter-chip" data-remove="chat" aria-label="Remove conversation filter">In: ${esc(M.chats.find((c) => c.id === state.chatId).name)} ${icon('close')}</button>`);
    if (state.after || state.before) {
      let label = state.after && state.before ? `${shortDate(state.after)} – ${shortDate(state.before)} (before)` : state.after ? `After ${shortDate(state.after)}` : `Before ${shortDate(state.before)}`;
      chips.push(`<button class="filter-chip" data-remove="date" aria-label="Remove date filter">${esc(label)} ${icon('close')}</button>`);
    }
    if (state.filter !== 'all') chips.push(`<button class="filter-chip" data-remove="filter" aria-label="Remove ${names[state.filter]} filter">${names[state.filter]} ${icon('close')}</button>`);
    if (state.from !== 'all') chips.push(`<button class="filter-chip" data-remove="from" aria-label="Remove sender filter">From: ${state.from === 'me' ? 'Me' : 'Them'} ${icon('close')}</button>`);
    $('active-filters').hidden = chips.length === 0;
    $('active-filters').innerHTML = chips.join('');
    $('common-hint').hidden = !state.results.commonWord || state.results.messages.length < 30;
    if (state.loading) $('result-status').textContent = 'Searching saved messages…';
    else if (isSearching() && state.scope !== 'people') $('result-status').textContent = `${r.messages.length.toLocaleString()} matches in ${new Set(r.messages.map((m) => m.chatId)).size.toLocaleString()} chats`;
    else $('result-status').textContent = `${r.people.length} ${state.filter === 'requests' ? 'requests' : 'chats'}`;
    $('refresh-results').disabled = state.loading;
  }
  function makeItems() {
    const items = [];
    if (!state.query && !hasFilters() && state.scope !== 'messages' && state.focused) {
      items.push({kind:'heading',text:'Recent searches',height:34});
      if (!recent.length) items.push({kind:'hint',text:'Your searches will appear here. Try coffee or from:me has:link.',height:54});
      recent.forEach((q,i) => items.push({kind:'recent',query:q,key:`recent:${i}`,height:44}));
    }
    if (state.scope !== 'messages') {
      if (isSearching() && state.scope === 'all' && state.results.people.length) items.push({kind:'heading',text:'People',height:34});
      state.results.people.forEach((chat) => items.push({kind:'chat',chat,key:`chat:${chat.id}`,height:86}));
    }
    if (isSearching() && state.scope !== 'people') {
      if (state.scope === 'all' && state.results.messages.length) items.push({kind:'heading',text:'Messages',height:34});
      let lastDay = '';
      state.results.groups.forEach((group) => {
        const label = dayLabel(group.messages[0].at);
        if (label !== lastDay) { items.push({kind:'day',text:label,height:30}); lastDay = label; }
        const expanded = state.expanded.has(group.chat.id), first = group.messages[0];
        items.push({kind:'group',group,visible:[first],key:`message:${first.id}`,height:44 + 76 + (state.contexts.has(first.id) ? 134 : 0) + (!expanded && group.messages.length > 1 ? 26 : 0)});
        if (expanded) {
          group.messages.slice(1).forEach((message) => {
            const messageDay = dayLabel(message.at);
            if (messageDay !== lastDay) { items.push({kind:'day',text:messageDay,height:30}); lastDay = messageDay; }
            items.push({kind:'message',message,key:`message:${message.id}`,height:76 + (state.contexts.has(message.id) ? 134 : 0)});
          });
          if (group.messages.length > 1) items.push({kind:'collapse',chatId:group.chat.id,height:26});
        }
      });
    }
    if (!state.results.people.length && !state.results.messages.length || (state.scope === 'people' && !state.results.people.length) || (state.scope === 'messages' && !state.results.messages.length)) items.push({kind:'empty',height:220});
    let offset = 0;
    state.items = items.map((item) => { const value = {...item,offset}; offset += item.height; return value; });
    state.totalHeight = offset;
  }
  function chatRow(item) {
    const c = item.chat;
    const type = c.type === 'group' ? 'Group chat' : c.type === 'request' ? 'Request pending' : '';
    return `<button class="result-row chat-result${c.unread ? ' unread' : ''}" data-open-chat="${esc(c.id)}" data-key="${esc(item.key)}" aria-label="Open ${esc(c.name)}${c.unread ? ', unread' : ''}">${avatar(c)}<span class="row-main"><span class="row-top"><span class="row-title">${esc(c.name)}</span>${time(c.lastAt)}${c.unread ? '<span class="unread-dot" aria-label="Unread"></span>' : ''}</span><span class="row-snippet">${esc(c.preview || 'No saved message preview')}</span>${c.unavailable || type ? `<span class="row-meta">${c.unavailable ? 'Unavailable account · Retained username' : type}</span>` : ''}</span></button>`;
  }
  function messageRow(m) {
    const context = state.contexts.has(m.id), nearby = context ? M.context(m.id) : null;
    const contextText = (label,msg) => `<div class="context-message"><span>${label} · ${msg ? `${msg.sender === 'me' ? 'You' : esc(m.chat.name)} · ${esc(M.compactTime(msg.at,M.now))}` : ''}</span><p>${msg ? esc(msg.text) : `No ${label.toLowerCase()} message saved`}</p></div>`;
    return `<div class="message-result${state.jump === m.id ? ' selected' : ''}"><button class="message-open" data-open-message="${esc(m.id)}" aria-label="Open message in ${esc(m.chat.name)}, ${esc(M.fullTime(m.at))}"><span class="snippet" title="${esc(m.text)}">${m.sender === 'me' ? '<span class="you-prefix">You: </span>' : ''}${mark(m.snippet,m.snippetRanges)}</span>${time(m.at)}</button><button class="context-button" data-context="${esc(m.id)}" aria-expanded="${context}">${context ? 'Hide context' : 'Show context'} ${icon('chevron')}</button>${context ? `<div class="message-context">${contextText('Previous',nearby.previous)}${contextText('Next',nearby.next)}</div>` : ''}</div>`;
  }
  function itemHTML(item) {
    if (item.kind === 'chat') return chatRow(item);
    if (item.kind === 'message') return `<div data-key="${esc(item.key)}">${messageRow(item.message)}</div>`;
    if (item.kind === 'collapse') return `<button class="more-matches" data-expand="${esc(item.chatId)}" aria-expanded="true">Collapse matches ${icon('chevron')}</button>`;
    if (item.kind === 'group') {
      const {chat,messages} = item.group;
      return `<article class="message-group" data-key="${esc(item.key)}"><div class="group-heading">${avatar(chat)}<button class="row-title" data-open-chat="${esc(chat.id)}" title="Open ${esc(chat.name)}">${esc(chat.name)}</button>${chat.unavailable ? '<span class="unavailable-tag" title="Unavailable account · Retained username">Unavailable</span>' : ''}<span class="group-count">${messages.length}</span></div>${item.visible.map(messageRow).join('')}${messages.length > 1 && !state.expanded.has(chat.id) ? `<button class="more-matches" data-expand="${esc(chat.id)}" aria-expanded="${state.expanded.has(chat.id)}">${state.expanded.has(chat.id) ? 'Collapse matches' : `${messages.length - 1} more matches`} ${icon('chevron')}</button>` : ''}</article>`;
    }
    if (item.kind === 'heading') return `<h2 class="recent-heading">${esc(item.text)}</h2>`;
    if (item.kind === 'day') return `<h3 class="day-heading">${esc(item.text)}</h3>`;
    if (item.kind === 'hint') return `<p class="recent-hint">${esc(item.text)}</p>`;
    if (item.kind === 'recent') return `<div class="recent-row" data-key="${esc(item.key)}"><button data-recent="${esc(item.query)}">${icon('history')}<span>${esc(item.query)}</span></button><button class="icon-button" data-delete-recent="${esc(item.query)}" aria-label="Remove recent search ${esc(item.query)}" title="Remove recent search">${icon('close')}</button></div>`;
    return `<div class="empty-state">${icon('search')}<h2>${state.scope === 'people' ? 'No chats found' : 'No messages match'}${state.query ? ` “${esc(state.query)}”` : ''}</h2><p>${hasFilters() ? 'Try removing a filter or searching another phrase.' : 'Try a different name or add fewer search terms.'}</p>${hasFilters() ? '<button class="control-pill" data-clear-filters="true">Clear filters</button>' : ''}</div>`;
  }
  function renderWindow() {
    if (state.loading) {
      input.removeAttribute('aria-activedescendant');
      viewport.innerHTML = `<div class="skeleton-list" aria-label="Loading saved results">${Array.from({length:7},() => '<div class="skeleton-row"><span class="skeleton-avatar"></span><span><i></i><i></i></span></div>').join('')}</div>`;
      return;
    }
    const top = viewport.scrollTop, bottom = top + (viewport.clientHeight || 600), overscan = 280;
    const start = Math.max(0,state.items.findIndex((item) => item.offset + item.height >= top - overscan));
    let end = state.items.findIndex((item) => item.offset > bottom + overscan);
    if (end < 0) end = state.items.length;
    const slice = state.items.slice(start,end);
    const firstOffset = slice[0]?.offset || 0;
    const last = slice[slice.length - 1];
    const tail = last ? state.totalHeight - last.offset - last.height : 0;
    // Only visible groups/rows are mounted. Off-screen content is represented by spacers.
    const sticky = state.items.slice(0,start).reverse().find((item) => item.kind === 'day');
    viewport.innerHTML = `<div class="virtual-spacer" style="height:${firstOffset}px" aria-hidden="true"></div>${sticky ? `<h3 class="day-heading carried-day">${esc(sticky.text)}</h3>` : ''}${slice.map((item) => item.kind === 'day' ? `<h3 class="day-heading" style="height:${item.height}px">${esc(item.text)}</h3>` : `<div class="virtual-item" style="height:${item.height}px" data-item-kind="${item.kind}">${itemHTML(item)}</div>`).join('')}<div class="virtual-spacer" style="height:${tail}px" aria-hidden="true"></div>`;
    let activeRow = null;
    viewport.querySelectorAll('[data-key]').forEach((row) => { row.classList.toggle('selected',row.dataset.key === state.selected); row.classList.toggle('keyboard-focus',row.dataset.key === state.keyboard); if (row.dataset.key === state.keyboard) activeRow = row; });
    if (activeRow) { activeRow.id = 'active-search-result'; input.setAttribute('aria-activedescendant',activeRow.id); }
    else input.removeAttribute('aria-activedescendant');
  }
  function runSearch({reset = true} = {}) {
    clearTimeout(queryTimer);
    state.results = M.search(state);
    state.counts = state.scope === 'all' ? state.results : M.search({...state,scope:'all'});
    makeItems(); controls();
    if (reset) { viewport.scrollTop = 0; state.keyboard = ''; input.removeAttribute('aria-activedescendant'); }
    renderWindow();
  }
  function debounceSearch() {
    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => { queryTimer = null; state.expanded.clear(); state.contexts.clear(); runSearch(); },180);
  }
  function layout(mode) {
    state.layout = mode;
    const shell = $('chat-shell');
    shell.classList.toggle('floating',mode === 'floating');
    shell.classList.toggle('minimized',mode === 'minimized');
    shell.classList.remove('show-room');
    if (state.popover) closePopover();
    document.querySelectorAll('[data-layout]').forEach((button) => button.setAttribute('aria-pressed',String(button.dataset.layout === mode)));
    document.querySelector('.minimized-count').textContent = `${M.chats.filter((c) => c.unread).length} unread`;
    renderWindow();
  }
  function openChat(chatId,messageId) {
    saveRecent();
    const chat = M.chats.find((c) => c.id === chatId);
    if (!chat) return;
    state.activeChat = chatId; state.jump = messageId || '';
    $('room-header').innerHTML = `<button class="icon-button room-back" id="back-to-results" title="Back to search results" aria-label="Back to search results">${icon('back')}</button>${avatar(chat)}<span class="room-heading"><strong>${esc(chat.name)}</strong><span>${chat.unavailable ? 'Unavailable account · Retained username' : chat.type === 'group' ? 'Group conversation' : chat.type === 'request' ? 'Request pending · Preview' : 'Conversation · Preview'}</span></span><button class="icon-button" id="room-search" title="Search this conversation" aria-label="Search this conversation">${icon('search')}</button><button class="icon-button" id="room-info" title="Conversation details" aria-label="Conversation details">${icon('settings')}</button>`;
    const all = M.messages.filter((m) => m.chatId === chatId).sort((a,b) => a.at - b.at);
    const targetIndex = messageId ? all.findIndex((m) => m.id === messageId) : all.length-1;
    const visible = all.slice(Math.max(0,targetIndex - 4),Math.min(all.length,targetIndex + 5));
    let lastDay = '';
    $('room-timeline').innerHTML = visible.map((m) => {
      const day = dayLabel(m.at), header = day !== lastDay ? `<div class="timeline-day">${esc(day)}</div>` : ''; lastDay = day;
      return `${header}<article class="bubble-row${m.sender === 'me' ? ' self' : ''}${m.id === messageId ? ' jump-highlight' : ''}" id="timeline-${esc(m.id)}">${avatar(m.sender === 'me' ? {name:'You',initials:'Y',color:'#526c8c'} : chat)}<div class="bubble"><div class="bubble-author"><span>${m.sender === 'me' ? 'You' : esc(chat.name)}</span><time title="${esc(M.fullTime(m.at))}">${new Date(m.at).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}</time></div><p class="bubble-text">${esc(m.text)}</p></div></article>`;
    }).join('') || '<div class="empty-state"><h2>No messages saved yet</h2><p>This request hasn’t been accepted in the synthetic preview.</p></div>';
    $('chat-shell').classList.add('show-room');
    requestAnimationFrame(() => {
      const target = messageId && $(`timeline-${messageId}`);
      if (target) target.scrollIntoView({block:'center',behavior:'smooth'});
      else $('room-timeline').scrollTop = $('room-timeline').scrollHeight;
    });
    clearTimeout(jumpTimer); jumpTimer = setTimeout(() => document.querySelectorAll('.jump-highlight').forEach((el) => el.classList.remove('jump-highlight')),2500);
    state.selected = messageId ? `message:${messageId}` : `chat:${chatId}`;
    renderWindow();
    if (messageId) announce('Opened message · highlighted in conversation');
  }
  function clearFilters() { state.chatId = ''; state.filter = 'all'; state.from = 'all'; state.after = ''; state.before = ''; state.wholeWord = false; runSearch(); }
  function closePopover() { state.popover = ''; $('search-popover').hidden = true; controls(); }
  const menuOptions = {
    filter: [['all','All chats'],['unread','Unread'],['groups','Groups'],['requests','Requests']],
    from: [['all','Anyone'],['me','Me'],['them','Them']],
    sort: [['newest','Newest first'],['oldest','Oldest first'],['relevant','Most relevant']],
  };
  function positionPopover() {
    const el = $('search-popover');
    if (el.hidden) return;
    const sidebar = document.querySelector('.chat-sidebar').getBoundingClientRect();
    const anchor = $(`${state.popover}-control`).getBoundingClientRect();
    const width = Math.min(state.popover === 'date' ? 276 : 238, Math.max(220,sidebar.width - 32));
    el.style.width = `${width}px`;
    el.style.left = `${Math.max(12,Math.min(window.innerWidth-width-12,sidebar.right-width-16))}px`;
    el.style.top = `${Math.max(76,Math.min(anchor.bottom + 7,window.innerHeight - el.offsetHeight - 12))}px`;
  }
  function showPopover(name) {
    if (state.popover === name) return closePopover();
    state.popover = name;
    const el = $('search-popover');
    el.hidden = false;
    el.className = `popover ${name === 'date' ? 'calendar-popover' : 'menu-popover'}`;
    if (name === 'date') { dateStart = ''; renderCalendar(); }
    else {
      el.setAttribute('role','menu'); el.setAttribute('aria-label',`${name} options`);
      el.innerHTML = menuOptions[name].map(([value,label]) => `<button class="menu-option" role="menuitemradio" aria-checked="${state[name] === value}" data-menu="${name}" data-value="${value}"><span>${label}</span>${state[name] === value ? icon('check') : ''}</button>`).join('');
    }
    controls(); positionPopover();
  }
  function renderCalendar() {
    const el = $('search-popover');
    el.setAttribute('role','dialog'); el.setAttribute('aria-label','Choose message dates');
    const first = new Date(calendarYear,calendarMonth,1).getDay(), count = new Date(calendarYear,calendarMonth+1,0).getDate();
    const days = Array.from({length:first},() => '<span></span>');
    for (let day=1;day<=count;day++) {
      const value = `${calendarYear}-${String(calendarMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const edge = value === dateStart || value === state.after || value === state.before;
      const inRange = state.after && state.before && value > state.after && value < state.before;
      days.push(`<button class="calendar-day${edge ? ' range-edge' : ''}${inRange ? ' in-range' : ''}" data-date="${value}" aria-label="${esc(new Date(`${value}T12:00:00`).toLocaleDateString('en-US',{dateStyle:'full'}))}" aria-pressed="${edge}">${day}</button>`);
    }
    el.innerHTML = `<div class="popover-title">Message dates<button class="icon-button" data-close-popover="true" aria-label="Close date filter" title="Close date filter">${icon('close')}</button></div><div class="calendar-modes">${[['after','After'],['before','Before'],['between','Between']].map(([mode,label]) => `<button class="control-pill${dateMode === mode ? ' active' : ''}" data-date-mode="${mode}" aria-pressed="${dateMode === mode}">${label}</button>`).join('')}</div><div class="calendar-nav"><button class="icon-button" data-month="-1" aria-label="Previous month" title="Previous month">${icon('back')}</button><strong>${new Date(calendarYear,calendarMonth,1).toLocaleDateString('en-US',{month:'long',year:'numeric'})}</strong><button class="icon-button" data-month="1" aria-label="Next month" title="Next month">${icon('forward')}</button></div><div class="calendar-grid">${['S','M','T','W','T','F','S'].map((d) => `<span class="calendar-weekday">${d}</span>`).join('')}${days.join('')}</div><p class="calendar-hint">${dateMode === 'between' ? dateStart ? 'Choose the end date (exclusive).' : 'Choose a start date, then an end date.' : `Messages ${dateMode} the selected date${dateMode === 'before' ? ' (exclusive)' : ' (inclusive)'}.`}</p><button class="calendar-clear" data-remove="date">Clear date filter</button>`;
    positionPopover();
  }
  function selectDate(value) {
    if (dateMode === 'between' && !dateStart) { dateStart = value; renderCalendar(); $('search-popover').querySelector(`[data-date="${value}"]`)?.focus(); return; }
    if (dateMode === 'between') { [state.after,state.before] = [dateStart,value].sort(); }
    else { state.after = dateMode === 'after' ? value : ''; state.before = dateMode === 'before' ? value : ''; }
    closePopover(); runSearch();
  }
  function navigate(direction) {
    const selectable = state.items.filter((i) => i.key);
    if (!selectable.length) return;
    let index = selectable.findIndex((i) => i.key === state.keyboard);
    index = Math.max(0,Math.min(selectable.length-1,index < 0 ? direction > 0 ? 0 : selectable.length-1 : index + direction));
    const item = selectable[index];
    state.keyboard = item.key;
    const viewHeight = viewport.clientHeight || 600;
    if (item.offset < viewport.scrollTop) viewport.scrollTop = item.offset;
    else if (item.offset + item.height > viewport.scrollTop + viewHeight) viewport.scrollTop = item.offset + Math.min(item.height,viewHeight) - viewHeight;
    renderWindow();
    const row = [...viewport.querySelectorAll('[data-key]')].find((el) => el.dataset.key === item.key);
    if (row) { row.id = 'active-search-result'; input.setAttribute('aria-activedescendant',row.id); }
  }
  function openKeyboard() {
    const item = state.items.find((i) => i.key === state.keyboard);
    if (!item) return;
    if (item.kind === 'recent') { state.query = input.value = item.query; runSearch(); }
    else if (item.kind === 'chat') openChat(item.chat.id);
    else if (item.kind === 'message') openChat(item.message.chatId,item.message.id);
    else openChat(item.group.chat.id,item.group.messages[0].id);
  }
  $('scope-tabs').addEventListener('keydown',(e) => {
    if (!['ArrowLeft','ArrowRight','Home','End'].includes(e.key)) return;
    e.preventDefault(); const scopes = ['all','people','messages'];
    const index = scopes.indexOf(state.scope);
    state.scope = scopes[e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (index + (e.key === 'ArrowRight' ? 1 : 2)) % 3];
    runSearch(); $('scope-tabs').querySelector(`[data-scope="${state.scope}"]`).focus();
  });
  input.addEventListener('input',() => { state.query = input.value; debounceSearch(); });
  input.addEventListener('focus',() => { state.focused = true; runSearch({reset:false}); });
  input.addEventListener('keydown',(e) => {
    if (state.popover) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); runPending(); navigate(e.key === 'ArrowDown' ? 1 : -1); }
    if (e.key === 'Enter') { e.preventDefault(); runPending(); if (state.keyboard) openKeyboard(); else { saveRecent(); navigate(1); openKeyboard(); } }
  });
  function runPending() { if (queryTimer) { clearTimeout(queryTimer); queryTimer = null; runSearch({reset:false}); } }
  document.addEventListener('keydown',(e) => {
    const editable = e.target.closest('input,textarea,[contenteditable="true"]');
    if (e.key === '/' && !editable) { e.preventDefault(); if (state.layout === 'minimized') layout('floating'); $('chat-shell').classList.remove('show-room'); input.focus(); }
    if (e.key === 'Escape') {
      if ($('coverage-dialog').open) return;
      if (state.popover) { const control = $(`${state.popover}-control`); closePopover(); control.focus(); return; }
      e.preventDefault(); state.query = input.value = ''; state.keyboard = ''; input.removeAttribute('aria-activedescendant'); runSearch();
    }
    if (state.popover && ['ArrowDown','ArrowUp'].includes(e.key) && state.popover !== 'date') {
      e.preventDefault(); const buttons = [...$('search-popover').querySelectorAll('button')], idx = buttons.indexOf(document.activeElement);
      buttons[(idx + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    }
  });
  viewport.addEventListener('keydown',(e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); input.focus(); navigate(e.key === 'ArrowDown' ? 1 : -1); }
  });
  viewport.addEventListener('scroll',() => { if (scrollFrame) cancelAnimationFrame(scrollFrame); scrollFrame = requestAnimationFrame(renderWindow); });
  document.addEventListener('click',(e) => {
    const insidePopover = e.composedPath().some((node) => node.nodeType === 1 && node.matches?.('.popover,.search-controls'));
    const button = e.target.closest('button');
    if (button) {
      const d = button.dataset;
      if (d.layout) layout(d.layout);
      if (d.scope) { state.scope = d.scope; runSearch(); }
      if (d.openChat) openChat(d.openChat);
      if (d.openMessage) { const m = M.messages.find((v) => v.id === d.openMessage); if (m) openChat(m.chatId,m.id); }
      if (d.expand) { state.expanded.has(d.expand) ? state.expanded.delete(d.expand) : state.expanded.add(d.expand); makeItems(); renderWindow(); }
      if (d.context) { state.contexts.has(d.context) ? state.contexts.delete(d.context) : state.contexts.add(d.context); makeItems(); renderWindow(); }
      if (d.recent) { state.query = input.value = d.recent; input.focus(); runSearch(); }
      if (d.deleteRecent) { recent = recent.filter((q) => q !== d.deleteRecent); try { localStorage.setItem('rcs-design-preview:recent',JSON.stringify(recent)); } catch (_) {} runSearch(); }
      if (d.menu) { state[d.menu] = d.value; closePopover(); runSearch(); $(`${d.menu}-control`).focus(); }
      if (d.remove) { if (d.remove === 'date') { state.after = state.before = ''; } else if (d.remove === 'chat') state.chatId = ''; else state[d.remove] = 'all'; closePopover(); runSearch(); }
      if (d.dateMode) { dateMode = d.dateMode; dateStart = ''; renderCalendar(); }
      if (d.month) { const next = new Date(calendarYear,calendarMonth + Number(d.month),1); calendarMonth = next.getMonth(); calendarYear = next.getFullYear(); renderCalendar(); }
      if (d.date) selectDate(d.date);
      if (d.closePopover) closePopover();
      if (d.clearFilters) clearFilters();
      if (button.id === 'back-to-results') { $('chat-shell').classList.remove('show-room'); input.focus(); }
      if (button.id === 'room-search') { state.chatId = state.activeChat; state.query = input.value = ''; state.scope = 'messages'; $('chat-shell').classList.remove('show-room'); input.focus(); runSearch(); }
      if (button.id === 'room-info') announce('Conversation details are illustrative in this design preview.');
    }
    if (state.popover && !insidePopover) closePopover();
  });
  ['filter','from','date','sort'].forEach((name) => $(`${name}-control`).addEventListener('click',() => showPopover(name)));
  $('word-control').addEventListener('click',() => { state.wholeWord = !state.wholeWord; runSearch(); });
  $('clear-search').addEventListener('click',() => { state.query = input.value = ''; runSearch(); input.focus(); });
  function showLoading() { state.loading = true; controls(); renderWindow(); clearTimeout(loadingTimer); loadingTimer = setTimeout(() => { state.loading = false; runSearch(); announce('Saved results refreshed · synthetic preview'); },700); }
  $('refresh-results').addEventListener('click',showLoading);
  $('demo-loading').addEventListener('click',showLoading);
  $('minimize-chat').addEventListener('click',() => layout('minimized'));
  $('restore-chat').addEventListener('click',() => layout('floating'));
  $('minimized-search').addEventListener('click',() => { layout('floating'); input.focus(); });
  $('theme-toggle').addEventListener('click',() => { const dark = document.body.classList.toggle('dark'); $('theme-toggle').textContent = dark ? 'Light' : 'Dark'; $('theme-toggle').setAttribute('aria-label',`Switch to ${dark ? 'light' : 'dark'} theme`); });
  $('learn-why').addEventListener('click',() => $('coverage-dialog').showModal());
  $('close-help').addEventListener('click',() => $('coverage-dialog').close());
  $('room-composer').addEventListener('submit',(e) => e.preventDefault());
  $('search-icon').innerHTML = icon('search'); $('clear-search').innerHTML = icon('close'); $('refresh-results').innerHTML = icon('refresh'); $('minimize-chat').innerHTML = icon('minimize'); $('demo-loading').innerHTML = icon('history'); $('minimized-search').innerHTML = icon('search'); $('close-help').innerHTML = icon('close'); document.querySelector('.room-composer button').innerHTML = icon('send');
  window.addEventListener('resize',() => { renderWindow(); positionPopover(); });
  runSearch(); openChat(state.activeChat); $('chat-shell').classList.remove('show-room');
  // Exposed only to synthetic preview tests; contains no Reddit state.
  window.ChatPrototype = { state, runSearch, layout, openChat, navigate, closePopover };
}());
