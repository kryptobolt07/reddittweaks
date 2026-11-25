const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const ICON='https://styles.redditmedia.com/t5_2qh1i/styles/communityIcon_abc123.png?width=256&amp;s=sig';
const card=(src=ICON,extra='')=>'<div class="hover"><img src="https://styles.redditmedia.com/t5_2qh1i/styles/bannerBackgroundImage_zzz.png"><img alt="" src="'+src+'">'+extra+'</div>';
function load(html='<body></body>'){
  const dom=new JSDOM(html,{url:'https://www.reddit.com/user/Example/',runScripts:'outside-only'});dom.window.eval(fs.readFileSync('extension/community-icons.js','utf8'));return {W:dom.window,I:dom.window.RTCommunityIcons};
}
// A manual clock: timers only fire when the test advances it.
function clock(){let time=1000,seq=0;const timers=new Map();return {now:()=>time,setTimer:(fn,ms)=>{const id=++seq;timers.set(id,{at:time+ms,fn});return id;},
  async advance(ms){const end=time+ms;for(;;){const due=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;timers.delete(due[0]);time=Math.max(time,due[1].at);due[1].fn();await new Promise(r=>setImmediate(r));}time=end;await new Promise(r=>setImmediate(r));}};}
const reply=(status,body='')=>({status,ok:status>=200&&status<300,text:async()=>body});
test('the page is the first source and only safe Reddit-hosted icons are accepted',t=>{
  const {W,I}=load('<body><shreddit-post subreddit-name="Alpha"><div slot="credit-bar"><span avatar><img src="https://styles.redditmedia.com/t5_1/styles/communityIcon_a.png"></span></div></shreddit-post>'
    +'<a href="/r/beta/"><img src="https://styles.redditmedia.com/t5_2/styles/communityIcon_b.png"></a><a href="/r/gamma/"><img src="https://evil.example/communityIcon_c.png"></a>'
    +'<a href="/r/delta/"><img src="https://styles.redditmedia.com/t5_4/styles/bannerBackgroundImage_d.png"></a><a href="/user/spez/"><img src="https://www.redditstatic.com/avatars/defaults/v2/avatar_default_1.png"></a></body>');t.after(()=>W.close());
  assert.equal(I.peek('alpha'),'https://styles.redditmedia.com/t5_1/styles/communityIcon_a.png');assert.equal(I.peek('r/Beta'),'https://styles.redditmedia.com/t5_2/styles/communityIcon_b.png');
  assert.equal(I.peek('gamma'),undefined);assert.equal(I.peek('delta'),undefined);assert.equal(I.peek('u_spez'),'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_1.png');
  assert.equal(I.peek('u_nobody'),undefined);assert.equal(I.peek('bad name!'),null);
  let fetched=0;const api=I.create({fetch:async()=>{fetched++;return reply(200,'');},doc:()=>W.document,Parser:()=>W.DOMParser,hint:name=>name==='hinted'?'https://styles.redditmedia.com/t5_9/styles/communityIcon_h.png':'',setTimer:(fn)=>setTimeout(fn,0),gap:0});
  return Promise.all([api.get('alpha'),api.get('hinted'),api.get('u_nobody')]).then(([a,h,u])=>{assert.match(a,/communityIcon_a/);assert.match(h,/communityIcon_h/);assert.equal(u,null);assert.equal(fetched,0,'page and hint sources need no request');});
});

test('a burst shares DOM candidate scans and URL parsing without retaining the observer',async t=>{
  const {W,I}=load('<body>'+Array.from({length:250},(_,i)=>'<a href="/wiki/'+i+'"></a>').join('')+'</body>');
  t.after(()=>W.close());
  const query=W.document.querySelectorAll.bind(W.document);
  const URL=W.URL,Observer=W.MutationObserver,scans=[];
  let parses=0,connected=0;
  W.document.querySelectorAll=(selector)=>{scans.push(selector);return query(selector);};
  W.URL=class extends URL{
    constructor(value,base){super(value,base);if(String(value).startsWith('/wiki/'))parses++;}
  };
  W.MutationObserver=class extends Observer{
    observe(...args){super.observe(...args);connected++;}
    disconnect(){connected--;super.disconnect();}
  };
  const api=I.create({storage:null,hint:()=>''});
  for(let i=0;i<32;i++){
    assert.equal(api.peek('missing'+i),undefined);
    const item=W.document.createElement('li');item.append(W.document.createElement('button'));W.document.body.append(item);
  }
  assert.deepEqual(scans,['shreddit-post[subreddit-name]','a[href]']);
  assert.equal(parses,250);
  assert.equal(connected,1);
  await Promise.resolve();
  assert.equal(connected,0);
  assert.equal(api.peek('missing-after-burst'),undefined);
  assert.equal(scans.length,4);
  assert.equal(parses,500);
});

