// Request checks for relay.mjs (kept separate so they can be tested without a browser connection).
import crypto from 'node:crypto';import nodePath from 'node:path';import {fileURLToPath} from 'node:url';
export const newToken=()=>crypto.randomBytes(24).toString('hex');
// Returns null when the request may proceed, otherwise [status, message].
export function checkRequest(req,{token,port}){
  if(req.headers.origin!==undefined)return [403,'Browser-origin requests are refused'];
  if(req.headers.host!==`127.0.0.1:${port}`)return [403,'Unexpected Host'];
  const given=String(req.headers['x-relay-token']||''),a=Buffer.from(given),b=Buffer.from(token);
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b))return [401,'Missing or wrong relay token'];
  return null;
}
export function parseCommand(body){
  try{const value=JSON.parse(body || '{}');return value && typeof value==='object' && !Array.isArray(value)?value:null;}catch{return null;}
}
// Relay port: RELAY_PORT (default 9333, your signed-in Chrome). Use another port, e.g. 9334, for the headless fixture browser.
export function relayPort(env=process.env){
  const raw=env.RELAY_PORT ?? '9333',port=Number(raw);
  if(!/^\d+$/.test(String(raw)) || port<1024 || port>65535)throw Error('RELAY_PORT must be an integer from 1024 to 65535');
  return port;
}
// Per-port token file in the git-ignored artifacts/research/live-probe/ (9333 keeps the original name).
export function tokenPath(port,root=nodePath.join(nodePath.dirname(fileURLToPath(import.meta.url)),'..','..')){
  return nodePath.join(root,'artifacts','research','live-probe',port===9333?'relay-token':'relay-token-'+port);
}
