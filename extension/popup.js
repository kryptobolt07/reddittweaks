const SETTINGS_KEY='rt-settings-v1';
const FALLBACK_HISTORY_LIMITS=[20,100,500,1000,5000,0];
const FALLBACK_VIDEO_DEFAULTS={
  videoStart:'default',embedStart:'default',gifStart:'default',
  mediaClickAction:'default',clickAudio:'muted',embedBlockLinks:'off',
  singleVideo:false,volumeMemory:false,videoScrollAway:'default',
  videoOpenPost:'default',cardClickAudio:'keep',videoDirectOpen:'default',holdFor2x:false,loopPolicy:'default',streamQuality:'auto'
};
const FALLBACK_SETTINGS_DEFAULTS={
  postDiscovery:true,feedControls:true,blockedProfiles:true,archiveDiscovery:false,restoreDeletedContent:true,
  subredditArchive:false,subredditArchiveAutomatic:false,visualSearch:false,visualSearchPostMenu:true,cleanShareLinks:false,
  modUnapprovedFilter:true,raffles:true,downloadMedia:true,
  ownRemoval:false,removalNotifications:false,historyLimit:20,
  smoothFeeds:true,smoothHome:true,smoothSubreddits:true,smoothProfiles:true,smoothSearch:true,smoothComments:false,
  hideMatureOverlay:true,revealNsfwPostMedia:false,chatSearch:true,navHome:'scroll',navFeeds:'default',navCommunity:'default',navPost:'scroll',navProfile:'default',navSearch:'default',...FALLBACK_VIDEO_DEFAULTS
};
function fallbackNormalizeSettings(raw){
  const starts=['default','autoplay','preview','play'];
  const mapStart=v=>starts.includes(v)?v:v==='hover'||v==='stop'?'preview':v==='reddit'?'default':null;
  const pick=(k,allowed,fb)=>allowed.includes(raw?.[k])?raw[k]:fb;
  return {
    postDiscovery:raw?.postDiscovery!==false,
    feedControls:raw?.feedControls!==false,
    blockedProfiles:raw?.blockedProfiles!==false,
    archiveDiscovery:raw?.archiveDiscovery===true,
    restoreDeletedContent:raw?.restoreDeletedContent!==false,
    subredditArchive:raw?.subredditArchive===true,
    subredditArchiveAutomatic:raw?.subredditArchiveAutomatic===true,
    visualSearch:raw?.visualSearch===true,
    visualSearchPostMenu:raw?.visualSearchPostMenu!==false,
    cleanShareLinks:raw?.cleanShareLinks===true,
    modUnapprovedFilter:raw?.modUnapprovedFilter!==false,
    raffles:raw?.raffles!==false,
    downloadMedia:raw?.downloadMedia!==false,
    ownRemoval:raw?.ownRemoval===true,
    removalNotifications:raw?.removalNotifications===true,
    historyLimit:FALLBACK_HISTORY_LIMITS.includes(raw?.historyLimit)?raw.historyLimit:20,
    smoothFeeds:raw?.smoothFeeds!==false,
    smoothHome:raw?.smoothHome!==false,
    smoothSubreddits:raw?.smoothSubreddits!==false,
    smoothProfiles:raw?.smoothProfiles!==false,
    smoothSearch:raw?.smoothSearch!==false,
    smoothComments:raw?.smoothComments===true,
    hideMatureOverlay:raw?.hideMatureOverlay!==false,
    revealNsfwPostMedia:raw?.revealNsfwPostMedia===true,
    chatSearch:raw?.chatSearch!==false,
    ...Object.fromEntries(Object.entries({navHome:'scroll',navFeeds:'default',navCommunity:'default',navPost:'scroll',navProfile:'default',navSearch:'default'}).map(([k,fb])=>[k,pick(k,['default','scroll','hidden'],fb)])),
    videoStart:mapStart(raw?.videoStart) ?? mapStart(raw?.videoStartTouch) ?? (raw?.videoPreviewsInView===true?'preview':'default'),
    embedStart:mapStart(raw?.embedStart) ?? mapStart(raw?.embedStartTouch) ?? 'default',
    gifStart:mapStart(raw?.gifStart) ?? mapStart(raw?.gifStartTouch) ?? 'default',
    mediaClickAction:pick('mediaClickAction',['default','inline','open','fullscreen'],
      ['muted','sound','here'].includes(raw?.videoPreviewClick) || raw?.videoPreviewClickPlays===true?'inline':raw?.videoPreviewClick==='open'?'open':'default'),
    clickAudio:pick('clickAudio',['muted','unmute'],
      raw?.videoPreviewClick==='muted'?'muted':raw?.videoPreviewClick==='sound'?'unmute':
      (raw?.videoPreviewClick==='here'||raw?.videoPreviewClickPlays===true) && raw?.videoUnmutePreview!==false?'unmute':
      raw?.videoUnmutePreview===true?'unmute':'muted'),
    embedBlockLinks:pick('embedBlockLinks',['off','feed','posts','both'],'off'),
    singleVideo:raw?.singleVideo===true,
    volumeMemory:raw?.volumeMemory===true,
    videoScrollAway:pick('videoScrollAway',['default','pause','mini'],'default'),
    videoOpenPost:pick('videoOpenPost',['default','position','start'],
      raw?.videoOpenPost==='reddit'?'default':raw?.videoOpenPost==='continue'?(raw?.videoPreviewFrom==='start'||raw?.videoPreviewRestart===true?'start':'position'):raw?.videoPreviewFrom==='start'||raw?.videoPreviewRestart===true?'start':'default'),
    cardClickAudio:pick('cardClickAudio',['keep','muted','unmute'],'keep'),
    videoDirectOpen:pick('videoDirectOpen',['default','muted','sound','paused'],'default'),
    holdFor2x:raw?.holdFor2x===true,
    loopPolicy:pick('loopPolicy',['default','always','never','short'],'default'),
    streamQuality:pick('streamQuality',['auto','max','saver'],'auto')
  };
}
const Model=globalThis.RTPostModel || {
  SETTINGS_DEFAULTS:FALLBACK_SETTINGS_DEFAULTS,
  VIDEO_DEFAULTS:FALLBACK_VIDEO_DEFAULTS,
  HISTORY_LIMITS:FALLBACK_HISTORY_LIMITS,
  normalizeSettings:fallbackNormalizeSettings
};
const SETTINGS_DEFAULTS=Model.SETTINGS_DEFAULTS;
const VIDEO_DEFAULTS=Model.VIDEO_DEFAULTS;
const normalizeSettings=Model.normalizeSettings;
const DEPRECATED_KEYS=[
  'videoStartTouch','embedStartTouch','gifStartTouch','videoPreviews','videoPreviewsInView',
  'videoPreviewClick','videoPreviewClickPlays','videoPreviewFrom','videoPreviewRestart','videoUnmutePreview'
];
function mergeStored(raw,patch){
  const source=raw && typeof raw==='object'?raw:{};
  const merged={...source,...normalizeSettings(source),...patch};
  for(const key of DEPRECATED_KEYS)delete merged[key];
  return merged;
}

