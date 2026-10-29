// Request checks for relay.mjs (kept separate so they can be tested without a browser connection).
import crypto from 'node:crypto';
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
