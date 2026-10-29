/* Presentation only. Stable room/sender bindings come from the native client. */
(() => {
  const A=RCSAdapter;
  const patches=new Set(),attributePatches=new Set(),badges=new Map();
  let generation=0,inFlight=null;
  const placeholders=new Set(['[deleted]','Someone']);
  const previewSelector='.last-message,.preview,[data-testid="last-message"]',iconSize=14;
  const svgNS='http://www.w3.org/2000/svg';
  // Deleted, banned or merely unavailable: one compact, labelled icon. Wording and glyphs live in the directory model.
  function describe(person) {
    return globalThis.RCSDirectoryModel?.accountMarker?.(person.accountState,person.historicalName) ||
      {kind:'unavailable',label:'Unavailable account',title:'Unavailable account · Retained username',path:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 12-7m1 3 5 5m0-5-5 5"/>'};
  }
  function buildBadge(person) {
    const marker=describe(person),badge=document.createElement('span');
    badge.setAttribute('data-rcs-ui','identity-status');badge.dataset.kind=marker.kind;badge.setAttribute('role','img');
    badge.setAttribute('aria-label',marker.label);badge.title=marker.title;
    const icon=document.createElementNS(svgNS,'svg');
    for(const [key,value]of Object.entries({viewBox:'0 0 24 24',width:iconSize,height:iconSize,fill:'none',stroke:'currentColor','stroke-width':1.8,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}))icon.setAttribute(key,value);
    icon.innerHTML=marker.path;badge.append(icon);
    badge.style.cssText='display:inline-flex;align-items:center;justify-content:center;flex:none;width:'+iconSize+'px;height:'+iconSize+'px;color:var(--color-neutral-content-weak,#829198);line-height:0;';
    return badge;
  }
  // The icon lives on the row's meta line, right-aligned. In a flex line it is one more item that pushes itself to
  // the end; otherwise it floats over the row's right edge, leaving the row's own box (and its height) untouched.
  function placeInRow(scope,badge,person) {
    const preview=A.query(previewSelector,scope),line=preview?.parentElement,flex=line && /flex/.test(getComputedStyle(line).display);
    if(flex) {
      badge.style.marginInlineStart='auto';badge.style.position='';badge.style.top=badge.style.insetInlineEnd='';
      if(preview.nextSibling!==badge)preview.after(badge);return;
    }
    const frame=A.query('.container,a',scope) || scope,anchor=preview || A.query(A.selectors.name,scope) || frame;
    if(getComputedStyle(frame).position==='static')setAttribute(scope,frame,'style',(frame.getAttribute('style') || '')+';position:relative;',person.id);
    const box=anchor.getBoundingClientRect(),outer=frame.getBoundingClientRect();
    badge.style.cssText+='position:absolute;inset-inline-end:12px;margin:0;top:'+Math.max(0,Math.round(box.top-outer.top+(box.height-iconSize)/2))+'px;';
    // Keep the preview's text clear of the icon without changing its box.
    if(preview && !patchedPadding(scope,preview))setAttribute(scope,preview,'style',(preview.getAttribute('style') || '')+';padding-inline-end:'+(iconSize+16)+'px;box-sizing:border-box;',person.id);
    if(badge.parentNode!==frame)frame.append(badge);
  }
  const patchedPadding=(scope,node)=>[...attributePatches].some(patch=>patch.scope===scope && patch.target===node && patch.key==='style');
  function restore(patch) {
    if(patch.node.data===patch.replacement)patch.node.data=patch.original;
    patches.delete(patch);
  }
  function restoreScope(scope) {
    for(const patch of patches)if(patch.scope===scope)restore(patch);
    for(const patch of [...attributePatches])if(patch.scope===scope)restoreAttribute(patch);
    badges.get(scope)?.remove();badges.delete(scope);
  }
  function clear() {
    generation++;
    document.dispatchEvent(new CustomEvent('rcs-native-identities-clear'));
    for(const patch of [...patches])restore(patch);
    for(const patch of [...attributePatches])restoreAttribute(patch);
    for(const badge of badges.values())badge.remove();badges.clear();
    globalThis.RCSDirectory?.classify?.('native',[]);
  }
  function restoreAttribute(patch) {
    if(patch.target.getAttribute(patch.key)===patch.replacement) {
      patch.original===null ? patch.target.removeAttribute(patch.key) : patch.target.setAttribute(patch.key,patch.original);
    }
    attributePatches.delete(patch);
  }
  function setAttribute(scope,target,key,replacement,person) {
    if(target.getAttribute(key)===replacement)return;
    attributePatches.add({scope,target,key,original:target.getAttribute(key),replacement,person});
    target.setAttribute(key,replacement);
  }
  function eligible(person) {
    return person?.accountUnavailable && person.historicalName && /^[A-Za-z0-9_-]{3,20}$/.test(person.name || '');
  }
  function label(scope,target,person) {
    if(!target || !person){restoreScope(scope);return;}
    for(const patch of [...patches])if(patch.scope===scope && patch.person!==person.id)restore(patch);
    for(const patch of [...attributePatches])if(patch.scope===scope && patch.person!==person.id)restoreAttribute(patch);
    let anchor=null;
    for(const root of A.roots(target)) {
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      let text;
      while((text=walker.nextNode())) {
        if(text.parentElement?.closest('style,script,[data-rcs-ui]'))continue;
        const value=text.data.trim();
        if(placeholders.has(value)) {
          const replacement=text.data.replace(value,person.name);
          patches.add({scope,node:text,original:text.data,replacement,person:person.id});
          text.data=replacement;if(!anchor || !A.visible(anchor))anchor=text.parentElement;
        } else if(value===person.name && (!anchor || !A.visible(anchor)))anchor=text.parentElement;
      }
    }
    if(!anchor){restoreScope(scope);return;}
    for(const element of [scope,...A.queryAll('a[aria-label], [aria-label^="Current chat"]',scope)]) {
      const value=element.getAttribute('aria-label');
      if(value && (value.startsWith('Direct chat with ') || value.startsWith('Current chat,') || value.startsWith('View profile of user ') || value.startsWith('[deleted] said '))) {
        const replacement=value.replace('[deleted]',person.name);
        if(replacement!==value)setAttribute(scope,element,'aria-label',replacement,person.id);
        setAttribute(scope,element,'aria-description',describe(person).label,person.id);
      }
    }
    const row=scope.matches?.(A.selectors.row),kind=describe(person).kind;
    let badge=badges.get(scope);
    if(badge && badge.dataset.kind!==kind){badge.remove();badges.delete(scope);badge=null;}
    if(!badge){badge=buildBadge(person);badges.set(scope,badge);}
    if(row)placeInRow(scope,badge,person);
    else {badge.style.marginInlineStart='6px';badge.style.verticalAlign='middle';if(badge.parentNode!==anchor)anchor.append(badge);}
  }
  async function update(directory,index,owner,restoring=false) {
    if(inFlight || !globalThis.RCSData)return;
    const epoch=generation;
    inFlight=(async()=>{
      const people=new Map(),rooms=new Map();
      for(const record of directory.values()) {
        for(const person of record.identities || [])if(eligible(person))people.set(person.id,person);
        if(record.type==='direct' && record.accountUnavailable && record.historicalName && record.participantIds?.length===1) {
          const person={id:record.participantIds[0],name:record.name,avatar:record.avatar || '',accountUnavailable:true,historicalName:true,accountState:record.accountState || ''};
          if(eligible(person)){people.set(person.id,people.get(person.id)||person);rooms.set(record.id,people.get(person.id));}
        }
      }
      if(!people.size && !restoring){clear();return;}
      const bindings=await RCSData.request('native-bindings',{owner,
        people:[...people.values()].map(p=>({id:p.id,name:p.name,avatar:p.avatar || ''})),rooms:[...rooms].map(([id,p])=>({id,person:p.id})),restoring}).promise;
      if(epoch!==generation || owner && bindings.owner!==owner)return;
      for(const patch of [...patches])if(!patch.node.isConnected)restore(patch);
      for(const patch of [...attributePatches])if(!patch.target.isConnected)restoreAttribute(patch);
      for(const [scope,badge]of badges)if(!scope.isConnected){badge.remove();badges.delete(scope);}
      const onScreen=new Set();
      for(const root of A.chatRoots()) {
        for(const row of root.querySelectorAll(A.selectors.row)) {
          const record=A.conversation(row),person=rooms.get(record.id);label(row,A.query(A.selectors.name,row),person);
          if(person && A.visible(row))onScreen.add(person);
        }
        for(const room of root.querySelectorAll(A.selectors.room)) {
          const id=A.roomKey(room),header=A.query(A.selectors.header,room);
          if(header)label(header,header,rooms.get(id));
          if(rooms.has(id) && A.visible(room))onScreen.add(rooms.get(id));
          for(const intro of A.queryAll(A.selectors.introduction,room))label(intro,A.query('.font-semibold, [data-testid="room-name"]',intro),rooms.get(id));
          for(const message of A.messages(room,{includeNontext:true})) {
            const sender=message.sender || index.rooms.get(id)?.get(message.id)?.sender;
            label(message.element,A.query(A.selectors.author,message.element),people.get(sender));
          }
        }
      }
      // Only people on screen are classified (deleted vs banned); the page world throttles and remembers the answer.
      globalThis.RCSDirectory?.classify?.('native',[...onScreen].filter(person=>!person.accountState).map(person=>person.id));
    })().catch(()=>{}).finally(()=>{inFlight=null;});
    await inFlight;
  }
  globalThis.RCSNativeLabels=Object.freeze({update,clear});
})();