// Standardized platform detection across CSS and JS: true touch-primary devices only.
const touchQuery=globalThis.matchMedia?.('(hover: none) and (pointer: coarse)');
const isTouch=Boolean(touchQuery?.matches);
const activeDevice=isTouch?'touch':'mouse';
for(const el of document.querySelectorAll('[data-device]'))el.hidden=el.dataset.device!==activeDevice;
if(isTouch){
  for(const option of document.querySelectorAll('[data-touch-label]')){
    option.textContent=option.dataset.touchLabel;
    if(option.dataset.touchShort)option.dataset.short=option.dataset.touchShort;
  }
  for(const desc of document.querySelectorAll('[data-touch-desc]'))desc.textContent=desc.dataset.touchDesc;
}

// Synchronous mirror keeps switches and choices accurate on the first paint before async storage resolves.
const SETTINGS_MIRROR='rt-settings-mirror-v1';
const readMirror=()=>{try{return JSON.parse(localStorage.getItem(SETTINGS_MIRROR) || 'null');}catch{return null;}};
const writeMirror=settings=>{try{localStorage.setItem(SETTINGS_MIRROR,JSON.stringify(settings));}catch{}};
const mirror=readMirror(),initialSettings=normalizeSettings(mirror);
const storage=globalThis.chrome?.storage?.local;
const storedSettings=storage?.get && storage?.set
  ? Promise.resolve().then(()=>storage.get(SETTINGS_KEY)).then(stored=>normalizeSettings(stored?.[SETTINGS_KEY]))
  : null;
const frame=globalThis.requestAnimationFrame || (callback=>setTimeout(callback,16));

const choiceViews=new Map();
let settingsWrite=Promise.resolve();

function setStatus(text,{error=false}={}){
  const status=globalThis.document?.querySelector?.('#settings-status');
  if(!status)return;
  status.classList.toggle('error',error);
  status.textContent=text;
  if(error)status.dataset.inactive='false';
}

function closeAllMenus(except=null){
  for(const view of choiceViews.values()){
    if(view!==except && !view.menu.hidden)view.close();
  }
  if(aboutPanel && !aboutPanel.hidden)setAbout(false);
}

