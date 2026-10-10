/* Synthetic fixtures mirror the rs-* markup inspected in Brave, using invented data. */
(() => {
  const make = (tag, text, className) => { const e=document.createElement(tag); if(text)e.textContent=text;if(className)e.className=className;return e; };
  const conversations = [
    {id:'alex',name:'alex_morgan',initial:'A',color:'#ffe5c4',preview:'Coffee tomorrow sounds good.',messages:[['alex_morgan','Hey! How is the new project coming along?'],['You','Pretty well! I finally finished the chat search.'],['alex_morgan','Nice. Want to grab a coffee tomorrow?'],['You','Absolutely, same coffee place as last time?'],['alex_morgan','Yes! Let’s meet there at 10.'],['You','Perfect. See you tomorrow!']]},
    {id:'jules',name:'jules_designs',initial:'J',color:'#e4daf9',preview:'The new mockups look great.',messages:[['jules_designs','The new mockups look great.'],['You','Thanks! I kept the interface minimal.']]},
    {id:'sam',name:'sam_on_the_trail',initial:'S',color:'#ccead7',preview:'Did you see the route I sent?',messages:[['sam_on_the_trail','Did you see the route I sent?'],['You','Yes, Saturday looks perfect.']]},
    {id:'alex2',name:'alex_in_space',initial:'A',color:'#d5e9fa',preview:'That was a great recommendation.',messages:[['alex_in_space','That was a great recommendation.'],['You','Glad you liked it!']]},
    {id:'maya',name:'maya_reads',initial:'M',color:'#ffdbe3',preview:'Just finished the last chapter.',messages:[['maya_reads','Just finished the last chapter.'],['You','Let’s talk about it over coffee.']]}
  ];
  const archived={id:'river',name:'river_sketches',initial:'R',color:'#d5e9fa',preview:'An archived chat',messages:[['river_sketches','This conversation was never rendered in the list.']]};
  const legacy={id:'oldfriend',name:'old_friend',initial:'O',color:'#d5e9fa',preview:'An older chat',messages:[['old_friend','This older chat is absent from the initial sync and native viewport.']]};
  function build(parent,{compact=false}={}) {
    const app=make('rs-app'); const root=app.attachShadow({mode:'open'});
    root.innerHTML='<style>:host{display:grid;grid-template-columns:280px minmax(0,1fr);grid-template-rows:minmax(0,1fr);height:100%;background:var(--color-neutral-background,#fff);color:var(--color-neutral-content-strong,#0f1a1c);font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;min-width:0}rs-rooms-nav{border-right:1px solid var(--color-neutral-border-weak,#e5e8eb);min-width:0}rs-room{min-width:0;min-height:0;height:100%}</style>';
    const nav=make('rs-rooms-nav'); const navRoot=nav.attachShadow({mode:'open'});
    navRoot.innerHTML='<style>:host{display:flex;flex-direction:column;height:100%;overflow:visible}.nav-head{height:48px;display:flex;align-items:center;gap:10px;padding:0 16px;font-weight:700;font-size:17px;flex-shrink:0}.reddit-dot{width:25px;height:25px;border-radius:50%;display:grid;place-items:center;background:#ff4500;color:white;font-size:20px}.threads{padding:15px 18px;border-bottom:1px solid var(--color-neutral-border-weak,#e5e8eb);font-size:14px}rs-virtual-scroll{overflow:auto;min-height:0;flex:1}</style><div class="nav-head"><span class="reddit-dot">⌕</span>Chats<span style="margin-left:auto;font-size:21px;font-weight:400">⊕</span></div><rs-rooms-nav-filter-chips></rs-rooms-nav-filter-chips>';
    const scroll=make('rs-virtual-scroll'); const scrollRoot=scroll.attachShadow({mode:'open'});
    const style=make('style');style.textContent=':host{display:block}.threads{padding:15px 18px;font-size:14px;border-bottom:1px solid var(--color-neutral-border-weak,#e5e8eb)}';scrollRoot.append(style,make('div','↶　 Threads　　　　　›','threads'));
    const rows=make('rs-roving-focus-native');scrollRoot.append(rows);navRoot.append(scroll);
    const room=make('rs-room');root.append(nav,room);parent.append(app);
    const roomRoot=room.attachShadow({mode:'open'});
    let active;
    function select(conversation) {
      active=conversation;room.setAttribute('room',conversation.id);
      roomRoot.replaceChildren();const style=make('style');style.textContent=':host{display:block}main{height:100%;display:flex;flex-direction:column;min-width:0;overflow:hidden}header{display:flex;align-items:center;gap:10px;height:48px;min-height:48px;padding:0 12px;border-bottom:1px solid var(--color-neutral-border-weak,#e5e8eb)}header .name{font-weight:600;flex:1}header .flex{display:flex;align-items:center;gap:3px}button{background:transparent;color:inherit;border:0;border-radius:50%;cursor:pointer;width:28px;height:28px;font:18px sans-serif}.avatar{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;color:#425257;font-weight:600}.composer{padding:12px;min-height:88px}.composer input{box-sizing:border-box;background:var(--color-neutral-background-weak,#f2f4f5);border:0;border-radius:20px;padding:14px;width:100%;font:13px sans-serif;color:inherit}rs-timeline{display:flex;flex:1;min-height:0;overflow:hidden}';
      roomRoot.append(style);const main=make('main');const header=make('header');const avatar=make('span',conversation.initial,'avatar');avatar.style.background=conversation.color;header.append(avatar,make('span',conversation.name,'name'));const actions=make('div',null,'flex flex-nowrap');const settings=make('button','⚙');settings.setAttribute('aria-label','Conversation settings');actions.append(settings);
      if(compact){const minimize=make('button','⌄');minimize.setAttribute('aria-label','Minimize chat window');minimize.addEventListener('click',()=>api.minimize());actions.append(minimize);const close=make('button','×');close.setAttribute('aria-label','Close chat window');close.addEventListener('click',()=>api.minimize());actions.append(close);}header.append(actions);main.append(header,make('rs-room-banners'));
      const timeline=make('rs-timeline'); const timelineRoot=timeline.attachShadow({mode:'open'});timelineRoot.innerHTML='<style>:host{display:flex;flex:1;min-height:0}rs-virtual-scroll-dynamic{display:block;overflow-y:auto;flex:1;padding:16px;overscroll-behavior:contain}</style>';
      const virtual=make('rs-virtual-scroll-dynamic');virtual.style.overflowY='auto';virtual.style.minHeight='0';const virtualRoot=virtual.attachShadow({mode:'open'});virtualRoot.append(make('div',new Date(1791432000000).toLocaleDateString(undefined,{month:'short',day:'numeric'}),'date'));const dateStyle=make('style');dateStyle.textContent='.date{text-align:center;font-size:11px;color:var(--color-neutral-content-weak,#576f76);padding:8px 0 20px}';virtualRoot.append(dateStyle);
      const appendMessage = (author,text,id) => {
        const event=make('rs-timeline-event');event.setAttribute('data-id',id);event.tabIndex=-1;const eventRoot=event.attachShadow({mode:'open'});eventRoot.innerHTML='<style>:host{display:block;margin-bottom:24px}.room-message{display:flex;gap:12px}.user-avatar{width:28px;height:28px;border-radius:50%;background:var(--color-neutral-background-weak,#f2f4f5);display:grid;place-items:center;flex:none;color:var(--color-neutral-content-weak,#576f76);font-size:12px}.user-name{font-size:13px;font-weight:700}time{font-size:10px;color:var(--color-neutral-content-weak,#576f76);margin-left:6px}.room-message-text{font-size:14px;line-height:1.5;padding-top:3px;overflow-wrap:anywhere}</style>';
        event.event={getId:()=>id,getRoomId:()=>conversation.id,getSender:()=>author==='You'?'@t2_me:reddit.com':`@t2_${conversation.id}:reddit.com`};
        const wrapper=make('div',null,'room-message');const copy=make('div');const line=make('div');line.append(make('span',author,'user-name'));const sequence=Number(/-remote-(\d+)$/.exec(id)?.[1] || 0);const date=new Date(1791432000000+sequence*60000);const time=make('time',date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'}));time.dateTime=date.toISOString();line.append(time);copy.append(line,make('div',text,'room-message-text'));wrapper.append(make('div',author.slice(0,1),'user-avatar'),copy);eventRoot.append(wrapper);virtualRoot.append(event);return event;
      };
      conversation.messages.forEach(([author,text],i)=>appendMessage(author,text,`${conversation.id}-remote-${i+1}`));
      timelineRoot.append(virtual);main.append(timeline);const composer=make('div',null,'composer');const input=make('input');input.placeholder='Message';input.setAttribute('aria-label','Message (demo only)');composer.append(input);main.append(composer);roomRoot.append(main);
      api.appendMessage=(author,text,id)=>appendMessage(author,text,id);
      for(const row of rows.children)row.toggleAttribute('selected',row.getAttribute('room')===conversation.id);
    }
    for(const conversation of conversations){const row=make('rs-rooms-nav-room');row.setAttribute('room',conversation.id);const r=row.attachShadow({mode:'open'});r.innerHTML='<style>:host{display:block}a{display:flex;gap:10px;padding:14px 12px;color:inherit;text-decoration:none;align-items:center}:host([selected]) a{background:var(--color-neutral-background-weak,#f2f4f5)}a:hover{background:var(--color-neutral-background-weak,#f2f4f5)}.avatar{width:34px;height:34px;display:grid;place-items:center;border-radius:50%;color:#425257;font-weight:600;flex:none}.copy{min-width:0}.room-name{font-size:12px}.preview{color:var(--color-neutral-content-weak,#576f76);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:4px}</style>';const link=make('a');link.href=`https://www.reddit.com/room/${conversation.id}`;link.setAttribute('aria-label',`Direct chat with ${conversation.name}`);const avatar=make('span',conversation.initial,'avatar');avatar.style.background=conversation.color;const copy=make('span',null,'copy');copy.append(make('span',conversation.name,'room-name'),make('div',conversation.preview,'preview'));link.append(avatar,copy);link.addEventListener('click',event=>{event.preventDefault();select(conversation);});r.append(link);rows.append(row);}
    const all=[...conversations,archived,legacy];
    const cachedIds=new Set(all.filter(c=>c!==legacy).map(c=>c.id));
    const directMap=Object.fromEntries(all.map(c=>[`@t2_${c.id}:reddit.com`,[c.id]]));
    const avatar=color=>'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_1.png';
    const members=Object.fromEntries(all.map(c=>[`t2_${c.id}`,{displayName:c.name,name:c.name,prefixedName:`u/${c.name}`,avatar:{src:avatar(c.color)}}]));
    const users={getRedditUserById:async id=>members[id]};
    for(const row of rows.children)row.users=users;
    const own='@t2_me:reddit.com';
    const remoteMessages=new Map(all.map(c=>[c.id,[['You',`An archive message from the beginning of the conversation.`],...c.messages].map(([author,text],i)=>({event_id:`${c.id}-remote-${i}`,type:'m.room.message',sender:author==='You'?own:`@t2_${c.id}:reddit.com`,seq_id:String(i),origin_server_ts:1791432000000+i*60000,content:{msgtype:'m.text',body:text}}))]));
    const calls=[];
    const matrix=make('rs-matrix-client');matrix.client={
      getUserId:()=>own,isInitialSyncComplete:()=>true,getUser:id=>({rawDisplayName:id===own?'You':''}),
      getRoom:id=>cachedIds.has(id)?{roomId:id,name:all.find(c=>c.id===id)?.name,summaryHeroes:[`@t2_${id}:reddit.com`]}:null,
      getRooms:()=>all.filter(c=>cachedIds.has(c.id)).map(c=>({roomId:c.id,name:c.name,summaryHeroes:[`@t2_${c.id}:reddit.com`]})),
      getAccountData:type=>type==='m.direct'?{getContent:()=>directMap}:null,
      storeInactiveRoom:raw=>{cachedIds.add(raw.room_id);calls.push({method:'cache-room',roomId:raw.room_id});},
      getRoomList:async options=>{
        calls.push({method:'rooms',options});
        const filtered=options.with_user ? all.filter(c=>options.with_user===`@t2_${c.id}:reddit.com`) : all;
        const offset=Number(options.next_batch || 0);const size=options.page_size || 200;
        const selected=filtered.slice(offset,offset+size);
        return {rooms:selected.map(c=>({room_id:c.id,membership:'join',last_seq_id:'100',state:[
          {type:'com.reddit.chat.type',content:{type:'direct',participants:[own,`@t2_${c.id}:reddit.com`]}},
          {type:'m.room.member',state_key:`@t2_${c.id}:reddit.com`,content:{membership:'join',displayname:c.name,avatar_url:avatar(c.color)}}
        ]})),...(offset+size<filtered.length ? {next_batch:String(offset+size)} : {})};
      },
      http:{authedRequest:async(method,path,params={})=>{calls.push({method,path,params});if(path.endsWith('/account_data/m.direct'))return directMap;if(path==='/sync')return {next_batch:'snapshot',rooms:{join:Object.fromEntries(all.filter(c=>c!==legacy).map(c=>[c.id,{state:{events:[{type:'com.reddit.chat.type',content:{type:'direct',participants:[own,`@t2_${c.id}:reddit.com`]}},{type:'m.room.member',state_key:`@t2_${c.id}:reddit.com`,content:{membership:'join',displayname:c.name,avatar_url:avatar(c.color)}}]}}]))}};const id=decodeURIComponent(path.split('/')[2]);if(path.endsWith('/members')){const c=all.find(c=>c.id===id);return {chunk:c?[{type:'m.room.member',state_key:`@t2_${id}:reddit.com`,content:{membership:'join',displayname:c.name}}]:[]};}const events=remoteMessages.get(id)||[];const cursor=params.seq===undefined?Infinity:Number(params.seq);return {events:events.filter(e=>Number(e.seq_id)<=cursor).slice(-3).reverse()};}}
    };
    const history=make('rs-history');history.navigate=async route=>{const pieces=route.split('/');const id=decodeURIComponent(pieces[2]);select(all.find(c=>c.id===id));if(pieces[3]==='event'){const eventId=decodeURIComponent(pieces[4]);const message=remoteMessages.get(id)?.find(e=>e.event_id===eventId);if(message){const event=api.appendMessage(message.sender===own?'You':active.name,message.content.body,message.event_id);event.scrollIntoView?.({block:'center'});}}};app.append(matrix,history);
    const api={app,nav,room,calls,remoteMessages,select:(id)=>select(all.find(c=>c.id===id)),minimize:()=>{},get active(){return active;}};select(conversations[0]);return api;
  }
  globalThis.ChatFixture={build,conversations};
})();
