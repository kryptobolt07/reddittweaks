// Dev-only: holds ONE approved Chrome DevTools connection (Chrome's
// chrome://inspect/#remote-debugging switch) and relays commands from
// 127.0.0.1:<RELAY_PORT> (default 9333), so each command doesn't trigger another approval prompt.
// Usage: [RELAY_PORT=9334] node scripts/live/relay.mjs [path/to/DevToolsActivePort]
import http from 'node:http';import fs from 'node:fs';import os from 'node:os';import nodePath from 'node:path';import {fileURLToPath} from 'node:url';
import {newToken,checkRequest,parseCommand,relayPort,tokenPath} from './relay-guard.mjs';
// Every request needs the per-run token (header x-relay-token), no Origin header and Host 127.0.0.1:<port>.
// The token is printed here and written to the git-ignored artifacts/research/live-probe/relay-token[-<port>] for cdp.mjs.
const PORT=relayPort(),IDLE_MS=15*60*1000,token=newToken();
const tokenFile=tokenPath(PORT);
fs.mkdirSync(nodePath.dirname(tokenFile),{recursive:true});fs.writeFileSync(tokenFile,token+'\n',{mode:0o600});
console.log('relay token:',token,'(also in',tokenFile+')');
let lastUse=Date.now();setInterval(()=>{if(Date.now()-lastUse>IDLE_MS){console.log('idle for 15 minutes; exiting');try{fs.unlinkSync(tokenFile);}catch{}process.exit(0);}},30000).unref();
const file=process.argv[2] || os.homedir()+'/.config/google-chrome/DevToolsActivePort';
const [port,path]=fs.readFileSync(file,'utf8').trim().split('\n');
const ws=new WebSocket(`ws://127.0.0.1:${port}${path}`);let id=0;const waiting=new Map(),events=[];
ws.addEventListener('message',e=>{let m;try{m=JSON.parse(e.data);}catch{return;}if(m.id && waiting.has(m.id)){waiting.get(m.id)(m);waiting.delete(m.id);}else if(m.method){events.push(m);if(events.length>1000)events.shift();}});
ws.addEventListener('close',()=>{console.log('closed');process.exit(1);});
ws.addEventListener('open',()=>{console.log('connected on port',PORT);
  http.createServer((req,res)=>{const denied=checkRequest(req,{token,port:PORT});if(denied){res.statusCode=denied[0];res.end(JSON.stringify({error:{message:denied[1]}}));return;}lastUse=Date.now();let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    if(req.url.startsWith('/events')){const s=new URL(req.url,'http://x').searchParams.get('session');res.end(JSON.stringify(events.filter(e=>!s || e.sessionId===s)));if(s)for(let i=events.length-1;i>=0;i--)if(events[i].sessionId===s)events.splice(i,1);return;}
    const cmd=parseCommand(body);if(!cmd || typeof cmd.method!=='string'){res.statusCode=400;res.end(JSON.stringify({error:{message:'Invalid command'}}));return;}const i=++id;waiting.set(i,m=>res.end(JSON.stringify(m)));
    ws.send(JSON.stringify({id:i,method:cmd.method,params:cmd.params || {},...(cmd.sessionId?{sessionId:cmd.sessionId}:{})}));
    setTimeout(()=>{if(waiting.has(i)){waiting.delete(i);res.end(JSON.stringify({error:{message:'timeout'}}));}},60000);
  });}).listen(PORT,'127.0.0.1');});
