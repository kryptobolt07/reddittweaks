(() => {
  const shell=document.getElementById('shell');let api;let compact=new URL(location.href).searchParams.has('compact');
  function loadedMessagesPreview(api) {
    // These synthetic events are the visible native tails, not the archived
    // messages the history endpoint exposes only after an explicit search.
    const client=api.app.querySelector('rs-matrix-client').client;
    const getRooms=client.getRooms,getRoom=client.getRoom;
    const augment=room=>room && {...room,
      getLiveTimeline:()=>({getEvents:()=>api.remoteMessages.get(room.roomId).slice(1).map(event=>({event}))}),
      getMembers:()=>[{userId:`@t2_${room.roomId}:reddit.com`,rawDisplayName:room.name,getMxcAvatarUrl:()=> 'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_1.png'}]
    };
    client.getRooms=()=>getRooms().map(augment);client.getRoom=id=>augment(getRoom(id));
  }
  function mediaPreview(api){
    if(!new URL(location.href).searchParams.has('media'))return;
    const types=[['image','m.image','image/png'],['gif','m.image','image/gif'],['video','m.video','video/mp4'],['audio','m.audio','audio/ogg'],['file','m.file','application/pdf']];
    for(const [kind,msgtype,mimetype] of types){const event={event_id:'demo-media-'+kind,room_id:'alex',type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:1791432600000,content:{msgtype,body:'Review '+kind+' attachment',info:{mimetype}}};api.remoteMessages.get('alex').push(event);api.appendMessage('alex_morgan',event.content.body,event.event_id);}
    const event={event_id:'demo-media-link',room_id:'alex',type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:1791432600000,content:{msgtype:'m.text',body:'Review link https://example.com/'+ 'section-'.repeat(24)+'target'}};api.remoteMessages.get('alex').push(event);api.appendMessage('alex_morgan',event.content.body,event.event_id);
  }
  function unavailablePreview(api) {
    if(!new URL(location.href).searchParams.has('unavailable'))return;
    const rows=api.nav.shadowRoot.querySelector('rs-virtual-scroll').shadowRoot.querySelectorAll('rs-rooms-nav-room');
    const row=rows[0],users=row.users,profile=users.getRedditUserById;
    users.getRedditUserById=async id=>id==='t2_alex'?{name:'[deleted]',isDeleted:true}:profile(id);
    row.shadowRoot.querySelector('.room-name').textContent='[deleted]';row.shadowRoot.querySelector('a').setAttribute('aria-label','Direct chat with [deleted]');
    api.room.shadowRoot.querySelector('header .name').textContent='[deleted]';
    const timeline=api.room.shadowRoot.querySelector('rs-timeline').shadowRoot.querySelector('rs-virtual-scroll-dynamic').shadowRoot;
    for(const event of timeline.querySelectorAll('rs-timeline-event'))if(event.event.getSender()==='@t2_alex:reddit.com')event.shadowRoot.querySelector('.user-name').textContent='[deleted]';
    const intro=document.createElement('rs-room-info');intro.innerHTML='<div class="font-semibold" style="text-align:center;font-weight:600;padding:12px">[deleted]</div>';timeline.prepend(intro);
    const image=api.appendMessage('alex_morgan','', 'alex-image');image.shadowRoot.querySelector('.user-name').textContent='[deleted]';
    image.shadowRoot.querySelector('.room-message-text').innerHTML='<div style="background:var(--color-neutral-background-weak,#f2f4f5);border-radius:12px;padding:12px;width:160px;height:60px">🖼️ Image attachment</div>';
    const client=api.app.querySelector('rs-matrix-client').client,rooms=client.getRooms;
    client.getRooms=()=>rooms().map(room=>({...room,getLastActiveTimestamp:()=>1791432000000}));
  }
  function groupedPreview(api) {
    if(!new URL(location.href).searchParams.has('grouped'))return;
    const timeline=api.room.shadowRoot.querySelector('rs-timeline').shadowRoot.querySelector('rs-virtual-scroll-dynamic').shadowRoot;
    for(const [i,event] of [...timeline.querySelectorAll('rs-timeline-event')].entries()) {
      event.removeAttribute('data-id');
      const self=event.event.getSender()==='@t2_me:reddit.com';
      const name=event.shadowRoot.querySelector('.user-name');
      if(self)name.textContent='demo_user';
      if(i===2)name.textContent='';
      event.shadowRoot.querySelector('.user-avatar').innerHTML=`<svg viewBox="0 0 32 32" width="30" height="30"><image width="32" height="32" href="https://www.redditstatic.com/avatars/defaults/v2/avatar_default_${self?2:1}.png"/></svg>`;
    }
    const client=api.app.querySelector('rs-matrix-client').client,getRoom=client.getRoom;
    client.getRoom=id=>{const room=getRoom(id);return room && {...room,getLiveTimeline:()=>({getEvents:()=>api.remoteMessages.get(id).map(event=>({event}))})};};
  }
  function render(){shell.replaceChildren();shell.className=compact?'compact-shell':'full-shell';const host=document.createElement('div');const root=host.attachShadow({mode:'open'});root.innerHTML='<style>:host{display:block;height:100%}#resizable{height:100%;border-radius:12px;overflow:hidden;border:1px solid var(--color-neutral-border-weak,#e5e8eb);background:var(--color-neutral-background,#fff)}.minimized{position:relative;width:130px;min-width:130px;height:44px;border-radius:12px 12px 0 0;background:var(--color-neutral-background,#fff);border:1px solid var(--color-neutral-border-weak,#e5e8eb)}.restore{width:100%;height:100%;background:transparent;border:0;text-align:left;padding-left:16px;color:var(--color-neutral-content-strong,#0f1a1c);font:14px sans-serif;cursor:pointer}.close{position:absolute;right:6px;top:9px;border:0;background:transparent;color:var(--color-neutral-content-weak,#576f76);font-size:20px}</style>';const container=document.createElement('div');container.id='resizable';root.append(container);shell.append(host);api=ChatFixture.build(compact?container:shell,{compact});loadedMessagesPreview(api);mediaPreview(api);unavailablePreview(api);groupedPreview(api);if(!compact)host.remove();else{api.minimize=()=>{container.hidden=true;shell.classList.add('is-minimized');const bar=document.createElement('div');bar.className='minimized';const restore=document.createElement('button');restore.className='restore';restore.setAttribute('aria-label','Maximize chat view');restore.textContent='Chat';const close=document.createElement('button');close.className='close';close.setAttribute('aria-label','Close chat');close.textContent='×';restore.addEventListener('click',()=>{container.hidden=false;bar.remove();shell.classList.remove('is-minimized');});close.addEventListener('click',()=>{container.hidden=false;bar.remove();shell.classList.remove('is-minimized');});bar.append(restore,close);root.append(bar);};}document.getElementById('full').setAttribute('aria-pressed',String(!compact));document.getElementById('compact').setAttribute('aria-pressed',String(compact));}
  function slowHistoryPreview() {
    if(!new URL(location.href).searchParams.has('slow'))return;
    const client=api.app.querySelector('rs-matrix-client').client,read=client.http.authedRequest;
    api.remoteMessages.get('alex').push({event_id:'alex-remote-7',seq_id:'7',type:'m.room.message',sender:'@t2_alex:reddit.com',origin_server_ts:1791432420000,content:{body:'I saved a coffee recommendation for tomorrow.'}});
    client.http.authedRequest=async(method,path,params)=>{
      if(path.endsWith('/events') && params.seq!==undefined)await new Promise(resolve=>setTimeout(resolve,4000));
      return read(method,path,params);
    };
  }
  document.getElementById('full').addEventListener('click',()=>{compact=false;render();slowHistoryPreview();});document.getElementById('compact').addEventListener('click',()=>{compact=true;render();slowHistoryPreview();});document.getElementById('theme').addEventListener('click',()=>{const dark=document.documentElement.classList.toggle('dark');document.getElementById('theme').setAttribute('aria-pressed',String(dark));});render();slowHistoryPreview();
})();