// Unified custom overlay menu controller for History length and all Videos & Embeds selectors.
function initChoices(){
  const triggers=[...document.querySelectorAll('.setting-choice[data-choice]')];
  if(!triggers.length)return;
  for(const trigger of triggers){
    const key=trigger.dataset.choice,menu=document.getElementById(trigger.getAttribute('aria-controls'));
    if(!menu)continue;
    document.body.append(menu); // Escape .panel scroll mask so menus are never clipped.
    const options=[...menu.querySelectorAll('[role="menuitemradio"]')];
    const labelEl=document.querySelector('label[for="'+trigger.id+'"]');
    const label=(labelEl?.childNodes?.[0]?.textContent || labelEl?.textContent || key).trim();
    const numeric=trigger.dataset.valueType==='number';
    const parseVal=raw=>numeric?Number(raw):raw;
    const defaultValue=parseVal(trigger.dataset.default ?? String(SETTINGS_DEFAULTS[key] ?? ''));
    const view={key,trigger,menu,options,defaultValue,numeric,value:defaultValue};
    view.isModified=()=>String(view.value)!==String(view.defaultValue);
    view.paint=()=>{
      const chosen=options.find(o=>String(o.dataset.value)===String(view.value)) || options[0];
      if(!chosen)return;
      trigger.querySelector('[data-choice-value]').textContent=chosen.dataset.short || chosen.textContent;
      trigger.setAttribute('aria-label',label+': '+chosen.textContent.trim());
      trigger.dataset.modified=String(view.isModified());
      for(const option of options){
        option.setAttribute('aria-checked',String(option===chosen));
        option.tabIndex=-1;
      }
    };
    view.close=(focus=false)=>{
      menu.hidden=true;
      trigger.setAttribute('aria-expanded','false');
      if(focus)trigger.focus({preventScroll:true});
    };
    view.open=()=>{
      if(trigger.disabled || trigger.getAttribute('aria-disabled')==='true')return;
      closeAllMenus(view);
      view.paint();
      const baseWidth=Number(trigger.dataset.menuWidth) || (isTouch?320:236);
      const width=Math.max(0,Math.min(isTouch?Math.max(baseWidth,220):baseWidth,innerWidth-16));
      const maxHeight=Math.max(0,innerHeight-16);
      menu.style.width=width+'px';
      menu.style.maxHeight=maxHeight+'px';
      menu.hidden=false;
      const rect=trigger.getBoundingClientRect();
      const height=Math.min(menu.getBoundingClientRect().height || 140,maxHeight);
      menu.style.left=Math.max(8,Math.min(rect.right-width,innerWidth-width-8))+'px';
      const below=rect.bottom+4,above=(rect.top ?? rect.bottom)-4-height;
      const top=below+height<=innerHeight-8?below:above>=8?above:Math.max(8,innerHeight-height-8);
      menu.style.top=top+'px';
      trigger.setAttribute('aria-expanded','true');
      (options.find(o=>o.getAttribute('aria-checked')==='true') || options[0])?.focus({preventScroll:true});
    };
    trigger.addEventListener('click',()=>menu.hidden?view.open():view.close());
    trigger.addEventListener('keydown',event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();view.open();}});
    menu.addEventListener('keydown',event=>{
      const index=options.indexOf(document.activeElement);
      if(event.key==='Escape'){event.preventDefault();view.close(true);}
      else if(event.key==='Tab')view.close();
      else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();
        const next=event.key==='Home'?0:event.key==='End'?options.length-1:(index+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
        options[next]?.focus();
      }
    });
    document.addEventListener('click',event=>{if(!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target))view.close();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape' && !menu.hidden)view.close(true);});
    document.addEventListener('scroll',event=>{if(!menu.hidden && !menu.contains(event.target))view.close();},true);
    for(const option of options)option.addEventListener('click',()=>{
      if(trigger.disabled || !storedSettings)return;
      const next=parseVal(option.dataset.value),previous=view.value;
      view.close(true);
      if(next===previous)return;
      view.value=next;view.paint();syncDependencies();syncSummary();settled();
      trigger.disabled=true;setStatus('Saving…');
      settingsWrite=settingsWrite.catch(()=>{}).then(async()=>{
        const latest=await storage.get(SETTINGS_KEY);
        const merged=mergeStored(latest?.[SETTINGS_KEY],{[key]:next});
        await storage.set({[SETTINGS_KEY]:merged});
        writeMirror(normalizeSettings(merged));
      }).then(()=>{setStatus('Settings saved automatically.');},()=>{
        view.value=previous;view.paint();syncDependencies();syncSummary();settled();
        setStatus('Could not save this setting. Please retry.',{error:true});
      }).finally(()=>{trigger.disabled=false;});
    });
    choiceViews.set(key,view);
  }
}

function applySettingsToUI(settings,{enable=false}={}){
  for(const control of document.querySelectorAll('[data-setting]')){
    const value=Boolean(settings[control.dataset.setting]);
    if(control.checked!==value)control.checked=value;
    if(enable)control.disabled=false;
  }
  for(const view of choiceViews.values()){
    view.value=settings[view.key] ?? view.defaultValue;
    view.paint();
    if(enable)view.trigger.disabled=false;
  }
}

async function loadSettings(){
  const controls=[...document.querySelectorAll('[data-setting]')];
  if(!controls.length)return;
  const markUnavailable=()=>{
    for(const control of controls){
      control.disabled=true;control.indeterminate=true;
      control.classList.add('is-unavailable');control.setAttribute('aria-disabled','true');
    }
    for(const view of choiceViews.values())view.trigger.disabled=true;
  };
  if(!storedSettings){
    markUnavailable();setStatus('Settings storage unavailable.',{error:true});syncDependencies();syncSummary();return;
  }
  document.documentElement.classList.add('rt-settling');
  applySettingsToUI(initialSettings,{enable:Boolean(mirror)});
  if(!mirror)for(const control of controls)control.disabled=true;
  syncDependencies();syncSummary();settled();
  frame(()=>frame(()=>document.documentElement.classList.remove('rt-settling')));
  for(const control of controls)control.addEventListener('change',()=>saveSetting(control));
  try{
    const settings=await storedSettings;
    applySettingsToUI(settings,{enable:true});
    writeMirror(settings);
    setStatus('Settings saved automatically.');
  }catch{
    markUnavailable();
    setStatus('Could not load settings. Reopen the popup to retry.',{error:true});
  }
  syncDependencies();syncSummary();settled();
}

function saveSetting(control){
  const key=control.dataset.setting,next=control.checked;
  syncDependencies();syncSummary();settled();
  control.disabled=true;setStatus('Saving…');
  settingsWrite=settingsWrite.catch(()=>{}).then(async()=>{
    if(!storage?.get || !storage?.set)throw Error('storage unavailable');
    const latest=await storage.get(SETTINGS_KEY);
    const merged=mergeStored(latest?.[SETTINGS_KEY],{[key]:next});
    await storage.set({[SETTINGS_KEY]:merged});
    writeMirror(normalizeSettings(merged));
    setStatus('Settings saved automatically.');
  }).catch(()=>{
    control.checked=!next;syncDependencies();syncSummary();settled();
    setStatus('Could not save this setting. Please retry.',{error:true});
  }).finally(()=>{control.disabled=false;});
  return settingsWrite;
}

