// Shared client for the probe-*.mjs tools. Talks to relay.mjs on RELAY_PORT (default 9333; the fixture browser uses 9334).
import fs from 'node:fs';
import {relayPort,tokenPath} from './relay-guard.mjs';
export const PORT=relayPort();
const BASE='http://127.0.0.1:'+PORT;
const token=()=>process.env.RELAY_TOKEN || (()=>{try{return fs.readFileSync(tokenPath(PORT),'utf8').trim();}catch{return '';}})();
export const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function call(method,params={},sessionId){
  const response=await fetch(BASE+'/',{method:'POST',headers:{'x-relay-token':token()},body:JSON.stringify({method,params,sessionId})});
  const result=await response.json();if(result.error)throw Error(method+': '+JSON.stringify(result.error));return result.result;
}
// Evaluate in the page's main world and return the value; page exceptions become thrown errors.
export async function ev(sessionId,expression){
  const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);
  if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
// Drains this session's buffered CDP events (the relay keeps the last 1000).
export async function events(sessionId){return (await fetch(BASE+'/events?session='+encodeURIComponent(sessionId),{headers:{'x-relay-token':token()}})).json();}
// Page-side helper source: deep(selector[,root]) returns matches inside open shadow roots too; vis(e) is "visibly rendered".
export const PAGE_HELPERS=`const deep=(sel,r=document,acc=[])=>{for(const e of r.querySelectorAll(sel))acc.push(e);for(const e of r.querySelectorAll('*'))if(e.shadowRoot)deep(sel,e.shadowRoot,acc);return acc;};
const vis=e=>{if(!e?.getBoundingClientRect)return false;const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return false;const c=getComputedStyle(e);return c.visibility!=='hidden'&&c.display!=='none'&&+c.opacity>0.05;};
const first=(sel,nth=0)=>deep(sel).filter(vis)[nth]||null;`;
// Parses "--name value" and "--flag" arguments after the positional ones.
export function parseArgs(argv){
  const positional=[],options={};
  for(let i=0;i<argv.length;i++){const a=argv[i];if(a.startsWith('--')){const key=a.slice(2),next=argv[i+1];if(next===undefined || next.startsWith('--'))options[key]=true;else{options[key]=next;i++;}}else positional.push(a);}
  return {positional,options};
}
