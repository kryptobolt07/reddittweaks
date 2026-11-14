// Synthetic data for the raffle fixture: invented users and comments, fake bridge and fake Reddit Raffler answers.
(() => {
  const params=new URLSearchParams(location.search),state=params.get('state') || 'none',screen=params.get('screen') || 'rules';
  if(params.get('theme')==='dark')document.documentElement.dataset.theme='dark';
  const now=Math.floor(Date.now()/1000),avatar=i=>'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_'+(i%8)+'.png';
  const lines=['Count me in, thanks for running this!','I’d love a copy. Been wanting to try this one with my family for ages, and the art looks fantastic. Good luck everyone!','In!','Thanks for the giveaway. My game group meets on Fridays and this would be perfect.\nAlso, great photos.','Entering, fingers crossed','Very generous of you. In please!'];
  const names=['maple_otter','quietcomet','DiceAndTea','northwind_88','Lantern_Fox','pixel_moss','HarborGray','tinyorchard','Velvet_Rook','sunlit_quill'];
  const comments=names.map((name,i)=>({id:'c'+i,author:name,created_utc:now-3600*(i+1)*3,parent_id:'t3_fix123',body:lines[i%lines.length],permalink:'/r/FixtureGames/comments/fix123/giveaway/c'+i+'/',avatar:avatar(i)}));
  const raffle={postId:'fix123',url:'https://www.redditraffler.com/raffles/fix123',verified:true,creator:'FixtureHost',created:'November 15 2026, 1:07am',criteria:{minAge:30,minComment:0,minLink:0},ignored:['AutoModerator','FixtureHost'],
    winners:[2,5,7].map(i=>({username:names[i],commentUrl:'https://reddit.com/r/FixtureGames/comments/fix123/giveaway/c'+i+'/',commentId:'c'+i,accountAgeDays:120+i*37,commentKarma:400+i,linkKarma:20+i}))};
  const read=async args=>{
    await new Promise(r=>setTimeout(r,150));
    if(args.action==='raffle-thread')return {post:{author:'FixtureHost',subreddit:'FixtureGames',numComments:14},entries:comments,missingTopLevel:[],missingReplies:0};
    if(args.action==='raffle-user'){const i=names.indexOf(args.username);return {userId:'id'+i,created:now-86400*400,commentKarma:500,postKarma:50,avatar:avatar(i)};}
    if(args.action==='chat-status')return {ready:true};
    return {sent:true};
  };
  let created=false;
  const raffler=async m=>{
    await new Promise(r=>setTimeout(r,200));
    if(state==='unavailable')throw Error('Reddit Raffler is unreachable.');
    if(m.action==='session')return {ok:true,signedIn:'FixtureHost'};
    if(m.action==='status')return state==='exists' || created?{ok:true,exists:true,raffle}:{ok:true,exists:false};
    if(m.action==='create'){created=true;return {ok:true,queued:true,signedIn:'FixtureHost'};}
    if(m.action==='job')return {ok:true,status:'Done!',error:false};
    return {ok:true};
  };
  const instance=new RTRaffle.Raffle({observe:true,read,raffler,readSettings:async()=>({raffles:true}),random:()=>0});
  globalThis.RTRaffleFixture=instance;
  // Open the requested screen automatically for screenshots.
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  (async()=>{
    await instance.ready;await wait(50);
    document.querySelector('[data-rt-raffle="item"] [role="menuitem"]').click();
    await wait(800);const d=instance.dialog;if(!d)return;
    const choose=v=>{const radio=document.querySelector('input[name="rt-raffle-draw"][value="'+v+'"]');radio.checked=true;radio.dispatchEvent(new Event('change'));};
    if(screen==='private'){choose('private');}
    if(screen==='results' || screen==='message'){choose('private');d.winners.value='3';d.winners.dispatchEvent(new Event('input',{bubbles:true}));d.drawButton.click();await wait(600);}
    if(screen==='official' && state==='none'){d.drawButton.click();await wait(100);d.drawButton.click();await wait(2700);}
    if(screen==='confirm'){d.drawButton.click();await wait(100);}
    if(screen==='message'){d.message.click();await wait(200);}
    document.documentElement.dataset.ready='true';
  })();
})();
