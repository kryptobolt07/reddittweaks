// Before/after pixel diff. Red = changed outside the intended area, orange = changed inside --mask.
// Usage: node scripts/live/probe-pngdiff.mjs <before.png> <after.png> [--out diff.png] [--threshold 16] [--mask 'x,y,w,h ; x,y,w,h']
// Capture both shots with the same viewport and the same clip. "outsideMask" > 0 means pixels changed outside the edit area.
import fs from 'node:fs';
import {decodePng,encodePng,diffPng} from './png.mjs';
import {parseArgs} from './relay-client.mjs';
const {positional:[before,after],options}=parseArgs(process.argv.slice(2));
if(!before || !after){console.error("usage: probe-pngdiff.mjs <before.png> <after.png> [--out diff.png] [--threshold 16] [--mask 'x,y,w,h ; ...']");process.exit(2);}
const masks=options.mask?String(options.mask).split(/\s*;\s*/).filter(Boolean).map(m=>{const [x,y,width,height]=m.split(',').map(Number);return {x,y,width,height};}):[];
const result=diffPng(decodePng(fs.readFileSync(before)),decodePng(fs.readFileSync(after)),{threshold:+(options.threshold||16),masks});
if(result.sizeMismatch){console.log(JSON.stringify({...result,hint:'capture both shots with the same viewport and clip'}));process.exit(1);}
if(options.out)fs.writeFileSync(options.out,encodePng(result.image));
delete result.image;console.log(JSON.stringify({...result,...(options.out?{diffImage:options.out}:{})}));
