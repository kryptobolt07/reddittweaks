// Sort & filter docked under the header (docs/feed-controls-ux-plan.md, 6).
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
function setup(t){
 const {window:W}=new JSDOM('<body><reddit-header-large></reddit-header-large><main><div id="row"></div></main></body>',{url:'https://www.reddit.com/r/Example/',runScripts:'outside-only'});
 t.after(()=>W.close());
 let y=0,rowTop=200;
 Object.defineProperty(W,'scrollY',{get:()=>y,configurable:true});
 W.requestAnimationFrame=fn=>{fn();return 0;};// synchronous frames in this testW.cancelAnimationFrame=()=>{};
 const d=W.document;
 d.querySelector('reddit-header-large').getBoundingClientRect=()=>({top:0,bottom:56,height:56,left:0});
 const row=d.getElementById('row');row.getBoundingClientRect=()=>({top:rowTop-y,bottom:rowTop-y+40,height:40,left:24});
 for(const file of ['feed-filters.js','feed-dock.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
 const scroll=to=>{y=to;W.dispatchEvent(new W.Event('scroll'));};
 return {W,d,row,scroll};
}
test('the dock shows on scroll-up once the row is under the header, hides on scroll-down and when the row is back',t=>{
 const {W,d,row,scroll}=setup(t);let count=2,opened=null;
 const dock=W.RTFeedDock.attach({anchor:()=>row,count:()=>count,open:button=>{opened=button;}});
 const el=()=>d.querySelector('[data-rt-ui="feed-dock"]');
 assert.ok(el());assert.equal(el().hasAttribute('data-rt-shown'),false);
 assert.equal(el().getAttribute('aria-label'),'Sort & filter, 2 filters applied');assert.equal(el().querySelector('.rt-filter-count').textContent,'2');
 scroll(100);assert.equal(el().hasAttribute('data-rt-shown'),false,'row still visible');
 scroll(1200);scroll(1190);assert.equal(el().hasAttribute('data-rt-shown'),false,'a 10 px reversal is not enough');
 scroll(1170);assert.equal(el().hasAttribute('data-rt-shown'),true,'24 px up shows it');
 assert.equal(el().style.getPropertyValue('--rt-dock-top'),'56px');assert.equal(el().style.getPropertyValue('--rt-dock-left'),'24px');
 assert.equal(el().tabIndex,0);assert.equal(el().getAttribute('aria-hidden'),'false');
 scroll(1175);assert.equal(el().hasAttribute('data-rt-shown'),true,'a small wobble keeps it');
 scroll(1180);assert.equal(el().hasAttribute('data-rt-shown'),false,'8 px down hides it');
 scroll(1150);el().click();assert.equal(opened,el(),'opens from the dock');
 el().setAttribute('aria-expanded','true');scroll(1400);assert.equal(el().hasAttribute('data-rt-shown'),true,'stays while its menu is open');
 el().setAttribute('aria-expanded','false');
 scroll(100);assert.equal(el().hasAttribute('data-rt-shown'),false,'hidden while the row is visible');
 count=0;dock.update();assert.equal(el().querySelector('.rt-filter-count'),null);assert.equal(el().getAttribute('aria-label'),'Sort & filter');
 dock.detach();assert.equal(el(),null);
});
