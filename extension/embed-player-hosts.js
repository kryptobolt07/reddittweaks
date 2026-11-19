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
  globalThis.RTEmbedHosts={redditOrigins,wrapperOrigin,origins,matches,playerOrigin};
})();
