// Component inventory of one page region (searches open shadow roots). Diff a native region against ours.
// Usage: [RELAY_PORT=9334] node scripts/live/probe-inventory.mjs <session> '<rootSelector>' [--max 80] [--nth 0]
// One line per visible component, ordered top-to-bottom, positions relative to the root:
//   y x wxh tag.class "text" size/weight/colour [img nw complete src] [control disabled aria-disabled cursor href] [radius]
import {ev,PAGE_HELPERS,parseArgs} from './relay-client.mjs';
const {positional:[session,root],options}=parseArgs(process.argv.slice(2));
if(!session || !root){console.error("usage: probe-inventory.mjs <session> '<rootSelector>' [--max 80] [--nth 0]");process.exit(2);}
const max=+(options.max||80),nth=+(options.nth||0);
const inventoryExpression=(rootSelector,maxItems,index)=>`(()=>{${PAGE_HELPERS}
const base=first(${JSON.stringify(rootSelector)},${index});if(!base)return ['NO MATCH for root'];
const B=base.getBoundingClientRect(),out=[],seen=new Set();
const ownText=e=>[...e.childNodes].filter(t=>t.nodeType===3).map(t=>t.textContent).join(' ').replace(/\\s+/g,' ').trim();
const walk=n=>{for(const e of n.children||[])visit(e);if(n.shadowRoot)for(const e of n.shadowRoot.children)visit(e);};
const visit=e=>{if(!vis(e)){if(getComputedStyle(e).display==='contents')walk(e);return;}
 const tag=e.tagName.toUpperCase(),r=e.getBoundingClientRect(),c=getComputedStyle(e);
 const ctl=tag==='BUTTON'||tag==='A'||tag==='INPUT'||tag==='SELECT'||e.getAttribute('role')==='button';
 const media=['IMG','SVG','VIDEO','IFRAME','FACEPLATE-IMG','CANVAS'].includes(tag)||(c.backgroundImage!=='none'&&r.width<=200);
 const t=ownText(e),head=/^H[1-6]$/.test(tag)||tag==='TIME';
 if(ctl||media||head||t){const key=tag+Math.round(r.x)+','+Math.round(r.y)+t;if(!seen.has(key)){seen.add(key);
  const cls=typeof e.className==='string'?e.className.split(/\\s+/).filter(x=>x&&!x.includes(':')&&!x.includes('['))[0]:'';
  let line=Math.round(r.y-B.y)+' '+Math.round(r.x-B.x)+' '+Math.round(r.width)+'x'+Math.round(r.height)+' '+tag.toLowerCase()+(cls?'.'+cls:'');
  const label=(ctl?(e.getAttribute('aria-label')||e.innerText||e.value||''):t).replace(/\\s+/g,' ').trim().slice(0,50);if(label)line+=' "'+label+'"';
  if(t||head||ctl)line+=' '+c.fontSize+'/'+c.fontWeight+' '+c.color.replace(/\\s/g,'');
  if(tag==='IMG')line+=' nw='+e.naturalWidth+' complete='+e.complete+' src='+(e.currentSrc||e.src).replace(/^https?:\\/\\//,'').slice(0,60);
  if(c.backgroundImage!=='none'&&tag!=='IMG')line+=' bg='+c.backgroundImage.slice(0,60);
  if(ctl)line+=' disabled='+(e.disabled===true)+' aria-disabled='+e.getAttribute('aria-disabled')+' cursor='+c.cursor+(e.getAttribute('href')?' href='+e.getAttribute('href').slice(0,60):'');
  if(c.borderRadius!=='0px'&&(ctl||media))line+=' radius='+c.borderRadius;
  out.push([r.y,r.x,line]);}}
 if(tag!=='SVG')walk(e);};
walk(base);out.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
return ['ROOT '+base.tagName.toLowerCase()+' '+Math.round(B.width)+'x'+Math.round(B.height)+' at '+Math.round(B.x)+','+Math.round(B.y)+' visibility='+document.visibilityState]
 .concat(out.slice(0,${maxItems}).map(x=>x[2]),out.length>${maxItems}?['... '+(out.length-${maxItems})+' more (raise --max or narrow the root)']:[]);})()`;
console.log((await ev(session,inventoryExpression(root,max,nth))).join('\n'));
