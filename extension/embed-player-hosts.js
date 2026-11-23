/* The only third-party documents eligible for direct controls (docs/video-control-spec.md, Direct embed controls).
   The first set is the original grant; every other embed provider Reddit shows, directly or inside Embedly's wrapper,
   is checked host by host, so an existing grant keeps working and one more Grant access adds the rest. */
(() => {
  const redditOrigins=['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].map(host=>'https://'+host);
  const wrapperOrigin='https://cdn.embedly.com';
  const corePaths={
    'www.redgifs.com':['/ifr/'],
    'player.vimeo.com':['/video/'],
    'streamable.com':['/e/','/o/'],
    'clips.twitch.tv':['/embed'],
    'player.twitch.tv':['/'],
    'cdn.embedly.com':['/widgets/media.html']
  };
  // Player documents of the other video providers Reddit embeds. Each is the provider's embed page only.
  const extraPaths={
    'www.youtube.com':['/embed/'],
    'www.youtube-nocookie.com':['/embed/'],
    'www.dailymotion.com':['/embed/'],
    'geo.dailymotion.com':['/player/','/player.html'],
    'www.tiktok.com':['/embed/','/player/'],
    'rumble.com':['/embed/'],
    'player.kick.com':['/'],
    'giphy.com':['/embed/'],
    'platform.twitter.com':['/embed/'],
    'www.facebook.com':['/plugins/video.php'],
    'www.instagram.com':['/p/','/reel/'],
    'player.bilibili.com':['/player.html'],
    'medal.tv':['/clip/','/games/'],
    'streamff.com':['/v/'],
    'streamja.com':['/embed/'],
    'imgur.com':['/a/'],
    'gfycat.com':['/ifr/']
  };
  const providerNames={'www.youtube.com':'YouTube','www.youtube-nocookie.com':'YouTube','www.dailymotion.com':'Dailymotion','geo.dailymotion.com':'Dailymotion',
    'www.tiktok.com':'TikTok','rumble.com':'Rumble','player.kick.com':'Kick','giphy.com':'GIPHY','platform.twitter.com':'X','www.facebook.com':'Facebook',
    'www.instagram.com':'Instagram','player.bilibili.com':'Bilibili','medal.tv':'Medal','streamff.com':'Streamff','streamja.com':'Streamja','imgur.com':'Imgur','gfycat.com':'Gfycat'};
  const paths={...corePaths,...extraPaths};
  const hostOrigin=host=>'https://'+host+'/*';
  const origins=[...Object.keys(corePaths),'vimeo.com'].map(hostOrigin);
  const extraOrigins=Object.keys(extraPaths).map(hostOrigin);
  const allOrigins=[...origins,...extraOrigins];
  const hostMatches=host=>paths[host].map(path=>'https://'+host+path+'*');
  const matches=Object.keys(corePaths).flatMap(hostMatches);
  const allMatches=Object.keys(paths).flatMap(hostMatches);
  function playerOrigin(value){
    try{
      const url=new URL(value);
      if(url.protocol==='https:' && !url.port && !url.username && !url.password &&
        Object.hasOwn(paths,url.hostname) && paths[url.hostname].some(path=>path.endsWith('/')?url.pathname.startsWith(path):url.pathname===path))return url.origin;
    }catch{}
    return '';
  }
  const isExtra=origin=>{try{return Object.hasOwn(extraPaths,new URL(origin).hostname);}catch{return false;}};
  // {core, hosts}: the original grant, and the extra provider hosts granted so far.
  async function access(api){
    if(!api?.permissions?.contains)return {core:false,hosts:[]};
    const core=await api.permissions.contains({origins});
    const hosts=[];
    for(const host of Object.keys(extraPaths))if(await api.permissions.contains({origins:[hostOrigin(host)]}))hosts.push(host);
    return {core,hosts};
  }
  const missingProviders=granted=>[...new Set(Object.keys(extraPaths).filter(host=>!granted.includes(host)).map(host=>providerNames[host] || host))];
  async function ensureScripts(api){
    if(!api.scripting?.getRegisteredContentScripts)return false;
    const {core,hosts}=await access(api);
    if(!core)return false;
    const scriptMatches=[...matches,...hosts.flatMap(hostMatches)];
    const scripts=[
      {id:'rt-embed-player',matches:scriptMatches,js:['embed-player-hosts.js','embed-player.js'],allFrames:true,runAt:'document_start',persistAcrossSessions:true},
      {id:'rt-embed-player-main',matches:scriptMatches,js:['embed-player-main.js'],allFrames:true,runAt:'document_start',world:'MAIN',persistAcrossSessions:true}
    ];
    const registered=new Map((await api.scripting.getRegisteredContentScripts({ids:scripts.map(script=>script.id)})).map(script=>[script.id,script]));
    for(const script of scripts){
      const current=registered.get(script.id);
      if(current){
        // A grant (or revoke) of extra providers changes the frames the script runs in.
        const same=current.matches?.length===script.matches.length && script.matches.every(match=>current.matches.includes(match));
        if(same)continue;
        try{
          if(api.scripting.updateContentScripts)await api.scripting.updateContentScripts([{id:script.id,matches:script.matches}]);
          else{await api.scripting.unregisterContentScripts({ids:[script.id]});await api.scripting.registerContentScripts([script]);}
        }catch(error){if(script.world!=='MAIN')throw error;}
        continue;
      }
      try{await api.scripting.registerContentScripts([script]);}
      catch(error){
        if(script.world==='MAIN')continue;
        const concurrent=await api.scripting.getRegisteredContentScripts({ids:[script.id]});
        if(!concurrent.some(item=>item.id===script.id))throw error;
      }
    }
    return true;
  }
  globalThis.RTEmbedHosts={redditOrigins,wrapperOrigin,origins,extraOrigins,allOrigins,matches,allMatches,providerNames,playerOrigin,isExtra,access,missingProviders,ensureScripts};
})();