test('DOM icon lookup retains candidate precedence, path rules and the first 3000 anchors',t=>{
  const img=name=>'<img src="https://styles.redditmedia.com/t5_x/styles/communityIcon_'+name+'.png">';
  const link=(href,name)=>'<a href="'+href+'">'+img(name)+'</a>';
  const filler='<a href="/wiki/other"></a>'.repeat(2994);
  const {W,I}=load('<body><shreddit-post subreddit-name="ALPHA"><div slot="credit-bar"><span avatar>'+img('card')+'</span></div></shreddit-post>'
    +link('https://example.test/R/ALPHA///?other=yes#fragment','link')
    +link('/U/SPEZ///?sort=new','alias')+link('/user/spez/','user')
    +link('/r/%68ere/','encoded')+filler
    +'<a href="/r/here/"><span avatar><img src="https://other.test/failed"></span>'+img('ignored')+'</a>'
    +link('/r/edge/','edge')+link('/r/outside/','outside')+'</body>');
  t.after(()=>W.close());
  const api=I.create({storage:null,hint:()=>''});
  assert.match(api.peek('r/alpha'),/communityIcon_card/);
  assert.match(api.peek('u_Spez'),/communityIcon_alias/,'both profile path forms keep their original interleaved order');
  assert.match(api.peek('edge'),/communityIcon_edge/);
  assert.equal(api.peek('here'),undefined,'encoded path and a rejected preferred image cannot supply an icon');
  assert.equal(api.peek('outside'),undefined);
  W.document.querySelector('[href="/wiki/other"]').remove();
  assert.match(api.peek('outside'),/communityIcon_outside/,'unrelated anchors still count toward the cutoff');
  const first=W.document.querySelector('a[href]');first.href='https://example.test/R/External///?other=yes#fragment';
  assert.match(api.peek('external'),/communityIcon_link/,'matching remains based on the URL path');
  const hinted=I.create({storage:null,hint:()=> 'https://styles.redditmedia.com/t5_x/styles/communityIcon_hint.png'});
  assert.match(hinted.peek('alpha'),/communityIcon_hint/,'a discovery hint precedes post and link candidates');
  hinted.prime('alpha','https://styles.redditmedia.com/t5_x/styles/communityIcon_cached.png');
  assert.match(hinted.peek('alpha'),/communityIcon_cached/,'the cache precedes hints');
});

