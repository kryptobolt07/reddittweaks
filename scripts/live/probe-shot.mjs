// Screenshot clipped to page regions, searching open shadow roots (cdp.mjs shot only sees the light DOM).
// Usage: [RELAY_PORT=9334] node scripts/live/probe-shot.mjs <session> <out.png> ['<topSelector>' ['<bottomSelector>' --index N]]
// Clips from the top of topSelector down to the Nth visible match of bottomSelector. No selector: the viewport.
import fs from 'node:fs';
import {call,ev,PAGE_HELPERS,parseArgs} from './relay-client.mjs';
const {positional:[session,out,top,bottom],options}=parseArgs(process.argv.slice(2));
if(!session || !out){console.error("usage: probe-shot.mjs <session> <out.png> ['<top>' ['<bottom>' --index N]]");process.exit(2);}
let clip;
if(top){
  clip=await ev(session,`(()=>{${PAGE_HELPERS}
  const t=first(${JSON.stringify(top)});if(!t)return null;const a=t.getBoundingClientRect();let b=a;
  ${bottom?`const bs=deep(${JSON.stringify(bottom)}).filter(vis);const bb=bs[${+(options.index||0)}]||bs[bs.length-1];if(bb)b=bb.getBoundingClientRect();`:''}
  const x=Math.min(a.x,b.x),right=Math.max(a.right,b.right),bottomEdge=Math.max(a.bottom,b.bottom);
  return {x:x+scrollX,y:a.y+scrollY,width:right-x,height:Math.min(bottomEdge-a.y,4000),scale:1};})()`);
  if(!clip){console.error('no visible match for',top);process.exit(1);}
}
const shot=await call('Page.captureScreenshot',{format:'png',...(clip?{clip,captureBeyondViewport:true}:{})},session);
fs.writeFileSync(out,Buffer.from(shot.data,'base64'));
console.log('saved',out,clip?`${Math.round(clip.width)}x${Math.round(clip.height)} at ${Math.round(clip.x)},${Math.round(clip.y)}`:'(viewport)');
