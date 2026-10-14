/* DOM adapter: deliberately scoped to Reddit's chat custom elements. */
(() => {
  const selectors = {
    list: 'rs-rooms-nav, rs-room-list, rs-room-list-panel, [data-testid="chat-room-list"]',
    row: 'rs-rooms-nav-room, rs-room-list-item, [data-testid="chat-room-list-item"]',
    room: 'rs-room, [data-testid="chat-room"]',
    header: 'main > header, rs-room-header, [data-testid="chat-room-header"]',
    message: 'rs-timeline-event, [data-testid="chat-message"]',
    body: '.room-message-text, rs-text-message, rs-message-content, .message-body, .message-text, .message-content, [data-testid="message-content"]',
    name: '.room-name, [data-testid="room-name"], .username-text',
    author: '.user-name, rs-username, rs-timeline-event-hovercard-display-name, .username-text, [data-testid="message-author"]',
    introduction: 'rs-room-info',
    scroller: 'rs-virtual-scroll-dynamic, rs-virtual-scroll, [data-testid="message-scroller"]'
  };
  function roots(root) {
    const output = root.shadowRoot ? [root,root.shadowRoot] : [root];
    for (let i = 0; i < output.length; i++) {
      for (const element of output[i].querySelectorAll('*')) {
        if (element.hasAttribute('data-rcs-ui')) continue;
        if (element.shadowRoot) output.push(element.shadowRoot);
      }
    }
    return output;
  }
  function chatRoots() {
    // The floating chat's shell is an otherwise anonymous div with a shadow root.
    // Inspect these shallow shell candidates instead of walking the feed's post roots.
    const direct = document.querySelector('rs-app, rs-room, [data-testid="chat-room-list"], [data-testid="chat-room"]');
    const shells = [...document.querySelectorAll('div')].filter(element =>
      element.shadowRoot?.querySelector('#resizable, button[aria-label="Maximize chat view"]'));
    const scopes = [...(direct ? [direct] : []), ...shells];
    return [...new Set(scopes.flatMap(roots))];
  }
  function queryAll(selector, root = document) { return roots(root).flatMap(part => [...part.querySelectorAll(selector)]); }
  const query = (selector, root) => queryAll(selector, root)[0] ?? null;
  function text(element) {
    if (!element) return '';
    if (element.nodeType === 3) return element.textContent;
    if (element.shadowRoot) return text(element.shadowRoot);
    return [...element.childNodes].map(node => {
      if (node.nodeType === 3) return node.textContent;
      if (node.nodeType !== 1 || node.matches('style, script, button, [data-rcs-ui]')) return '';
      if (node.tagName === 'SLOT') {
        const assigned = node.assignedNodes({flatten:true});
        return assigned.length ? assigned.map(text).join(' ') : text(node);
      }
      return text(node);
    }).join(' ').replace(/\s+/g, ' ').trim();
  }
  function visible(element) {
    if (!element.isConnected) return false;
    for (let current = element; current; current = current.parentElement || current.getRootNode().host) {
      const style = getComputedStyle(current);
      if (current.hidden || style.display === 'none' || style.visibility === 'hidden') return false;
    }
    return true;
  }
  function conversation(row) {
    const name = text(query(selectors.name, row)) || row.getAttribute('display-name') || row.getAttribute('room-name') || '';
    const link = query('a[href]', row);
    const raw = link?.getAttribute('href');
    let href = '';
    if (raw) {
      const url = new URL(raw, location.href);
      if (/^(www\.|chat\.)?reddit\.com$/.test(url.hostname) && url.protocol === 'https:') href = url.href;
    }
    const image=query('img, image',row);
    const avatar=image?.getAttribute('src') || image?.getAttribute('href') || '';
    let roomId='';
    if(href){const match=/\/(?:chat\/)?room\/([^/]+)/.exec(new URL(href).pathname);if(match)try{roomId=decodeURIComponent(match[1]);}catch{}}
    return {id: row.getAttribute('room') || row.getAttribute('room-id') || roomId || row.getAttribute('data-rcs-room-id') || href || name, name, href, avatar, element: row, link};
  }
  const appearanceRows = new WeakMap();
  function chatListMetrics(container) {
    let refs=appearanceRows.get(container);
    if(!refs?.name?.isConnected || !refs.frame?.isConnected || refs.frame.classList.contains('has-notifications') || ['preview','time','body','avatar'].some(key=>refs[key] && !refs[key].isConnected)){
      const rows=queryAll(selectors.row,container),row=rows.find(row=>!query('.has-notifications',row)) || rows[0];
      if(!row)return null;
      const name=query(selectors.name,row);if(!name)return null;
      const icon=query('rs-room-icon',row);
      refs={frame:query('.container,a',row) || row,name,preview:query('.last-message,.preview,[data-testid="last-message"]',row),time:query('.last-message-time,time,[data-testid="last-message-time"]',row),body:query('.body,.copy',row),avatar:query('.avatar,img,image',icon || row)};
      appearanceRows.set(container,refs);
    }
    const values={},frame=getComputedStyle(refs.frame);
    const font=(element,key)=>{
      if(!element)return;const style=getComputedStyle(element),size=parseFloat(style.fontSize);if(!size)return;
      const height=parseFloat(style.lineHeight) || size*1.5,family=style.fontFamily || frame.fontFamily || 'Arial,sans-serif';
      values['--rcs-row-'+key+'-font']=`${style.fontStyle || 'normal'} 400 ${size}px/${height}px ${family}`;
      values['--rcs-row-'+key+'-size']=size+'px';values['--rcs-row-'+key+'-line-height']=height+'px';
      if(style.color)values['--rcs-row-'+key+'-color']=style.color;
    };
    font(refs.name,'title');font(refs.preview || refs.name,'preview');font(refs.time,'time');
    const length=(value,key)=>{const number=parseFloat(value);if(Number.isFinite(number) && number>=0)values['--rcs-row-'+key]=number+'px';};
    const rowHeight=Math.max(parseFloat(frame.minHeight) || 0,refs.frame.offsetHeight || (/px$/.test(frame.height)?parseFloat(frame.height):0) || 0);if(rowHeight>0)length(rowHeight,'min-height');length(frame.paddingTop,'padding-block');length(frame.paddingLeft,'padding-inline');length(frame.columnGap || frame.gap,'gap');
    if(refs.body){const body=getComputedStyle(refs.body);length(body.rowGap || body.gap,'body-gap');}
    if(refs.avatar){const avatar=getComputedStyle(refs.avatar),size=parseFloat(avatar.width) || refs.avatar.offsetWidth;if(size>0)values['--rcs-row-avatar-size']=size+'px';}
    return values;
  }
  function roomKey(room) {
    return room.getAttribute('room') || room.getAttribute('room-id') || room.getAttribute('channel-id') || room.getAttribute('data-room-id') || room.getAttribute('data-rcs-room-id') ||
      query('[room-id]', room)?.getAttribute('room-id') ||
      text(query(selectors.header, room)) || location.pathname;
  }
  function messages(room, {includeNontext=false}={}) {
    return queryAll(selectors.message, room).map(element => {
      const body = query(selectors.body, element);
      const messageText = text(body);
      const author = text(query(selectors.author, element));
      const photo=query('.user-avatar img, .user-avatar image, rs-user-avatar img, rs-user-avatar image',element);
      const avatar=photo?.getAttribute('src') || photo?.getAttribute('href') || photo?.getAttribute('xlink:href') || undefined;
      const time = query('time', element);
      const timestamp = time?.getAttribute('datetime') || time?.textContent?.trim() || '';
      const stableId=element.getAttribute('data-id') || element.getAttribute('event-id') || element.getAttribute('message-id') || element.getAttribute('data-event-id') || element.getAttribute('data-rcs-event-id') || element.id;
      const id = stableId || `${author}\u0000${timestamp}\u0000${messageText}`;
      const binding=element.getAttribute('data-rcs-event-id');
      const bound=!binding || binding===id;
      return {id, text: messageText, author, avatar, sender:bound ? element.getAttribute('data-rcs-sender') || undefined : undefined,
        authorSelf:bound && element.hasAttribute('data-rcs-author-self') ? element.getAttribute('data-rcs-author-self')==='true' : undefined,
        provisional:element.localName==='rs-timeline-event' && !stableId,timestamp,element};
    }).filter(message => includeNontext || message.text);
  }
  function mountPoint(container, headerSelector) {
    const root = container.shadowRoot || container;
    const native = container.localName?.startsWith('rs-');
    const defined = native && Boolean(globalThis.customElements?.get(container.localName));
    let header = headerSelector && query(headerSelector, container);
    // The current native sidebar calls its header a nav filter. Older clients
    // and synthetic fixtures still use a list header or an ordinary nav head.
    if (!header && headerSelector && /rs-room-list-header/.test(headerSelector)) {
      header = query('rs-rooms-nav-filter', container);
      if (!header && !defined) header = query('.nav-head', container);
    }
    if (header) {
      const contentHeader = header;
      const nativeHeader = header.localName?.startsWith('rs-');
      // Native nav filters may sit inside a header wrapper or its shadow root.
      // Mount beside that wrapper, never inside the native toolbar.
      if (header.localName === 'rs-rooms-nav-filter') {
        while (header.parentNode !== root) {
          const parent = header.parentElement || header.getRootNode().host;
          if (!parent || parent === container) break;
          header = parent;
        }
      }
      let ready = true;
      // Explicit native header placeholders can arrive before registration.
      // They still need content and geometry; only generic fixture headers
      // bypass native readiness checks when their container is unregistered.
      if (defined || nativeHeader) {
        const rect = header.getBoundingClientRect();
        const rendered = rect.width > 0 && rect.height > 0;
        const populated = Boolean(text(contentHeader) || query('button, input, a[href], [role="button"]', contentHeader));
        ready = visible(header) && rendered && populated;
      }
      return {parent: header.parentNode, before: header.nextSibling, ready, header};
    }
    const scroll = query(selectors.scroller + ', rs-virtual-scroll, rs-room-list-scroll, [role="list"]', container);
    // Coordinates remain usable while the native element hydrates, but callers
    // must keep search hidden until its actual header has been laid out.
    const ready = !native || !headerSelector;
    if (scroll) return {parent: scroll.parentNode, before: scroll, ready, header: null};
    return {parent: root, before: root.firstChild, ready, header: null};
  }
  const searchHeaders = new WeakMap();
  function releaseSearchLayer(host) {
    const saved=searchHeaders.get(host);if(!saved)return;
    for(const [property,value,priority,applied] of saved.styles)if(saved.header.style.getPropertyValue(property)===applied){
      if(value)saved.header.style.setProperty(property,value,priority);else saved.header.style.removeProperty(property);
    }
    searchHeaders.delete(host);
  }
  function syncSearchLayer(container,host,headerSelector) {
    let header=query(headerSelector,container);
    while(header && header.parentNode!==host.parentNode)header=header.parentElement || header.getRootNode().host;
    if(header===host || !header?.style)header=null;
    if(searchHeaders.get(host)?.header===header)return;
    releaseSearchLayer(host);if(!header)return;
    const computed=getComputedStyle(header),styles=[];
    const set=(property,value)=>{styles.push([property,header.style.getPropertyValue(property),header.style.getPropertyPriority(property),value]);header.style.setProperty(property,value);};
    // Search is above the native list (layer 1); only the header owns layer 2.
    // Preserve higher native layers and restore our overrides on unmount.
    if((header.style.position || computed.position)==='static')set('position','relative');
    if(!(Number(header.style.zIndex || computed.zIndex)>=2))set('z-index','2');
    searchHeaders.set(host,{header,styles});
  }
  function scrollContainer(room) {
    const candidates = queryAll(selectors.scroller + ', [class*="scroll"]', room);
    for (const candidate of candidates) {
      for (const element of [candidate, ...queryAll('*', candidate)]) {
        const style = getComputedStyle(element);
        if (element.scrollHeight > element.clientHeight + 8 && /auto|scroll/.test(style.overflowY)) return element;
      }
    }
    return null;
  }
  globalThis.RCSAdapter = Object.freeze({selectors, roots, chatRoots, query, queryAll, text, visible, conversation, chatListMetrics, roomKey, messages, mountPoint, syncSearchLayer, releaseSearchLayer, scrollContainer});
})();