// One-click Reset for Videos & Embeds back to passive Reddit/Provider defaults.
document.getElementById('reset-video-defaults')?.addEventListener('click',async event=>{
  if(!storedSettings)return;
  const button=event.currentTarget;
  const previous={};
  for(const key of Object.keys(VIDEO_DEFAULTS)){
    if(choiceViews.has(key))previous[key]=choiceViews.get(key).value;
    else{const el=document.querySelector(`[data-setting="${key}"]`);if(el)previous[key]=el.checked;}
  }
  button.disabled=true;
  closeAllMenus();
  for(const [key,def] of Object.entries(VIDEO_DEFAULTS)){
    if(choiceViews.has(key)){const view=choiceViews.get(key);view.value=def;view.paint();}
    else{const el=document.querySelector(`[data-setting="${key}"]`);if(el)el.checked=Boolean(def);}
  }
  syncDependencies();syncSummary();settled();
  setStatus('Resetting video defaults…');
  settingsWrite=settingsWrite.catch(()=>{}).then(async()=>{
    const latest=await storage.get(SETTINGS_KEY);
    const merged=mergeStored(latest?.[SETTINGS_KEY],VIDEO_DEFAULTS);
    await storage.set({[SETTINGS_KEY]:merged});
    writeMirror(normalizeSettings(merged));
  }).then(()=>{setStatus('Video defaults restored.');},()=>{
    for(const [key,val] of Object.entries(previous)){
      if(choiceViews.has(key)){const view=choiceViews.get(key);view.value=val;view.paint();}
      else{const el=document.querySelector(`[data-setting="${key}"]`);if(el)el.checked=Boolean(val);}
    }
    syncDependencies();syncSummary();settled();
    setStatus('Could not reset video defaults. Please retry.',{error:true});
  }).finally(()=>{button.disabled=false;});
});

// Collapsible drawers (Smooth scrolling surfaces & Videos Enhancements)
const enhancementsBody=document.getElementById('video-enhancements');
const smoothSurfacesBody=document.getElementById('smooth-surfaces');
for(const toggle of document.querySelectorAll('.drawer-toggle[aria-controls]')){
  const body=document.getElementById(toggle.getAttribute('aria-controls'));
  if(!body)continue;
  const inner=body.querySelector('.drawer-inner');
  const setDrawer=open=>{
    toggle.setAttribute('aria-expanded',String(open));
    body.dataset.open=String(open);
    if(inner){
      if(open)inner.removeAttribute('inert');
      else inner.setAttribute('inert','');
    }
    settled();
  };
  toggle.addEventListener('click',()=>setDrawer(toggle.getAttribute('aria-expanded')!=='true'));
  body.addEventListener('transitionend',()=>settled());
}

// Direct embed controls: explicit Grant access / Revoke access permission button. The original players are one grant;
// the other embed providers are checked host by host, so a grant made before they were added still works and shows
// what one more Grant access adds (docs/video-control-spec.md, Direct embed controls).
async function loadDirectEmbedControls(){
  const api=globalThis.browser || globalThis.chrome,hosts=globalThis.RTEmbedHosts;
  const button=document.getElementById('direct-embed-controls'),status=document.getElementById('direct-embed-status');
  const revoke=document.getElementById('direct-embed-revoke');
  const heading=document.getElementById('embed-controls-heading');
  if(!button || !hosts || !api?.permissions?.request || !api.scripting?.registerContentScripts)return;
  const ids=['rt-embed-player','rt-embed-player-main'];
  if(heading)heading.hidden=false;
  button.closest('.setting-row').hidden=false;
  button.disabled=true;
  let core=false,missing=[];
  const read=async()=>{
    const state=hosts.access?await hosts.access(api):{core:await api.permissions.contains({origins:hosts.origins}),hosts:[]};
    core=state.core;missing=hosts.missingProviders?hosts.missingProviders(state.hosts):[];
  };
  const list=names=>names.length<=2?names.join(' and '):names.slice(0,2).join(', ')+' and '+(names.length-2)+' more';
  const paint=()=>{
    const partial=core && missing.length>0;
    button.textContent=core && !partial?'Revoke access':'Grant access';
    button.dataset.granted=String(core);
    button.dataset.partial=String(partial);
    if(revoke)revoke.hidden=!partial;
    button.disabled=false;
    syncDependencies();syncSummary();settled();
  };
  const describe=()=>{
    if(core && missing.length)status.textContent='Granted for Vimeo, Streamable, RedGIFs and Twitch. '+list(missing)+' need one more Grant access.';
    else if(core)status.textContent='Access granted for supported players.';
  };
  try{await read();if(core)await hosts.ensureScripts(api);}catch{}
  describe();paint();
  const unregister=async()=>{for(const id of ids){try{await api.scripting.unregisterContentScripts({ids:[id]});}catch{}}};
  revoke?.addEventListener('click',async()=>{
    revoke.disabled=true;
    try{await api.permissions.remove({origins:hosts.allOrigins || hosts.origins});await unregister();core=false;missing=[];status.textContent='Access revoked. Refresh open Reddit tabs to apply.';}
    catch{status.textContent='Could not update direct embed controls. Please retry.';}
    revoke.disabled=false;paint();
  });
  button.addEventListener('click',async()=>{
    button.disabled=true;
    try{
      if(core && !missing.length){
        await api.permissions.remove({origins:hosts.allOrigins || hosts.origins});
        await unregister();
        core=false;missing=[];
        status.textContent='Access revoked. Refresh open Reddit tabs to apply.';
      }else if(await api.permissions.request({origins:hosts.allOrigins || hosts.origins})){
        if(!await hosts.ensureScripts(api))throw Error('Player permission is unavailable.');
        await read();
        status.textContent='Access granted. Refresh open Reddit tabs to apply.';
      }else status.textContent='Allow access to supported players to enable direct controls.';
    }catch{status.textContent='Could not update direct embed controls. Please retry.';}
    paint();
  });
}

