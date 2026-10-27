// Dev-only: holds ONE approved Chrome DevTools connection (Chrome's
// chrome://inspect/#remote-debugging switch) and relays commands from
// 127.0.0.1:9333, so each command doesn't trigger another approval prompt.
// Usage: node scripts/live/relay.mjs [path/to/DevToolsActivePort]
import http from 'node:http';import fs from 'node:fs';import os from 'node:os';
const file=process.argv[2] || os.homedir()+'/.config/google-chrome/DevToolsActivePort';
const [port,path]=fs.readFileSync(file,'utf8').trim().split('\n');
const ws=new WebSocket(`ws://127.0.0.1:${port}${path}`);let id=0;const waiting=new Map(),events=[];
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id && waiting.has(m.id)){waiting.get(m.id)(m);waiting.delete(m.id);}else if(m.method){events.push(m);if(events.length>1000)events.shift();}});
ws.addEventListener('close',()=>{console.log('closed');process.exit(1);});
ws.addEventListener('open',()=>{console.log('connected');
  http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
    if(req.url.startsWith('/events')){const s=new URL(req.url,'http://x').searchParams.get('session');res.end(JSON.stringify(events.filter(e=>!s || e.sessionId===s)));if(s)for(let i=events.length-1;i>=0;i--)if(events[i].sessionId===s)events.splice(i,1);return;}
    const cmd=JSON.parse(body || '{}'),i=++id;waiting.set(i,m=>res.end(JSON.stringify(m)));
    ws.send(JSON.stringify({id:i,method:cmd.method,params:cmd.params || {},...(cmd.sessionId?{sessionId:cmd.sessionId}:{})}));
    setTimeout(()=>{if(waiting.has(i)){waiting.delete(i);res.end(JSON.stringify({error:{message:'timeout'}}));}},60000);
  });}).listen(9333,'127.0.0.1');});
