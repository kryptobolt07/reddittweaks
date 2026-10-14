/* Presentation only. Stable room/sender bindings come from the native client. */
(() => {
  const A=RCSAdapter;
  const patches=new Set(),attributePatches=new Set(),badges=new Map();
  let generation=0,inFlight=null;
  const placeholders=new Set(['[deleted]','Someone']);
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
        setAttribute(scope,element,'aria-description','Unavailable account',person.id);
      }
    }
    let badge=badges.get(scope);
    if(!badge) {
      badge=document.createElement('span');badge.setAttribute('data-rcs-ui','identity-status');
      badge.textContent=' Unavailable';badge.title='Unavailable account · Retained username';
      badge.style.cssText='font-size:11px;font-weight:400;color:var(--color-neutral-content-weak,#829198);margin-inline-start:6px;white-space:nowrap;';
      badges.set(scope,badge);
    }
    if(badge.parentNode!==anchor)anchor.append(badge);
  }
  async function update(directory,index,owner,restoring=false) {
    if(inFlight || !globalThis.RCSData)return;
    const epoch=generation;
    inFlight=(async()=>{
      const people=new Map(),rooms=new Map();
      for(const record of directory.values()) {
        for(const person of record.identities || [])if(eligible(person))people.set(person.id,person);
        if(record.type==='direct' && record.accountUnavailable && record.historicalName && record.participantIds?.length===1) {
          const person={id:record.participantIds[0],name:record.name,avatar:record.avatar || '',accountUnavailable:true,historicalName:true};
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
      for(const root of A.chatRoots()) {
        for(const row of root.querySelectorAll(A.selectors.row)) {
          const record=A.conversation(row);label(row,A.query(A.selectors.name,row),rooms.get(record.id));
        }
        for(const room of root.querySelectorAll(A.selectors.room)) {
          const id=A.roomKey(room),header=A.query(A.selectors.header,room);
          if(header)label(header,header,rooms.get(id));
          for(const intro of A.queryAll(A.selectors.introduction,room))label(intro,A.query('.font-semibold, [data-testid="room-name"]',intro),rooms.get(id));
          for(const message of A.messages(room,{includeNontext:true})) {
            const sender=message.sender || index.rooms.get(id)?.get(message.id)?.sender;
            label(message.element,A.query(A.selectors.author,message.element),people.get(sender));
          }
        }
      }
    })().catch(()=>{}).finally(()=>{inFlight=null;});
    await inFlight;
  }
  globalThis.RCSNativeLabels=Object.freeze({update,clear});
})();
