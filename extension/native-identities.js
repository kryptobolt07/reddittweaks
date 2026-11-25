/* Page-world presentation hooks. Original profile objects and account flags stay intact. */
(() => {
  let owner='',people=new Map(),rooms=new Map(),signature='';
  const hookTargets=new WeakMap(),hookRefs=new Set();
  const hookRegistry=new FinalizationRegistry(ref=>hookRefs.delete(ref));
  let contextProvider=null,identityClient=null,identityAccount='',pending=false;
  let eventBinder=null;const boundEventHosts=new WeakSet();
  const placeholder=value=>typeof value==='string' && ['[deleted]','Someone'].includes(value.trim());
  // "…" only covers a short recovery window; after that Reddit's own label shows.
  const pendingMs=6000;let pendingSince=0,pendingTimer=null;
  const waiting=()=>pending && Date.now()-pendingSince<pendingMs;
  function refreshHosts() {
    for(const host of contextProvider?.()?.all('*') || [])if(host.isConnected && host.tagName.startsWith('RS-'))host.requestUpdate?.();
  }
  function setPending(value){
    const next=Boolean(value);if(next && !pending)pendingSince=Date.now();pending=next;clearTimeout(pendingTimer);
    if(pending)pendingTimer=setTimeout(refreshHosts,pendingMs+50);
  }
  // A deleted account's membership record in a room Reddit already loaded
  // usually keeps the name and avatar it had. Use it when no saved identity
  // exists (for example a browser where the extension never saw the person).
  const stateNames=new Map(),stateTtl=60000;
  function stateIdentity(id) {
    if(typeof id!=='string' || !/^@[^:\s]+:[^\s]+$/.test(id))return null;
    const cached=stateNames.get(id);if(cached && Date.now()-cached.at<stateTtl)return cached.value;
    let value=null;
    try{
      const client=identityClient || contextProvider?.()?.client;
      for(const room of client?.getRooms?.() || []) {
        const event=room.currentState?.getStateEvents?.('m.room.member',id);if(!event)continue;
        const content=event.getContent?.() || {},profile=(event.getUnsigned?.() || {})['m.relations']?.['com.reddit.profile'];
        const name=[profile?.username,content.displayname].map(v=>typeof v==='string'?v.replace(/^u\//i,'').trim():'').find(v=>/^[A-Za-z0-9_-]{3,20}$/.test(v) && !/^t2_/.test(v));
        if(name){const avatar=safeAvatar(typeof profile?.icon_url==='string'?profile.icon_url:'');value={name,avatar,avatarView:{src:avatar,isSnoovatar:false}};break;}
      }
    }catch{ /* Reddit's client model changed: keep its own label. */ }
    if(stateNames.size>500)stateNames.delete(stateNames.keys().next().value);
    stateNames.set(id,{value,at:Date.now()});return value;
  }
  const seenPlaceholder=new Set();
  function currentPerson(id,room=false) {
    return identityClient?.getUserId?.()===owner ? (room ? rooms : people).get(id) : undefined;
  }
  function fallbackPerson(id){return seenPlaceholder.has(id)?stateIdentity(id):null;}
  const currentName=(id,room=false)=>currentPerson(id,room)?.name;
  function safeAvatar(value){try{const url=new URL(value);return url.protocol==='https:' && !url.username && !url.password && !url.hash && ![...url.searchParams.keys()].some(key=>/token|auth|signature|credential|password|(?:^|[_-])key(?:$|[_-])/i.test(key))?url.href:'';}catch{return '';}}

  function bindHost(host) {
    if(host.tagName==='RS-TIMELINE-EVENT' && eventBinder) {
      try{eventBinder(host);}catch{ /* Keep Reddit usable if its event model changes. */ }
      if(!boundEventHosts.has(host) && typeof host.updated==='function') {
        const updated=host.updated,binder=eventBinder;
        host.updated=function(...args){const result=updated.apply(this,args);try{binder(this);}catch{}return result;};boundEventHosts.add(host);
      }
    }
    if(host.tagName==='RS-APP')document.dispatchEvent(new CustomEvent('rcs-chat-starting'));
    let installed=false;
    for(const users of [host.users,host.usersController]) {
      installed=hook(users,'getDisplayName',function(original,args){
        const recovered=currentName(args[0]);if(recovered)return recovered;
        const value=original.apply(this,args);if(!placeholder(value))return value;
        seenPlaceholder.add(args[0]);const kept=stateIdentity(args[0]);if(kept)return kept.name;
        return waiting() ? '…' : value;
      }) || installed;
      installed=hook(users,'getAvatar',function(original,args){
        const person=currentPerson(args[0]) || fallbackPerson(args[0]);
        return person?.avatar ? person.avatarView : original.apply(this,args);
      }) || installed;
      installed=hook(users,'getRedditUser',function(original,args){
        const profile=original.apply(this,args);let person=currentPerson(args[0]);
        if(!person && profile && placeholder(profile.displayName)){seenPlaceholder.add(args[0]);person=stateIdentity(args[0]);}
        return profile && (person || waiting() && placeholder(profile.displayName)) ? {...profile,displayName:person?.name || '…',...(person?.avatar?{avatar:{...profile.avatar,src:person.avatar,isSnoovatar:false,snoovatarSrc:undefined},snoovatarIcon:undefined}:{})} : profile;
      }) || installed;
    }
    installed=hook(host.roomController,'getDirectRoomUsername',function(original,args){
      const recovered=currentName(this.roomId || this.getRoom?.()?.roomId,true);if(recovered)return recovered;
      const value=original.apply(this,args);if(!placeholder(value))return value;
      const room=this.getRoom?.(),me=room?.client?.getUserId?.() || identityClient?.getUserId?.(),other=room?.getJoinedMembers?.()?.concat(room?.getMembersWithMembership?.('leave') || []).map(m=>m.userId).find(id=>id && id!==me);
      const kept=other && stateIdentity(other);if(kept){seenPlaceholder.add(other);return kept.name;}
      return waiting() ? '…' : value;
    }) || installed;
    if(host.tagName==='RS-USERNAME')installed=hook(host,'render',function(original,args){
      const id=this.getAttribute('user-id'),fallback=placeholder(this.username)?(seenPlaceholder.add(id),stateIdentity(id)?.name):'';
      const recovered=currentName(id) || fallback || (waiting() && placeholder(this.username) ? '…' : '');
      return recovered ? original.apply(new Proxy(this,{get:(target,key)=>key==='username' ? recovered : Reflect.get(target,key,target)}),args) : original.apply(this,args);
    }) || installed;
    if(host.tagName==='RS-USER-AVATAR')installed=hook(host,'render',function(original,args){
      const avatar=(currentPerson(this.getAttribute('user-id')) || fallbackPerson(this.getAttribute('user-id')))?.avatar;
      // Supply presentation inputs only; preserve native membership/profile flags.
      return avatar && !this.isCommunityAgent ? original.apply(new Proxy(this,{get:(target,key)=>key==='icon'?avatar:key==='snoovatar'?null:Reflect.get(target,key,target)}),args) : original.apply(this,args);
    }) || installed;
    return installed;
  }
  function configure(getContext,bindEvent) {
    contextProvider=getContext;
    eventBinder=typeof bindEvent==='function' ? bindEvent : null;
    // Register before Reddit defines its components: connectedCallback runs before Lit's first paint.
    const prepare=constructor=>{
      const proto=constructor.prototype,original=proto.connectedCallback;
      if(typeof original!=='function' || Object.hasOwn(proto,'__rcsConnect'))return;
      Object.defineProperty(proto,'__rcsConnect',{value:true});
      proto.connectedCallback=function(...args){bindHost(this);return original.apply(this,args);};
    };
    const define=customElements.define;
    customElements.define=function(name,constructor,...args){
      try{if(name.startsWith('rs-'))prepare(constructor);}catch{ /* Let Reddit register future incompatible components normally. */ }
      return define.call(this,name,constructor,...args);
    };
    for(const host of getContext().all('*').filter(e=>e.tagName.startsWith('RS-')))bindHost(host);
  }
  function clear() {
    owner='';people.clear();rooms.clear();signature='';setPending(false);identityClient=null;identityAccount='';stateNames.clear();seenPlaceholder.clear();
    for(const ref of hookRefs){
      hookRegistry.unregister(ref);
      const target=ref.deref();if(!target)continue;
      for(const [key,{original,wrapper}] of hookTargets.get(target))if(target[key]===wrapper)target[key]=original;
      hookTargets.delete(target);
    }
    hookRefs.clear();refreshHosts();
  }
  function setClient(client) {
    const account=client?.getUserId?.();
    if(account && account!==identityAccount){stateNames.clear();seenPlaceholder.clear();identityAccount=account;}
    identityClient=client;
  }
  function hook(object,key,replace) {
    if(!object || typeof object[key]!=='function')return false;
    let target=object;
    while(!Object.hasOwn(target,key) && Object.getPrototypeOf(target))target=Object.getPrototypeOf(target);
    let methods=hookTargets.get(target);
    if(methods?.has(key))return false;
    const original=target[key];
    const wrapper=function(...args){return replace.call(this,original,args);};
    try{target[key]=wrapper;}catch{return false;}
    if(target[key]!==wrapper)return false;
    if(!methods){
      methods=new Map();hookTargets.set(target,methods);
      const ref=new WeakRef(target);hookRefs.add(ref);hookRegistry.register(target,ref,ref);
    }
    methods.set(key,{original,wrapper});return true;
  }
  function update(ctx,request) {
    const current=ctx.client.getUserId();
    if(request.owner && request.owner!==current)return;
    if(owner && owner!==current)clear();
    owner=current;setClient(ctx.client);
    const valid=id=>typeof id==='string' && /^@[^:\s]+:[^\s]+$/.test(id) && id!==current;
    people=new Map((Array.isArray(request.people)?request.people:[]).filter(p=>valid(p?.id) && /^[A-Za-z0-9_-]{3,20}$/.test(p.name || '')).map(p=>{const avatar=safeAvatar(p.avatar),previous=people.get(p.id);return [p.id,previous?.name===p.name && previous.avatar===avatar?previous:{name:p.name,avatar,avatarView:{src:avatar,isSnoovatar:false}}];}));
    rooms=new Map((Array.isArray(request.rooms)?request.rooms:[]).filter(r=>typeof r?.id==='string' && r.id.length<=1000 && people.has(r.person)).map(r=>[r.id,people.get(r.person)]));
    const next=JSON.stringify([[...people],[...rooms]]),changed=pending!==Boolean(request.restoring) || signature!==next;signature=next;setPending(request.restoring);
    const hosts=ctx.all('*').filter(e=>e.tagName.startsWith('RS-'));
    for(const host of hosts) {
      const installed=bindHost(host);
      if(changed || installed)host.requestUpdate?.();
    }
    let hooks=0;
    for(const ref of hookRefs){const target=ref.deref();if(target)hooks+=hookTargets.get(target).size;else hookRefs.delete(ref);}
    return {hooks};
  }
  document.addEventListener('rcs-native-identities-clear',clear);
  document.addEventListener('rcs-native-identities-start',()=>setPending(true));
  globalThis.RCSNativeIdentities=Object.freeze({update,clear,configure,setClient});
})();
