// L2 fixture browser: headless Chrome with a throwaway profile + the demo preview server + a relay on its own port.
// No approval prompt, no access to your signed-in profile, no interference with your browsing.
// Usage (run in the background; Ctrl-C/kill stops everything and deletes the profile):
//   node scripts/live/fixture-browser.mjs [--port 9334] [--preview 8765] [--headed] [--extension] [--chrome <binary>]
// Then: RELAY_PORT=9334 node scripts/live/cdp.mjs raw Target.createTarget '{"url":"http://127.0.0.1:8765/demo/"}'
// --extension loads the packaged unpacked folder artifacts/reddit-chat-search/ (run npm run package first). Branded Google
// Chrome ignores --load-extension, so this defaults to Playwright's Chromium when it is installed.
import {spawn} from 'node:child_process';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {parseArgs} from './relay-client.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..','..');
const {options}=parseArgs(process.argv.slice(2));
const port=String(options.port||9334),preview=String(options.preview||8765);
if(port==='9333'){console.error('9333 is reserved for your signed-in Chrome relay; use another port.');process.exit(2);}
const playwrightChromium=()=>{const dir=path.join(os.homedir(),'.cache','ms-playwright');try{for(const d of fs.readdirSync(dir).filter(d=>/^chromium-\d+$/.test(d)).sort().reverse()){const bin=path.join(dir,d,'chrome-linux64','chrome');if(fs.existsSync(bin))return bin;}}catch{}return null;};
const chrome=options.chrome || (options.extension?playwrightChromium():null) || ['/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(fs.existsSync);
if(!chrome){console.error('No Chrome/Chromium found; pass --chrome <binary>.');process.exit(1);}
const profile=fs.mkdtempSync(path.join(ROOT,'artifacts','research','fixture-profile-'));
const children=[];let stopping=false;
const stop=code=>{if(stopping)return;stopping=true;for(const c of children){try{c.kill('SIGTERM');}catch{}}setTimeout(()=>{try{fs.rmSync(profile,{recursive:true,force:true});}catch{}process.exit(code);},500);};
process.on('SIGINT',()=>stop(0));process.on('SIGTERM',()=>stop(0));
const run=(name,cmd,args,env)=>{const c=spawn(cmd,args,{cwd:ROOT,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});children.push(c);
  c.stdout.on('data',d=>{for(const line of String(d).split('\n'))if(line.trim()&&!/relay token:/.test(line))console.log(`[${name}] ${line}`);});
  c.stderr.on('data',d=>{const s=String(d);if(name!=='chrome'||/error|fail/i.test(s)&&!/dbus|gpu|GCM|Fontconfig/i.test(s))process.stderr.write(`[${name}] ${s}`);});
  c.on('exit',code=>{if(!stopping){console.log(`[${name}] exited (${code}); stopping fixture`);stop(code||1);}});return c;};
const reachable=async url=>{try{await fetch(url,{signal:AbortSignal.timeout(800)});return true;}catch{return false;}};
if(!await reachable(`http://127.0.0.1:${preview}/demo/`))run('preview','python3',['scripts/preview-server.py',preview]);
else console.log(`[preview] already running on ${preview}`);
const ext=path.join(ROOT,'artifacts','reddit-chat-search');
if(options.extension && !fs.existsSync(path.join(ext,'manifest.json'))){console.error('artifacts/reddit-chat-search/ is missing; run npm run package first.');stop(1);}
run('chrome',chrome,[...(options.headed?[]:['--headless=new']),`--user-data-dir=${profile}`,'--remote-debugging-port=0','--no-first-run','--no-default-browser-check',
  '--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--window-size=1280,800',
  ...(options.extension?[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]:[]),'about:blank']);
const portFile=path.join(profile,'DevToolsActivePort');
for(let i=0;i<100 && !fs.existsSync(portFile);i++)await new Promise(r=>setTimeout(r,100));
if(!fs.existsSync(portFile)){console.error('Chrome did not open a DevTools port.');stop(1);}
else{
  run('relay','node',['scripts/live/relay.mjs',portFile],{RELAY_PORT:port});
  for(let i=0;i<50 && !fs.existsSync(path.join(ROOT,'artifacts','research','live-probe','relay-token-'+port));i++)await new Promise(r=>setTimeout(r,100));
  console.log(`fixture ready: RELAY_PORT=${port} preview=http://127.0.0.1:${preview}/demo/ chrome=${path.basename(chrome)}${options.extension?' +extension':''} profile=${path.relative(ROOT,profile)}`);
}