// Data tab: chat message stats, two-click clear actions, and About popover.
const MESSAGE_STATS_KEY='rt-message-stats-v1';
let messageStatsRead=0;
function formatMessageStats(stats){
  const bytes=stats?.approxBytes || 0;
  const size=bytes<1048576?`${Math.ceil(bytes/1024).toLocaleString()} KB`:`${(bytes/1048576).toFixed(1)} MB`;
  return `${(stats?.messages || 0).toLocaleString()} saved messages · ${(stats?.rooms || 0).toLocaleString()} chats · ${size} estimated data`;
}
function readCachedMessageStats(){
  try{
    const parsed=JSON.parse(localStorage.getItem(MESSAGE_STATS_KEY) || 'null');
    if(parsed && Number.isFinite(parsed.messages) && Number.isFinite(parsed.rooms) && Number.isFinite(parsed.approxBytes))return parsed;
  }catch{}
  return null;
}
function writeCachedMessageStats(stats){
  try{
    if(!stats)localStorage.removeItem(MESSAGE_STATS_KEY);
    else localStorage.setItem(MESSAGE_STATS_KEY,JSON.stringify({messages:stats.messages || 0,rooms:stats.rooms || 0,approxBytes:stats.approxBytes || 0}));
  }catch{}
}
async function updateMessageStats({fresh=false}={}){
  const read=++messageStatsRead;
  const element=document.querySelector('#message-stats');
  const cached=fresh?null:readCachedMessageStats();
  element.textContent=cached?formatMessageStats(cached):'Checking saved messages…';
  try{
    const result=await chrome.runtime.sendMessage({scope:'rcs-messages',action:'stats'});
    if(!result?.ok)throw Error('Cache unavailable');
    const stats=result.stats || {};
    writeCachedMessageStats(stats);
    if(read===messageStatsRead)element.textContent=formatMessageStats(stats);
  }catch{if(read===messageStatsRead)element.textContent='Statistics unavailable. Reopen to retry.';}
  if(read===messageStatsRead)settled();
}
const CONFIRM_MS=5000;let armed=null;
function disarm(){
  if(!armed)return;clearTimeout(armed.timer);armed.button.classList.remove('confirming');armed.button.textContent=armed.label;
  const status=document.querySelector('#cache-status');if(status.dataset.confirming)status.textContent='';delete status.dataset.confirming;armed=null;
}
function clearAction(id,{scope,warning,done,failed,after}){
  const button=document.querySelector(id),status=document.querySelector('#cache-status');
  if(!button)return;
  button.addEventListener('click',async()=>{
    if(armed?.button!==button){
      disarm();
      armed={button,label:button.textContent,timer:setTimeout(disarm,CONFIRM_MS)};
      button.classList.add('confirming');button.textContent='Confirm clear';
      status.dataset.confirming='1';status.textContent=warning;return;
    }
    disarm();status.textContent='';button.disabled=true;
    try{
      const result=await chrome.runtime.sendMessage({scope,action:'clear'});
      status.textContent=result?.ok?done:failed;
      if(result?.ok && after)await after();
    }catch{status.textContent=failed;}
    finally{button.disabled=false;}
  });
}
clearAction('#clear-cache',{scope:'rcs-directory',warning:'Clears saved usernames for every Reddit account on this device. Click Confirm clear to proceed.',done:'Saved usernames cleared. Refresh Reddit to rebuild.',failed:'Could not clear the cache. Please retry.'});
clearAction('#clear-messages',{scope:'rcs-messages',warning:'Clears saved messages for every Reddit account on this device. Click Confirm clear to proceed.',done:'Saved messages cleared. Open chats can save newly received messages.',failed:'Could not clear saved messages. Please retry.',after:()=>{writeCachedMessageStats(null);return updateMessageStats({fresh:true});}});
document.addEventListener('keydown',event=>{if(event.key==='Escape')disarm();});
document.addEventListener('click',event=>{if(armed && event.target!==armed.button)disarm();});

const aboutWrap=document.querySelector('#cache-about'),aboutButton=document.querySelector('#cache-info-toggle'),aboutPanel=document.querySelector('#cache-info-panel');
function setAbout(open,restoreFocus=false){
  if(!aboutPanel || !aboutButton)return;
  if(open){for(const view of choiceViews.values())if(!view.menu.hidden)view.close();}
  aboutPanel.hidden=!open;aboutButton.setAttribute('aria-expanded',String(open));
  if(open)aboutPanel.querySelector('.popover-close')?.focus({preventScroll:true});
  else if(restoreFocus)aboutButton.focus({preventScroll:true});
}
aboutButton?.addEventListener('click',()=>setAbout(aboutPanel.hidden));
aboutPanel?.querySelector('.popover-close')?.addEventListener('click',()=>setAbout(false,true));
aboutWrap?.addEventListener('focusout',event=>{if(!aboutPanel.hidden && !aboutWrap.contains(event.relatedTarget))setAbout(false);});
document.addEventListener('click',event=>{if(aboutPanel && !aboutPanel.hidden && !aboutWrap.contains(event.target))setAbout(false);});
document.addEventListener('keydown',event=>{if(event.key==='Escape' && aboutPanel && !aboutPanel.hidden)setAbout(false,true);});

