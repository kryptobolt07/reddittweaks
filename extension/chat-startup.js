/* One bounded presentation hold; Reddit still owns the list, focus, scroll and sync. */
(() => {
  const A=globalThis.RCSAdapter;if(!A)return;
  globalThis.RCSChatStartup?.stop();
  let used=false,active=null;
  const restore=(element,name,value)=>value!==null ? element.setAttribute(name,value) : element.removeAttribute(name);
  function release(){
    const state=active;if(!state)return;active=null;
    clearTimeout(state.timer);clearTimeout(state.deadline);
    state.scroller.style.visibility=state.visibility;
    restore(state.scroller,'aria-busy',state.busy);
    state.nav.style.position=state.position;state.host.remove();
    window.removeEventListener('pagehide',release);document.removeEventListener('visibilitychange',hidden);
  }
  function hidden(){if(document.hidden)release();}
  function ready(row){
    const named=Boolean(A.text(A.query(A.selectors.name,row)));
    const icon=A.query('rs-room-icon',row),avatar=icon && A.query('[avatar]',icon);
    return {named,avatar:Boolean(avatar) && A.queryAll('img',avatar).every(img=>img.complete)};
  }
  function sample(){
    const state=active;if(!state)return;
    if(!state.scroller.isConnected || document.hidden || (globalThis.chrome?.runtime && !chrome.runtime.id)){release();return;}
    const bounds=state.scroller.getBoundingClientRect();
    if(!bounds.width || !bounds.height){release();return;}
    const rows=A.queryAll(A.selectors.row,state.scroller).filter(row=>{const r=row.getBoundingClientRect();return r.height>0 && r.bottom>bounds.top && r.top<bounds.bottom;});
    const order=rows.map(row=>row.getAttribute('room') || row.getAttribute('room-id') || A.text(A.query(A.selectors.name,row))).join('\n');
    const now=Date.now();if(order!==state.order){state.order=order;state.stable=now;}
    const values=rows.map(ready);
    if(now-state.stable>=300 && values.every(v=>v.named) && (values.every(v=>v.avatar) || now-state.stable>=1500)){release();return;}
    // This timer ends with the first startup; there is no ongoing observer or sync loop.
    state.timer=setTimeout(sample,50);
  }
  function check(roots){
    if(used || document.hidden)return;
    const nav=roots.flatMap(root=>[...(root.matches?.(A.selectors.list)?[root]:[]),...root.querySelectorAll(A.selectors.list)]).find(A.visible);
    if(!nav)return;
    const scroller=A.query('rs-virtual-scroll',nav);if(!scroller)return;
    const bounds=scroller.getBoundingClientRect(),frame=nav.getBoundingClientRect();
    if(!bounds.width || !bounds.height)return;
    used=true;endDiscovery();
    const host=document.createElement('div');host.setAttribute('data-rcs-ui','startup');host.setAttribute('aria-hidden','true');host.inert=true;
    host.style.cssText=`position:absolute;pointer-events:none;overflow:hidden;z-index:1;top:${bounds.top-frame.top+nav.scrollTop}px;left:${bounds.left-frame.left}px;width:${bounds.width}px;height:${bounds.height}px;`;
    const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');
    style.textContent=`:host{display:block}.row{display:flex;align-items:center;box-sizing:border-box;min-height:var(--rcs-row-min-height,60px);padding:var(--rcs-row-padding-block,8px) var(--rcs-row-padding-inline,12px);gap:var(--rcs-row-gap,8px)}.avatar{width:var(--rcs-row-avatar-size,32px);height:var(--rcs-row-avatar-size,32px);border-radius:50%;flex:none}.copy{flex:1;display:flex;flex-direction:column;gap:8px}.line{height:12px;width:55%;border-radius:4px}.preview{width:86%;height:11px}.shimmer{display:block;background:var(--color-shimmer-background,var(--color-neutral-background-hover,#e5ebee));animation:pulse 1.4s ease-in-out infinite}@keyframes pulse{50%{opacity:.45}}@media(prefers-reduced-motion:reduce){.shimmer{animation:none}}`;
    shadow.append(style);
    const metrics=A.chatListMetrics(nav);for(const [key,value] of Object.entries(metrics || {}))host.style.setProperty(key,value);
    const height=parseFloat(metrics?.['--rcs-row-min-height']) || 60;
    const nativeShimmer=Boolean(globalThis.customElements?.get('faceplate-shimmer')) && !globalThis.matchMedia?.('(prefers-reduced-motion:reduce)').matches;
    function shimmer(cls){
      let element;if(nativeShimmer){const template=document.createElement('template');template.innerHTML='<faceplate-shimmer shape="pill" aria-hidden="true"></faceplate-shimmer>';element=template.content.firstElementChild;}else element=document.createElement('span');
      element.className=cls+' shimmer';return element;
    }
    for(let i=0;i<Math.min(30,Math.ceil(bounds.height/height));i++){
      const row=document.createElement('div'),avatar=shimmer('avatar'),copy=document.createElement('span'),title=shimmer('line'),preview=shimmer('line preview');
      row.className='row';copy.className='copy';copy.append(title,preview);row.append(avatar,copy);shadow.append(row);
    }
    active={nav,scroller,host,visibility:scroller.style.visibility,position:nav.style.position,busy:scroller.getAttribute('aria-busy'),stable:Date.now(),order:null};
    if(getComputedStyle(nav).position==='static' || !getComputedStyle(nav).position)nav.style.position='relative';
    scroller.style.visibility='hidden';scroller.setAttribute('aria-busy','true');scroller.after(host);
    window.addEventListener('pagehide',release);document.addEventListener('visibilitychange',hidden);
    active.deadline=setTimeout(release,4500);sample();
  }
  // Discover the first shadow-hydrated list before document_idle controls run.
  // Observe only candidate chat roots; timer probing is bounded to hydration.
  let discoveryTimer=0,queued=false,hydrationUntil=0;
  const watched=new Set(),observers=[];
  // Only chat elements or a floating-chat shell position: Reddit's posts and players also have shadow roots, and treating
  // every one as a candidate re-ran discovery on each batch of posts while scrolling (measured 2026-11-19).
  const candidate=node=>A.chatNode?A.chatNode(node):node.nodeType===1 && (node.localName?.startsWith('rs-') || node.matches?.('[data-testid="chat-room-list"]'));
  function endDiscovery(){clearTimeout(discoveryTimer);for(const observer of observers)observer.disconnect();observers.length=0;watched.clear();document.removeEventListener('rcs-chat-present',wake);document.removeEventListener('rcs-chat-starting',wake);if(onSettingsMessage)try{chrome.runtime?.onMessage?.removeListener(onSettingsMessage);}catch{}}
  function discover(){
    queued=false;clearTimeout(discoveryTimer);if(used)return;
    const roots=A.chatRoots();check(roots);if(used)return;
    // The floating shell is in every page even with chat closed; only an open chat app has a list to catch. Opening
    // chat announces itself (rcs-chat-present), so a closed shell is neither watched nor polled (measured 2026-11-19).
    if(!roots.some(root=>root.querySelector?.('rs-app, rs-rooms-nav, [data-testid="chat-room-list"]')))return;
    for(const root of roots)if(!watched.has(root)){
      watched.add(root);const observer=new MutationObserver(wake);observer.observe(root,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class','style']});observers.push(observer);
    }
    if(roots.length && Date.now()<hydrationUntil)discoveryTimer=setTimeout(discover,100);
  }
  function wake(){if(used || queued)return;hydrationUntil=Date.now()+4500;queued=true;queueMicrotask(discover);}
  let onSettingsMessage=null;
  const documentObserver=new MutationObserver(records=>{
    if(records.some(record=>!globalThis.RTPostMenuDOM?.isMenuMutation(record) && [...record.addedNodes].some(candidate)))wake();
  });
  documentObserver.observe(document,{childList:true,subtree:true});observers.push(documentObserver);
  document.addEventListener('rcs-chat-present',wake);document.addEventListener('rcs-chat-starting',wake);
  const stop=()=>{used=true;release();endDiscovery();};
  if(globalThis.chrome?.runtime?.id && chrome.runtime.sendMessage){
    onSettingsMessage=(message,sender)=>{
      if(sender?.id===chrome.runtime.id && message?.scope==='rt-posts' && message.action==='settings-changed' && message.settings?.chatSearch===false)stop();
    };
    try{chrome.runtime.onMessage?.addListener(onSettingsMessage);}catch{}
    Promise.resolve().then(()=>chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings'})).then(response=>{
      if(response?.ok && response.settings?.chatSearch===false)stop();
    },()=>{});
  }
  globalThis.RCSChatStartup=Object.freeze({check,stop});
  queueMicrotask(wake);
})();
