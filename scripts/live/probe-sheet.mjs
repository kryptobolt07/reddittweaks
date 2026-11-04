// Contact sheet: several screenshots in one labelled image, so a visual judge reads one image instead of many.
// Usage: [RELAY_PORT=9334] node scripts/live/probe-sheet.mjs <out.png> 'a.png=Native feed' 'b.png=Archive feed' ... [--cols 2] [--width 1400]
// Pair native and ours side by side (native first). Uses a temporary blank tab in the relay's browser and closes it.
import fs from 'node:fs';import path from 'node:path';
import {call,sleep,parseArgs} from './relay-client.mjs';
const {positional:[out,...items],options}=parseArgs(process.argv.slice(2));
if(!out || !items.length){console.error("usage: probe-sheet.mjs <out.png> 'file.png=Label' ... [--cols 2] [--width 1400]");process.exit(2);}
const cols=+(options.cols||2),width=+(options.width||1400);
const cells=items.map(item=>{const i=item.indexOf('='),file=i>0?item.slice(0,i):item,label=i>0?item.slice(i+1):path.basename(file);
  return `<figure><figcaption>${label.replace(/[<&]/g,'')}</figcaption><img src="data:image/png;base64,${fs.readFileSync(file).toString('base64')}"></figure>`;}).join('');
const html=`<style>body{margin:0;padding:12px;background:#fff;font:600 15px system-ui,sans-serif;display:grid;align-items:start;grid-template-columns:repeat(${cols},1fr);gap:12px;width:${width-24}px}
figure{margin:0;border:1px solid #ccc;border-radius:6px;overflow:hidden}figcaption{padding:6px 8px;background:#eef1f3;color:#111}img{display:block;width:100%;height:auto}</style>${cells}`;
const {targetId}=await call('Target.createTarget',{url:'about:blank',background:true});
try{
  const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  await call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:false},sessionId);
  const {frameTree}=await call('Page.getFrameTree',{},sessionId);
  await call('Page.setDocumentContent',{frameId:frameTree.frame.id,html},sessionId);
  for(let i=0;i<50;i++){const r=await call('Runtime.evaluate',{expression:'[...document.images].every(i=>i.complete)',returnByValue:true},sessionId);if(r.result.value)break;await sleep(100);}
  const size=(await call('Runtime.evaluate',{expression:'({w:document.documentElement.scrollWidth,h:document.documentElement.scrollHeight})',returnByValue:true},sessionId)).result.value;
  const shot=await call('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:size.w,height:Math.min(size.h,8000),scale:1},captureBeyondViewport:true},sessionId);
  fs.writeFileSync(out,Buffer.from(shot.data,'base64'));console.log('saved',out,size.w+'x'+Math.min(size.h,8000),items.length+' images');
}finally{await call('Target.closeTarget',{targetId}).catch(()=>{});}