// Dependency engine: checkbox parents, choice parents, and permission parents.
function isDeviceHidden(el){
  const scoped=el?.closest?.('[data-device]');
  return Boolean(scoped && scoped.dataset.device!==activeDevice);
}
function syncDependencies(){
  for(const drawer of document.querySelectorAll('.drawer-section[data-requires]')){
    if(isDeviceHidden(drawer))continue;
    const parent=document.getElementById(drawer.dataset.requires);
    drawer.hidden=!Boolean(parent?.checked);
  }
  for(const row of document.querySelectorAll('.setting-row[data-requires]')){
    if(isDeviceHidden(row))continue;
    const parent=document.getElementById(row.dataset.requires),ancestor=parent?.closest('.setting-row[data-requires]');
    const active=Boolean(parent?.checked) && (!ancestor || !ancestor.classList.contains('is-inactive'));
    row.classList.toggle('is-inactive',!active);
    let blocker=null;
    for(let at=parent;at;){
      if(!at.checked)blocker=at;
      const up=at.closest('.setting-row[data-requires]');
      at=up?document.getElementById(up.dataset.requires):null;
    }
    row.hidden=!active && parent?.closest('.card')===row.closest('.card');
    let note=row.querySelector('.requires-note');
    if(!active && blocker && !row.hidden){
      if(!note){note=document.createElement('p');note.className='requires-note';row.querySelector('.setting-copy').append(note);}
      const labelEl=document.querySelector('label[for="'+blocker.id+'"]');
      const name=(labelEl?.childNodes?.[0]?.textContent || labelEl?.textContent || 'the setting above').trim();
      note.textContent='Requires '+name;
    }else note?.remove();
    const control=row.querySelector('[data-setting], .setting-choice[data-choice]');
    if(control && !control.classList.contains('is-unavailable')){
      if(active)control.removeAttribute('aria-disabled');else control.setAttribute('aria-disabled','true');
    }
  }
  for(const row of document.querySelectorAll('.setting-row[data-requires-choice]')){
    if(isDeviceHidden(row))continue;
    const parent=document.getElementById(row.dataset.requiresChoice);
    const parentView=parent?choiceViews.get(parent.dataset.choice):null;
    const forbidden=row.dataset.requiresNot;
    const parentRow=parent?.closest('.setting-row');
    const active=Boolean(parentView) && String(parentView.value)!==String(forbidden) && (!parentRow || !parentRow.classList.contains('is-inactive'));
    row.classList.toggle('is-inactive',!active);
    row.hidden=!active;
    const control=row.querySelector('[data-setting], .setting-choice[data-choice]');
    if(control){if(active)control.removeAttribute('aria-disabled');else control.setAttribute('aria-disabled','true');}
  }
  // Options that need an optional permission stay visible but dimmed until it is granted, saying what to enable; a
  // click (or Enter/Space) on them leads to the permission's own button. Hidden only where the permission API is.
  for(const row of document.querySelectorAll('.setting-row[data-requires-permission]')){
    if(isDeviceHidden(row))continue;
    const {available,granted,name}=permissionState(row.dataset.requiresPermission);
    row.hidden=!available;
    row.classList.toggle('is-inactive',!granted);
    row.classList.toggle('needs-permission',available && !granted);
    const control=row.querySelector('[data-setting], .setting-choice[data-choice]');
    if(control){if(granted)control.removeAttribute('aria-disabled');else control.setAttribute('aria-disabled','true');}
    permissionNote(row,control,available && !granted?'Needs ':'',name,'requires-note permission-note');
  }
  // Options that work without it but reach some embeds only through it: a one-line hint, not dimmed.
  for(const row of document.querySelectorAll('.setting-row[data-permission-hint]')){
    if(isDeviceHidden(row))continue;
    const {available,granted,partial,name}=permissionState(row.dataset.permissionHint);
    const control=row.querySelector('[data-setting], .setting-choice[data-choice]');
    const lead=!available?'':!granted?(row.dataset.permissionHintText || 'Embeds from Vimeo, Streamable, RedGIFs and Twitch need'):partial?'Embeds from YouTube and other sites need':'';
    permissionNote(row,control,lead?lead+' ':'',name,'permission-hint');
  }
}
function permissionState(id){
  const button=document.getElementById(id),row=button?.closest('.setting-row');
  const available=Boolean(button) && !row?.hidden;
  const label=document.querySelector('label[for="'+id+'"]');
  return {available,granted:available && button.dataset.granted==='true',partial:available && button.dataset.partial==='true',name:(label?.textContent || 'the permission').trim(),target:id};
}
// The note under a row's description, with the permission's name as a link-style button, named by its control.
function permissionNote(row,control,lead,name,className){
  const copy=row.querySelector('.setting-copy');
  let note=copy?.querySelector('[data-permission-note]');
  const id=(control?.id || row.dataset.requiresPermission || row.dataset.permissionHint)+'-permission-note';
  const described=new Set((control?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
  if(!lead){
    note?.remove();
    if(control && described.delete(id))control.setAttribute('aria-describedby',[...described].join(' '));
    return;
  }
  if(!note){
    note=document.createElement('p');note.dataset.permissionNote='';note.id=id;
    const link=document.createElement('button');link.type='button';link.className='permission-link';
    link.dataset.permissionTarget=row.dataset.requiresPermission || row.dataset.permissionHint;
    note.append(document.createTextNode(''),link);copy?.append(note);
  }
  note.className=className;note.firstChild.textContent=lead;note.lastChild.textContent=name;
  if(control && !described.has(id)){described.add(id);control.setAttribute('aria-describedby',[...described].join(' '));}
}
// Two clicks, no hunting: the dimmed option (or its note) scrolls to the permission's row, outlines it briefly and
// focuses its button; one more click grants.
function jumpToPermission(id){
  const button=document.getElementById(id),row=button?.closest('.setting-row');
  if(!button || !row || row.hidden)return;
  closeAllMenus();
  const reduced=Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
  row.scrollIntoView?.({block:'center',behavior:reduced?'auto':'smooth'});
  row.classList.remove('is-pulsing');void row.offsetWidth;row.classList.add('is-pulsing');
  clearTimeout(row.pulseTimer);row.pulseTimer=setTimeout(()=>row.classList.remove('is-pulsing'),1000);
  button.focus({preventScroll:true});
}
document.addEventListener('click',event=>{
  const link=event.target.closest?.('.permission-link'),row=event.target.closest?.('.setting-row.needs-permission');
  if(!link && !row)return;
  event.preventDefault();event.stopPropagation();
  jumpToPermission(link?link.dataset.permissionTarget:row.dataset.requiresPermission);
},true);
document.addEventListener('keydown',event=>{
  if(event.key!=='Enter' && event.key!==' ')return;
  const row=event.target.closest?.('.setting-row.needs-permission');
  if(!row || event.target.closest('.permission-link'))return;
  event.preventDefault();event.stopPropagation();
  jumpToPermission(row.dataset.requiresPermission);
},true);

// Accurate counters: count visible active booleans + visible overridden selectors; exclude historyLimit, clickAudio, action/permission buttons, and hidden device cards.
const isCountable=control=>!isDeviceHidden(control) && control.dataset.count!=='exclude';
function isControlActive(control){
  if(control.closest('.setting-row')?.classList.contains('is-inactive'))return false;
  if(control.hasAttribute('data-setting'))return Boolean(control.checked);
  if(control.hasAttribute('data-choice')){
    const view=choiceViews.get(control.dataset.choice);
    return Boolean(view && view.isModified());
  }
  return false;
}
function syncSummary(){
  const switches=[...document.querySelectorAll('[data-setting]')];
  const pill=document.querySelector('#raffles-home .state-pill');
  if(switches.some(c=>c.classList.contains('is-unavailable'))){
    const summary=document.getElementById('feature-summary');
    if(summary)summary.textContent='Settings unavailable';
    if(pill)pill.hidden=true;
    return;
  }
  const allControls=[...document.querySelectorAll('#panel-settings [data-setting], #panel-settings .setting-choice[data-choice], #panel-data [data-setting]')].filter(isCountable);
  const summary=document.getElementById('feature-summary');
  if(summary)summary.textContent=allControls.filter(isControlActive).length+' of '+allControls.length+' active';

  for(const card of document.querySelectorAll('#panel-settings .card')){
    if(isDeviceHidden(card))continue;
    const own=[...card.querySelectorAll('[data-setting], .setting-choice[data-choice]')].filter(isCountable);
    const count=card.querySelector('.group-count');
    if(!count)continue;
    const activeCount=own.filter(isControlActive).length;
    if(count.dataset.countMode==='media'){
      count.textContent=activeCount===0?'Default':activeCount+' of '+own.length+' active';
      count.classList.toggle('is-modified',activeCount>0);
    }else{
      count.textContent=activeCount+' of '+own.length+' on';
    }
  }

  // Smooth scrolling surfaces drawer live badge.
  const smoothBadge=document.getElementById('smooth-surfaces-badge');
  if(smoothBadge && smoothSurfacesBody){
    const surfaceControls=[...smoothSurfacesBody.querySelectorAll('[data-setting]')];
    const surfaceActive=surfaceControls.filter(c=>c.checked && !c.closest('.setting-row')?.classList.contains('is-inactive')).length;
    smoothBadge.hidden=surfaceControls.length===0;
    smoothBadge.textContent=surfaceActive+' of '+surfaceControls.length+' on';
  }
  // Enhancements drawer live badge & Videos & Embeds Reset button visibility.
  const enhBadge=document.getElementById('enhancements-badge');
  if(enhBadge && enhancementsBody){
    const enhControls=[...enhancementsBody.querySelectorAll('[data-setting], .setting-choice[data-choice]')].filter(isCountable);
    const enhActive=enhControls.filter(isControlActive).length;
    enhBadge.hidden=enhActive===0;
    enhBadge.textContent=enhActive>0?enhActive+' active':'';
  }
  const resetBtn=document.getElementById('reset-video-defaults');
  const videosCard=document.getElementById('videos-card');
  if(resetBtn && videosCard){
    const anyVideoModified=[...videosCard.querySelectorAll('[data-setting], .setting-choice[data-choice]')].some(c=>{
      if(isDeviceHidden(c) || c.closest('.setting-row')?.classList.contains('is-inactive'))return false;
      if(c.hasAttribute('data-setting'))return Boolean(c.checked)!==Boolean(VIDEO_DEFAULTS[c.dataset.setting]);
      const view=choiceViews.get(c.dataset.choice);
      return Boolean(view && view.isModified());
    });
    resetBtn.hidden=!anyVideoModified;
  }

  // Home Raffles card status pill + Turn on CTA.
  const raffles=document.getElementById('raffles'),raffleCard=document.getElementById('raffles-home');
  if(raffles && raffleCard){
    raffleCard.querySelector('.state-pill').textContent=raffles.checked?'On':'Off';
    raffleCard.dataset.state=raffles.checked?'on':'off';
    const turnOn=document.getElementById('raffles-turn-on');
    if(turnOn)turnOn.hidden=raffles.checked;
  }

  // Data tab Chat Search Paused indicator (Clear buttons stay active).
  const chatToggle=document.getElementById('chat-search'),pausedPill=document.getElementById('chat-paused-pill'),statsBox=document.getElementById('chat-stats-box');
  if(chatToggle){
    const paused=!chatToggle.checked;
    if(pausedPill)pausedPill.hidden=!paused;
    if(statsBox)statsBox.classList.toggle('is-paused',paused);
  }
}

try{const manifest=globalThis.chrome?.runtime?.getManifest?.();const version=document.querySelector('#version');if(manifest && version)version.textContent='v'+(manifest.version_name || manifest.version).replace(/ preview$/,'');}catch{}

// Redaction launcher
document.getElementById('open-redaction')?.addEventListener('click',async event=>{
  const button=event.currentTarget;button.disabled=true;
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    let url;try{url=new URL(tab?.url);}catch{}
    if(tab?.id!=null && url?.protocol==='https:' && ['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].includes(url.hostname)){
      let opened=false;try{opened=(await chrome.tabs.sendMessage(tab.id,{scope:'rt-redact',action:'open'},{frameId:0}))?.opened===true;}catch{}
      if(!opened){url.hash='rt-redact';await chrome.tabs.update(tab.id,{url:url.href});}
    }else await chrome.tabs.create({url:'https://www.reddit.com/user/me/#rt-redact'});
    window.close?.();
  }catch{button.disabled=false;document.getElementById('redaction-open-status').textContent='Couldn’t open Redaction. Open a Reddit page and try again.';}
});

// Tabs & scroll-fade
const TAB_KEY='rt-popup-tab',tabs=[...document.querySelectorAll('[role="tab"]')];
let selectedTab;
function showTab(name,{focus=false}={}){
  const tab=tabs.find(t=>t.dataset.tab===name) || tabs[0];
  if(selectedTab===tab){if(focus)tab.focus({preventScroll:true});return;}
  closeAllMenus();
  selectedTab=tab;
  for(const t of tabs){
    const on=t===tab;
    t.setAttribute('aria-selected',String(on));
    t.tabIndex=on?0:-1;
    document.getElementById(t.getAttribute('aria-controls')).hidden=!on;
  }
  const statusBar=document.getElementById('settings-status');
  if(statusBar)statusBar.dataset.inactive=String(tab.dataset.tab!=='settings' && !statusBar.classList.contains('error'));
  if(focus)tab.focus({preventScroll:true});
  try{localStorage.setItem(TAB_KEY,tab.dataset.tab);}catch{}
  if(tab.dataset.tab==='data' && !messageStatsRead)updateMessageStats();
  if(tab.dataset.tab==='settings')loadRemovalAccount();
  settled();
}
function syncFade(panel){if(!panel)return;const room=panel.scrollHeight-panel.clientHeight,top=panel.scrollTop;panel.dataset.more=room<=1?'none':top<=1?'end':top>=room-1?'start':'both';}
let fadePending=false;
function settled(){
  if(isTouch || fadePending)return;
  fadePending=true;
  frame(()=>{fadePending=false;syncFade(document.querySelector('.panel:not([hidden])'));});
}
for(const panel of document.querySelectorAll('.panel'))panel.addEventListener('scroll',settled,{passive:true});
for(const tab of tabs){
  tab.addEventListener('click',()=>showTab(tab.dataset.tab));
  tab.addEventListener('keydown',event=>{
    const at=tabs.indexOf(tab),next={ArrowRight:(at+1)%tabs.length,ArrowLeft:(at-1+tabs.length)%tabs.length,Home:0,End:tabs.length-1}[event.key];
    if(next==null)return;event.preventDefault();showTab(tabs[next].dataset.tab,{focus:true});
  });
}
document.getElementById('manage-features')?.addEventListener('click',()=>showTab('settings',{focus:true}));
document.addEventListener('change',event=>{if(event.target.matches?.('[data-setting]')){syncDependencies();syncSummary();settled();}});
document.getElementById('raffles-turn-on')?.addEventListener('click',()=>{
  const raffles=document.getElementById('raffles');
  if(!raffles || raffles.disabled || raffles.checked)return;
  raffles.checked=true;raffles.dispatchEvent(new Event('change',{bubbles:true}));
});

// Removal account check clearing (scoped to active signed-in Reddit tab).
let removalTab=null,removalAccount=null,removalClearTimer=null,removalRead=0,removalClearing=false;
async function loadRemovalAccount(){
  const clear=document.getElementById('clear-removal-history');if(!clear)return;
  const read=++removalRead;
  removalAccount=null;removalTab=null;clear.disabled=true;
  clearTimeout(removalClearTimer);removalClearTimer=null;clear.textContent='Clear this account’s checks';
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!Number.isInteger(tab?.id) || !/^https:\/\/(?:www\.|new\.|sh\.)?reddit\.com\//.test(tab.url || ''))throw Error('Open a signed-in Reddit tab to manage your checks.');
    const result=await chrome.runtime.sendMessage({scope:'rt-removal',action:'identity',tabId:tab.id});
    if(read!==removalRead || !result?.ok || !/^[\w-]{1,20}$/.test(result.value?.username || ''))return;
    removalTab=tab.id;removalAccount=result.value;clear.disabled=removalClearing;
  }catch{}
}
document.getElementById('clear-removal-history')?.addEventListener('click',async event=>{
  const button=event.currentTarget;if(removalTab==null)return;
  if(!removalClearTimer){
    button.textContent='Confirm clear for u/'+removalAccount.username;
    removalClearTimer=setTimeout(()=>{removalClearTimer=null;button.textContent='Clear this account’s checks';},6000);
    return;
  }
  clearTimeout(removalClearTimer);removalClearTimer=null;removalClearing=true;button.disabled=true;
  try{
    const result=await chrome.runtime.sendMessage({scope:'rt-removal',action:'clear',tabId:removalTab,owner:removalAccount?.owner});
    if(!result?.ok)throw Error(result?.error);
    document.getElementById('removal-status').textContent='This account’s checks cleared. New observations start a fresh baseline.';
    await loadRemovalAccount();
  }catch{document.getElementById('removal-status').textContent='Could not clear checks. Please retry.';}
  finally{removalClearing=false;button.disabled=removalTab==null;button.textContent='Clear this account’s checks';}
});

initChoices();
loadDirectEmbedControls();
loadSettings();
{let saved='';try{saved=localStorage.getItem(TAB_KEY) || '';}catch{}showTab(saved || 'home');}
