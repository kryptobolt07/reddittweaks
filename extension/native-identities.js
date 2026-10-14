/* Page-world presentation hooks. Original profile objects and account flags stay intact. */
(() => {
  let owner='',people=new Map(),rooms=new Map(),signature='';
  const hooks=[];
  const hostsToRefresh=new Set();
  let contextProvider=null,identityClient=null,pending=false;
  let eventBinder=null;const boundEventHosts=new WeakSet();
  const placeholder=value=>typeof value==='string' && ['[deleted]','Someone'].includes(value.trim());
  function currentPerson(id,room=false) {
    return identityClient?.getUserId?.()===owner ? (room ? rooms : people).get(id) : undefined;
  }
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
        const value=original.apply(this,args);return pending && placeholder(value) ? '…' : value;
      }) || installed;
      installed=hook(users,'getAvatar',function(original,args){
        const person=currentPerson(args[0]);
        return person?.avatar ? person.avatarView : original.apply(this,args);
      }) || installed;
      installed=hook(users,'getRedditUser',function(original,args){
        const profile=original.apply(this,args),person=currentPerson(args[0]);
        return profile && (person || pending && placeholder(profile.displayName)) ? {...profile,displayName:person?.name || '…',...(person?.avatar?{avatar:{...profile.avatar,src:person.avatar,isSnoovatar:false,snoovatarSrc:undefined},snoovatarIcon:undefined}:{})} : profile;
      }) || installed;
    }
    installed=hook(host.roomController,'getDirectRoomUsername',function(original,args){
      const recovered=currentName(this.roomId || this.getRoom?.()?.roomId,true);if(recovered)return recovered;
      const value=original.apply(this,args);return pending && placeholder(value) ? '…' : value;
    }) || installed;
    if(host.tagName==='RS-USERNAME')installed=hook(host,'render',function(original,args){
      const recovered=currentName(this.getAttribute('user-id')) || (pending && placeholder(this.username) ? '…' : '');
      return recovered ? original.apply(new Proxy(this,{get:(target,key)=>key==='username' ? recovered : Reflect.get(target,key,target)}),args) : original.apply(this,args);
    }) || installed;
    if(host.tagName==='RS-USER-AVATAR')installed=hook(host,'render',function(original,args){
      const avatar=currentPerson(this.getAttribute('user-id'))?.avatar;
      // Supply presentation inputs only; preserve native membership/profile flags.
      return avatar && !this.isCommunityAgent ? original.apply(new Proxy(this,{get:(target,key)=>key==='icon'?avatar:key==='snoovatar'?null:Reflect.get(target,key,target)}),args) : original.apply(this,args);
    }) || installed;
    if(typeof host.requestUpdate==='function')hostsToRefresh.add(host);
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
    owner='';people.clear();rooms.clear();signature='';pending=false;identityClient=null;
    for(const {target,key,original,wrapper}of hooks.splice(0))if(target[key]===wrapper)target[key]=original;
    for(const host of hostsToRefresh)if(host.isConnected)host.requestUpdate?.();
    hostsToRefresh.clear();
  }
  function hook(object,key,replace) {
    if(!object || typeof object[key]!=='function')return false;
    let target=object;
    while(!Object.hasOwn(target,key) && Object.getPrototypeOf(target))target=Object.getPrototypeOf(target);
    if(hooks.some(h=>h.target===target && h.key===key))return false;
    const original=target[key];
    const wrapper=function(...args){return replace.call(this,original,args);};
    try{target[key]=wrapper;}catch{return false;}
    if(target[key]!==wrapper)return false;
    hooks.push({target,key,original,wrapper});return true;
  }
  function update(ctx,request) {
    if(!contextProvider)contextProvider=()=>ctx;
    const current=ctx.client.getUserId();
    if(request.owner && request.owner!==current)return;
    if(owner && owner!==current)clear();
    owner=current;identityClient=ctx.client;
    const valid=id=>typeof id==='string' && /^@[^:\s]+:[^\s]+$/.test(id) && id!==current;
    people=new Map((Array.isArray(request.people)?request.people:[]).filter(p=>valid(p?.id) && /^[A-Za-z0-9_-]{3,20}$/.test(p.name || '')).map(p=>{const avatar=safeAvatar(p.avatar),previous=people.get(p.id);return [p.id,previous?.name===p.name && previous.avatar===avatar?previous:{name:p.name,avatar,avatarView:{src:avatar,isSnoovatar:false}}];}));
    rooms=new Map((Array.isArray(request.rooms)?request.rooms:[]).filter(r=>typeof r?.id==='string' && r.id.length<=1000 && people.has(r.person)).map(r=>[r.id,people.get(r.person)]));
    const next=JSON.stringify([[...people],[...rooms]]),changed=pending!==Boolean(request.restoring) || signature!==next;signature=next;pending=Boolean(request.restoring);
    const hosts=ctx.all('*').filter(e=>e.tagName.startsWith('RS-'));
    for(const host of hostsToRefresh)if(!host.isConnected)hostsToRefresh.delete(host);
    for(const host of hosts) {
      const installed=bindHost(host);
      if(changed || installed)host.requestUpdate?.();
    }
    return {hooks:hooks.length};
  }
  document.addEventListener('rcs-native-identities-clear',clear);
  document.addEventListener('rcs-native-identities-start',()=>{pending=true;});
  globalThis.RCSNativeIdentities=Object.freeze({update,clear,configure});
})();
