// Automatic UI checks for one region: overflow, clipped text, small or covered click targets, text contrast,
// keyboard focus order/visibility and console errors. Prints JSON; every finding names the element and the measurement.
// Usage: [RELAY_PORT=9334] node scripts/live/probe-ui.mjs <session> '<rootSelector>' [--tab 12] [--console] [--min-target 24]
// --console drains this session's buffered events (enable them first: cdp.mjs raw Log.enable / Runtime.enable).
import {call,ev,events,PAGE_HELPERS,parseArgs} from './relay-client.mjs';
const {positional:[session,root],options}=parseArgs(process.argv.slice(2));
if(!session || !root){console.error("usage: probe-ui.mjs <session> '<rootSelector>' [--tab N] [--console] [--min-target 24]");process.exit(2);}
const minTarget=+(options['min-target']||24);
const report=await ev(session,`(()=>{${PAGE_HELPERS}
const base=first(${JSON.stringify(root)});if(!base)return {error:'NO MATCH for root'};
const B=base.getBoundingClientRect(),all=[base,...deep('*',base)].filter(vis),desc=e=>(e.tagName.toLowerCase()+(e.id?'#'+e.id:'')+(typeof e.className==='string'&&e.className?'.'+e.className.trim().split(/\\s+/)[0]:'')).slice(0,48)+' "'+(e.innerText||e.getAttribute?.('aria-label')||'').trim().replace(/\\s+/g,' ').slice(0,30)+'"';
const rgb=s=>{const m=s.match(/rgba?\\(([^)]+)\\)/);if(!m)return null;const p=m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number);return {r:p[0],g:p[1],b:p[2],a:p[3]===undefined?1:p[3]};};
const lum=c=>{const f=v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);};
const up=e=>e.parentElement||(e.getRootNode&&e.getRootNode().host)||null;
const bgOf=e=>{for(let n=e;n;n=up(n)){const c=getComputedStyle(n);if(c.backgroundImage!=='none')return null;const b=rgb(c.backgroundColor);if(b&&b.a>=0.95)return b;}return {r:255,g:255,b:255,a:1};};
const ownText=e=>[...e.childNodes].some(t=>t.nodeType===3&&t.textContent.trim());
const out={root:desc(base)+' '+Math.round(B.width)+'x'+Math.round(B.height),visibility:document.visibilityState,
 page:{scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth},beyondRoot:[],clipped:[],smallTargets:[],covered:[],lowContrast:[]};
for(const e of all){const r=e.getBoundingClientRect(),c=getComputedStyle(e);
 if(e!==base&&(r.right>B.right+1||r.left<B.left-1)&&c.position!=='fixed')out.beyondRoot.push(desc(e)+' x='+Math.round(r.left-B.left)+'..'+Math.round(r.right-B.left)+' rootW='+Math.round(B.width));
 if(ownText(e)&&((e.scrollWidth>e.clientWidth+1&&c.overflowX!=='visible')||(e.scrollHeight>e.clientHeight+1&&c.overflowY!=='visible')))out.clipped.push(desc(e)+' scroll='+e.scrollWidth+'x'+e.scrollHeight+' box='+e.clientWidth+'x'+e.clientHeight+(c.textOverflow==='ellipsis'?' (ellipsis)':''));
 const ctl=e.matches('a[href],button,input,select,textarea,[role=button],[role=menuitem],[tabindex]:not([tabindex="-1"])');
 if(ctl){if(r.width<${minTarget}||r.height<${minTarget})out.smallTargets.push(desc(e)+' '+Math.round(r.width)+'x'+Math.round(r.height));
  const x=r.x+r.width/2,y=r.y+r.height/2;if(x>=0&&y>=0&&x<innerWidth&&y<innerHeight){let hit=document.elementFromPoint(x,y);while(hit?.shadowRoot){const inner=hit.shadowRoot.elementFromPoint(x,y);if(!inner||inner===hit)break;hit=inner;}
   const inside=n=>{for(let k=n;k;k=up(k))if(k===e)return true;return false;};if(hit&&!inside(hit))out.covered.push(desc(e)+' covered by '+desc(hit));}}
 if(ownText(e)){const fg=rgb(c.color),bg=bgOf(e);if(fg&&bg){const a=fg.a,mix={r:fg.r*a+bg.r*(1-a),g:fg.g*a+bg.g*(1-a),b:fg.b*a+bg.b*(1-a)};const L1=lum(mix),L2=lum(bg),ratio=(Math.max(L1,L2)+0.05)/(Math.min(L1,L2)+0.05);
  const size=parseFloat(c.fontSize),large=size>=24||(size>=18.66&&+c.fontWeight>=700);if(ratio<(large?3:4.5))out.lowContrast.push(desc(e)+' ratio='+ratio.toFixed(2)+' '+c.color+' on rgb('+[bg.r,bg.g,bg.b].join(',')+')');}}}
for(const k of ['beyondRoot','clipped','smallTargets','covered','lowContrast']){out[k+'Count']=out[k].length;out[k]=out[k].slice(0,12);}
return out;})()`);
if(options.tab){
  const steps=[],focusExpr=`(()=>{let a=document.activeElement;while(a?.shadowRoot?.activeElement)a=a.shadowRoot.activeElement;if(!a||a===document.body)return 'body';const c=getComputedStyle(a),r=a.getBoundingClientRect();
   const ring=(c.outlineStyle!=='none'&&parseFloat(c.outlineWidth)>0)||c.boxShadow!=='none';let inRoot=false;for(let n=a;n;n=n.parentElement||n.getRootNode?.().host)if(n.matches?.(${JSON.stringify(root)})){inRoot=true;break;}
   return (a.tagName.toLowerCase()+' "'+(a.getAttribute('aria-label')||a.innerText||'').trim().slice(0,28)+'"')+(inRoot?' in-root':' outside')+(ring?' ring':' NO-RING')+(r.width&&r.height?'':' INVISIBLE');})()`;
  for(let i=0;i<+options.tab;i++){for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'Tab',code:'Tab',windowsVirtualKeyCode:9},session);steps.push(await ev(session,focusExpr));}
  report.tabOrder=steps;
}
if(options.console){
  const list=await events(session),errors=[];
  for(const e of list){const p=e.params||{};
    if(e.method==='Runtime.exceptionThrown')errors.push('exception '+(p.exceptionDetails?.exception?.description||p.exceptionDetails?.text||'').split('\n')[0]+' @'+(p.exceptionDetails?.url||''));
    else if(e.method==='Runtime.consoleAPICalled'&&p.type==='error')errors.push('console.error '+(p.args||[]).map(a=>a.value??a.description).join(' ').slice(0,160));
    else if(e.method==='Log.entryAdded'&&p.entry?.level==='error')errors.push('log '+p.entry.text.slice(0,140)+' @'+(p.entry.url||''));}
  report.consoleErrors=errors.slice(0,20).map(s=>(/chrome-extension:\/\/|\/extension\//.test(s)?'[extension] ':'')+s);report.consoleErrorCount=errors.length;
}
console.log(JSON.stringify(report,null,1));
