// Timeline of page regions across user-like transitions: catches flashes, blanks, element replacement and layout shifts
// that settled screenshots miss.
// Usage: [RELAY_PORT=9334] node scripts/live/probe-timeline.mjs <session> --regions 'nav=.left-sidebar ; feed=main'
//          --steps 'wait:1500 ; click:<selector> ; wait:4000 ; back ; wait:3000' [--interval 30]
// Steps: wait:<ms> | click:<selector> (real mouse click at its centre) | back | forward | reload | nav:<url> | key:<Key> | scroll:<px>
// Samples each region every --interval ms and prints only changes:
//   <ms> [<doc>] <region>: #<element id> <w>x<h> links=<n> text=<empty|yes> state=<data-state> bg=<colour> paint=<self|tag.class>
// A new #id means the element was replaced; paint shows what is actually drawn at the region's centre; a new [doc] means
// a full page load. "shift <value> <element>" lines are layout shifts. Rows survive same-origin page loads (sessionStorage).
import {call,ev,sleep,PAGE_HELPERS,parseArgs} from './relay-client.mjs';
const {positional:[session],options}=parseArgs(process.argv.slice(2));
if(!session || !options.regions || !options.steps){console.error("usage: probe-timeline.mjs <session> --regions 'name=sel ; ...' --steps 'wait:ms ; click:sel ; back ; ...'");process.exit(2);}
const split=value=>String(value).split(/\s+;\s+/).map(x=>x.trim()).filter(Boolean);
const regions=split(options.regions).map(r=>{const i=r.indexOf('=');return [r.slice(0,i).trim(),r.slice(i+1).trim()];});
const interval=Math.max(10,+(options.interval||30));
const sampler=`(()=>{if(window.__probeTl)return;window.__probeTl=1;${PAGE_HELPERS}
const KEY='__probe_tl',T0=+sessionStorage.getItem(KEY+'0')||Date.now();sessionStorage.setItem(KEY+'0',T0);
const doc=Math.random().toString(36).slice(2,6),ids=new WeakMap();let n=0;const id=e=>{if(!ids.has(e))ids.set(e,++n);return ids.get(e);};
const push=s=>{try{const a=JSON.parse(sessionStorage.getItem(KEY)||'[]');if(a.length<3000){a.push((Date.now()-T0)+' ['+doc+'] '+s);sessionStorage.setItem(KEY,JSON.stringify(a));}}catch{}};
const regions=${JSON.stringify(regions)},last={};push('page '+location.pathname+location.search);
const desc=e=>e?(e.tagName.toLowerCase()+'.'+String(e.className||'').split(/\\s+/)[0]).slice(0,32):'none';
const sample=()=>{if(window.__probeStop)return;for(const [name,sel] of regions){let line='absent';const e=first(sel);
 if(e){const r=e.getBoundingClientRect(),links=deep('a',e).filter(vis).length,text=(e.innerText||'').trim()?'yes':'empty';
  const p=document.elementFromPoint(Math.min(innerWidth-1,Math.max(0,r.x+r.width/2)),Math.min(innerHeight-1,Math.max(0,r.y+Math.min(r.height/2,200))));
  const state=e.closest('[data-state]')?.dataset.state;
  line='#'+id(e)+' '+Math.round(r.width)+'x'+Math.round(r.height)+' links='+links+' text='+text+(state?' state='+state:'')+' bg='+getComputedStyle(e).backgroundColor.replace(/\\s/g,'')+' paint='+(p&&(e===p||e.contains(p))?'self':desc(p));}
 if(last[name]!==line){last[name]=line;push(name+': '+line);}}};
try{new PerformanceObserver(list=>{for(const s of list.getEntries())if(!s.hadRecentInput&&s.value>=0.001)push('shift '+s.value.toFixed(3)+' '+(s.sources||[]).map(x=>desc(x.node)).join(','));}).observe({type:'layout-shift',buffered:true});}catch{}
const timer=setInterval(sample,${interval});sample();setTimeout(()=>clearInterval(timer),120000);})()`;
await ev(session,"sessionStorage.removeItem('__probe_tl');sessionStorage.removeItem('__probe_tl0');window.__probeStop=0;window.__probeTl=0;1");
const {identifier}=await call('Page.addScriptToEvaluateOnNewDocument',{source:sampler},session);
await ev(session,sampler);
const center=async selector=>ev(session,`(()=>{${PAGE_HELPERS}const e=first(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
for(const step of split(options.steps)){
  const [kind,...rest]=step.split(':'),arg=rest.join(':');
  if(kind==='wait')await sleep(+arg);
  else if(kind==='click'){const p=await center(arg);if(!p){console.log('step failed: no visible match for',arg);continue;}await sleep(150);
    for(const type of ['mouseMoved','mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,x:p.x,y:p.y,button:'left',clickCount:1},session);}
  else if(kind==='back' || kind==='forward')await ev(session,`history.${kind}();1`);
  else if(kind==='reload')await call('Page.reload',{},session);
  else if(kind==='nav')await call('Page.navigate',{url:arg},session);
  else if(kind==='key'){for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:arg,code:arg},session);}
  else if(kind==='scroll')await ev(session,`scrollBy(0,${+arg});1`);
  else console.log('unknown step',step);
}
await sleep(200);
const rows=await ev(session,"window.__probeStop=1;JSON.parse(sessionStorage.getItem('__probe_tl')||'[]')");
await call('Page.removeScriptToEvaluateOnNewDocument',{identifier},session);
console.log(rows.length?rows.join('\n'):'(no rows: the last step left the origin, so its sessionStorage is not readable)');
