/* The only third-party documents eligible for direct controls. */
(() => {
  const redditOrigins=['reddit.com','www.reddit.com','new.reddit.com','sh.reddit.com'].map(host=>'https://'+host);
  const wrapperOrigin='https://cdn.embedly.com';
  const paths={
    'www.redgifs.com':['/ifr/'],
    'player.vimeo.com':['/video/'],
    'streamable.com':['/e/','/o/'],
    'clips.twitch.tv':['/embed'],
    'player.twitch.tv':['/'],
    'cdn.embedly.com':['/widgets/media.html']
  };
  const origins=[...Object.keys(paths),'vimeo.com'].map(host=>'https://'+host+'/*');
  const matches=Object.entries(paths).flatMap(([host,entries])=>entries.map(path=>'https://'+host+path+'*'));
  function playerOrigin(value){
    try{
      const url=new URL(value);
      if(url.protocol==='https:' && !url.port && !url.username && !url.password &&
        Object.hasOwn(paths,url.hostname) && paths[url.hostname].some(path=>path.endsWith('/')?url.pathname.startsWith(path):url.pathname===path))return url.origin;
    }catch{}
    return '';
  }
  async function ensureScripts(api){
    if(!api.scripting?.getRegisteredContentScripts || !await api.permissions.contains({origins}))return false;
    const scripts=[
      {id:'rt-embed-player',matches,js:['embed-player-hosts.js','embed-player.js'],allFrames:true,runAt:'document_start',persistAcrossSessions:true},
      {id:'rt-embed-player-main',matches,js:['embed-player-main.js'],allFrames:true,runAt:'document_start',world:'MAIN',persistAcrossSessions:true}
    ];
    const registered=new Set((await api.scripting.getRegisteredContentScripts({ids:scripts.map(script=>script.id)})).map(script=>script.id));
    for(const script of scripts){
      if(registered.has(script.id))continue;
      try{await api.scripting.registerContentScripts([script]);}
      catch(error){
        if(script.world==='MAIN')continue;
        const concurrent=await api.scripting.getRegisteredContentScripts({ids:[script.id]});
        if(!concurrent.some(item=>item.id===script.id))throw error;
      }
    }
    return true;
  }
  globalThis.RTEmbedHosts={redditOrigins,wrapperOrigin,origins,matches,playerOrigin,ensureScripts};
})();