test('uncached lookups reflect synchronous link, card and image changes in the same burst',t=>{
  const {W,I}=load('<body><div id="remove"><a href="/r/removed/"><img src="https://styles.redditmedia.com/communityIcon_removed.png"></a></div>'
    +'<a id="link" href="/r/previous/"><img src="https://styles.redditmedia.com/communityIcon_link.png"></a>'
    +'<shreddit-post subreddit-name="previous"><span slot="credit-bar"><img src="https://styles.redditmedia.com/communityIcon_card.png"></span></shreddit-post>'
    +'<a id="live" href="/r/live/" style="color: #abc"><img src="https://example.test/communityIcon_live.png"></a></body>');
  t.after(()=>W.close());
  const api=I.create({storage:null,hint:()=>''});
  assert.equal(api.peek('newlink'),undefined);
  W.document.getElementById('remove').remove();
  assert.equal(api.peek('removed'),undefined);
  W.document.getElementById('link').setAttribute('href','/r/NewLink/');
  assert.match(api.peek('newlink'),/communityIcon_link/);
  W.document.querySelector('shreddit-post').setAttribute('subreddit-name','NewCard');
  assert.match(api.peek('newcard'),/communityIcon_card/);
  assert.equal(api.peek('live'),undefined);
  const img=W.document.querySelector('#live img');
  img.src='https://styles.redditmedia.com/communityIcon_live.png';
  img.setAttribute('style','color: #ABC');
  assert.match(api.peek('live'),/communityIcon_live/);
  assert.equal(api.color('Live'),'#ABC');
  const container=W.document.createElement('div');container.innerHTML='<a href="/r/added"><img src="https://styles.redditmedia.com/communityIcon_added.png"></a>';
  W.document.body.append(container);
  assert.match(api.peek('added'),/communityIcon_added/);
});
test('hover card: header, icon choice, banned communities and negative caching',async t=>{
  const {W,I}=load();t.after(()=>W.close());const clk=clock(),calls=[];
  const bodies={good:card(),other:'<img src="https://www.redditstatic.com/avatars/defaults/v2/avatar_default_2.png"><img src="https://styles.redditmedia.com/x/bannerBackgroundImage_q.png">',banned:'',bannerOnly:'<img src="https://styles.redditmedia.com/x/bannerBackgroundImage_q.png"><img src="https://evil.example/a.png">',missing:null};
  const api=I.create({fetch:async(url,init)=>{calls.push([url,init]);const name=decodeURIComponent(url.split('/').pop());return bodies[name]===null?reply(404):reply(200,bodies[name]);},doc:()=>W.document,Parser:()=>W.DOMParser,now:clk.now,setTimer:clk.setTimer});
  const results={};for(const name of Object.keys(bodies))results[name]=api.get(name);
  await clk.advance(1000);
  assert.equal(await results.good,'https://styles.redditmedia.com/t5_2qh1i/styles/communityIcon_abc123.png?width=256&s=sig');
  assert.equal(await results.other,'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_2.png');assert.equal(await results.banned,null);assert.equal(await results.bannerOnly,null);assert.equal(await results.missing,null);
  assert.equal(calls[0][0],'/svc/shreddit/community-hover-card/good');assert.equal(calls[0][1].headers.Accept,'text/vnd.reddit.partial+html, text/html;q=0.9');
  const before=calls.length;assert.equal(await api.get('banned'),null);assert.equal(await api.get('GOOD') ,await results.good);assert.equal(calls.length,before,'results, including empty ones, are cached');
  assert.equal(api.peek('banned'),null);assert.equal(api.peek('never-seen'),undefined);
});
test('at most four requests are in flight and starts are spaced about 60 ms apart',async t=>{
  const {W,I}=load();t.after(()=>W.close());const clk=clock(),starts=[],gates=[];let live=0,peak=0;
  const api=I.create({fetch:()=>new Promise(resolve=>{starts.push(clk.now());live++;peak=Math.max(peak,live);gates.push(()=>{live--;resolve(reply(200,card()));});}),doc:()=>W.document,Parser:()=>W.DOMParser,now:clk.now,setTimer:clk.setTimer,storage:()=>null});
  const all=['a','b','c','d','e','f'].map(n=>api.get(n));
  await clk.advance(0);assert.equal(starts.length,1);await clk.advance(60);assert.equal(starts.length,2);await clk.advance(2000);assert.equal(starts.length,4,'four in flight, the rest wait');
  gates.shift()();await clk.advance(0);assert.equal(starts.length,5);
  while(gates.length||starts.length<6){gates.shift()?.();await clk.advance(100);}
  await Promise.all(all);assert.equal(peak,4);assert.equal(api.stats().queued,0);
  for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=60,'spacing '+(starts[i]-starts[i-1]));
});
test('icons sent with results are primed, and the cache survives a reload within the session',async t=>{
  const {W,I}=load();t.after(()=>W.close());let fetched=0;const fetch=async()=>{fetched++;return reply(200,card());};
  const first=I.create({fetch,doc:()=>W.document,Parser:()=>W.DOMParser,storage:()=>W.sessionStorage,setTimer:(fn)=>{fn();return 0;}});
  assert.equal(first.prime('Alpha','https://styles.redditmedia.com/t5_a/styles/communityIcon_a.png'),true);assert.equal(first.prime('Beta','https://evil.example/x.png'),false);
  assert.equal(await first.get('alpha'),'https://styles.redditmedia.com/t5_a/styles/communityIcon_a.png');assert.equal(fetched,0);
  const second=I.create({fetch,doc:()=>W.document,Parser:()=>W.DOMParser,storage:()=>W.sessionStorage});assert.equal(second.peek('Alpha'),'https://styles.redditmedia.com/t5_a/styles/communityIcon_a.png');assert.equal(fetched,0);
});
test('a 429 stops requests for 60 seconds and is not cached',async t=>{
  const {W,I}=load();t.after(()=>W.close());const clk=clock(),calls=[];let limited=true;
  const api=I.create({fetch:async url=>{calls.push(url);return limited?reply(429):reply(200,card());},doc:()=>W.document,Parser:()=>W.DOMParser,now:clk.now,setTimer:clk.setTimer});
  const first=api.get('one');await clk.advance(500);assert.equal(await first,null);assert.equal(calls.length,1);assert.equal(api.peek('one'),undefined);
  limited=false;const second=api.get('two');await clk.advance(30000);assert.equal(calls.length,1,'paused');
  await clk.advance(31000);assert.equal(calls.length,2);assert.match(await second,/communityIcon_abc123/);
  const retry=api.get('one');await clk.advance(1000);assert.match(await retry,/communityIcon/);
});
test('the cache keeps the most recently used entries only',async t=>{
  const {W,I}=load();t.after(()=>W.close());const clk=clock();let calls=0;
  const api=I.create({fetch:async()=>{calls++;return reply(200,card());},doc:()=>W.document,Parser:()=>W.DOMParser,now:clk.now,setTimer:clk.setTimer,gap:0,max:3});
  for(const n of ['a','b','c']){const p=api.get(n);await clk.advance(10);await p;}
  api.peek('a');const d=api.get('d');await clk.advance(10);await d;
  assert.equal(api.peek('a')!==undefined,true);assert.equal(api.peek('b'),undefined,'least recently used entry dropped');assert.equal(api.stats().cached,3);
  assert.equal(I.create.length,0);
});
test('hover card: Reddit\'s marked icon wins over emojis, a glyph means no image, and the colour is kept',async t=>{
  const {W,I}=load();t.after(()=>W.close());
  const banner='<img src="https://styles.redditmedia.com/t5_1/styles/bannerBackgroundImage_b.png">';
  const emoji='<img src="https://emoji.redditmedia.com/abc_t5_1/Verified">';
  const legacy=banner+'<span avatar><span><img class="mb-0 shreddit-subreddit-icon__icon rounded-full" src="https://b.thumbs.redditmedia.com/Old.png" style="color: #AF6401;background: #AF6401;width: 48px;"></span></span>'+emoji;
  const glyph=banner+emoji+'<span avatar><span><svg icon-name="community-fill" style="color: #3299cd;"></svg></span></span>';
  assert.deepEqual({...I.readCard(legacy,W.DOMParser)},{url:'https://b.thumbs.redditmedia.com/Old.png',color:'#AF6401'});
  assert.deepEqual({...I.readCard(glyph,W.DOMParser)},{url:null,color:'#3299CD'});
  assert.equal(I.parseCard(glyph,W.DOMParser),null,'never a flair emoji');
  assert.equal(I.safeColor('red;background:url(x)'),'');
  const bodies={legacy,glyph};
  const api=I.create({fetch:async url=>reply(200,bodies[url.split('/').pop()]),doc:()=>W.document,Parser:()=>W.DOMParser,setTimer:fn=>{fn();return 0;},gap:0,storage:()=>W.sessionStorage});
  assert.equal(await api.get('legacy'),'https://b.thumbs.redditmedia.com/Old.png');assert.equal(api.color('Legacy'),'#AF6401');
  assert.equal(await api.get('glyph'),null);assert.equal(api.color('glyph'),'#3299CD');assert.equal(api.color('unknown'),'');
  const again=I.create({fetch:async()=>reply(500),doc:()=>W.document,Parser:()=>W.DOMParser,storage:()=>W.sessionStorage});
  assert.equal(again.color('legacy'),'#AF6401','colours survive a reload within the session');
});
