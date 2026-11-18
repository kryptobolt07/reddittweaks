// Phone Feed options sheet (docs/feed-options-sheet-spec.md): generic sheet behaviour.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setTimeout(r,0));};
function page(t){const dom=new JSDOM('<!doctype html><body><button id="opener">Feed options</button></body>',{url:'https://www.reddit.com/user/Example/',runScripts:'outside-only',pretendToBeVisual:true}),W=dom.window;t.after(()=>W.close());W.eval(fs.readFileSync('extension/feed-sheet.js','utf8'));return {W,d:W.document};}

test('the sheet is a labelled dialog with a title, a round close button, rows, dividers and chips',async t=>{
 const {W,d}=page(t),picked=[];let closed=0;const opener=d.getElementById('opener');opener.focus();
 W.RTFeedSheet.open({title:'Feed options',returnFocus:opener,onClose:()=>closed++,build:(body,ui)=>{
  ui.row({label:'Hot',href:'/user/Example/?sort=hot'});ui.row({label:'New',selected:true,href:'/user/Example/?sort=new'});ui.divider();ui.title('Filter');
  ui.chips('Activity',[{label:'All activity',selected:true,onSelect:()=>picked.push('all')},{label:'Hidden',onSelect:()=>picked.push('hidden')}]);
 }});
 const sheet=d.querySelector('[data-rt-ui="feed-sheet"] [role="dialog"]');assert.equal(sheet.getAttribute('aria-modal'),'true');assert.equal(d.getElementById(sheet.getAttribute('aria-labelledby')).textContent,'Feed options');
 assert.equal(d.activeElement,d.querySelector('.rt-fsheet-close'),'focus starts on Close');assert.equal(d.querySelector('.rt-fsheet-back').hidden,true);
 assert.deepEqual([...d.querySelectorAll('.rt-fsheet-row')].map(r=>r.tagName+':'+r.textContent+':'+(r.getAttribute('aria-current')||'')),['A:Hot:','A:New:true']);
 assert.equal(d.querySelector('.rt-fsheet-row[aria-current] [data-rt-sheet-icon="check"]')!==null,true,'current sort is checked');
 assert.ok(d.querySelector('.rt-fsheet-divider'));assert.equal(d.querySelector('.rt-fsheet-section').textContent,'Filter');
 const chips=[...d.querySelectorAll('.rt-fsheet-chip')];assert.deepEqual(chips.map(c=>c.getAttribute('aria-pressed')),['true','false']);
 chips[1].click();assert.deepEqual(picked,['hidden']);assert.equal(d.querySelector('[data-rt-ui="feed-sheet"]'),null,'a single choice closes the sheet');assert.equal(closed,1);assert.equal(d.activeElement,opener,'focus returns to Feed options');
});
test('drill-in pages have Back; Escape goes back first; choices that stay open rebuild in place; the backdrop closes',async t=>{
 const {W,d}=page(t);let count=0;
 W.RTFeedSheet.open({title:'Feed options',build:(body,ui)=>{
  ui.chips('Post type',[{heading:'Text'},{label:'Text '+count,selected:count>0,keepOpen:true,onSelect:()=>count++}]);
  ui.row({label:'Top',subtitle:'Today',chevron:true,keepOpen:true,onSelect:()=>ui.push({title:'Top',build:(b,page)=>{page.row({label:'Now',href:'/?sort=top&t=hour'});}})});
 }});
 assert.equal(d.querySelector('.rt-fsheet-chip-heading').textContent,'Text');d.querySelector('.rt-fsheet-chip').click();await flush();
 assert.equal(d.querySelector('.rt-fsheet-chip').textContent,'Text 1','rebuilt after the menu applied it');assert.equal(d.querySelector('.rt-fsheet-chip').getAttribute('aria-pressed'),'true');
 assert.ok(d.querySelector('.rt-fsheet-row [data-rt-sheet-icon="next"]'),'chevron for a second choice');assert.equal(d.querySelector('.rt-fsheet-sub').textContent,'Today');
 [...d.querySelectorAll('.rt-fsheet-row')].find(r=>r.textContent.startsWith('Top')).click();await flush();
 assert.equal(d.querySelector('.rt-fsheet-title').textContent,'Top');assert.equal(d.querySelector('.rt-fsheet-back').hidden,false);assert.equal(d.querySelector('.rt-fsheet-row').getAttribute('href'),'/?sort=top&t=hour');
 d.dispatchEvent(new W.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(d.querySelector('.rt-fsheet-title').textContent,'Feed options','Escape goes back');
 d.querySelector('.rt-fsheet-scrim').click();assert.equal(W.RTFeedSheet.isOpen(),false);
});
test('a lent node (the community picker) goes back home when its page closes',async t=>{
 const {W,d}=page(t);const home=d.createElement('div'),picker=d.createElement('div');picker.id='picker';home.append(picker);d.body.append(home);
 W.RTFeedSheet.open({title:'Community',build:(body,ui)=>ui.lend(picker,()=>home.append(picker))});
 assert.ok(d.querySelector('.rt-fsheet #picker'));W.RTFeedSheet.close();assert.equal(picker.parentElement,home);
});
test('the sheet resets page margins so it sits flush on the bottom edge (Reddit gives section a 16px bottom margin)',()=>{
 assert.match(fs.readFileSync('extension/post-discovery.css','utf8'),/\.rt-fsheet\{position:relative;box-sizing:border-box;width:100%;margin:0;/);
});
