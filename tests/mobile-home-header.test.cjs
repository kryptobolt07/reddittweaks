const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const native='<reddit-header-small><header class="v2 hui h-header-small flex"><nav><button id="navbar-menu-button">Menu</button><a id="reddit-logo" href="/">Home</a><div><create-post-entry-point-wrapper><a id="create-post" href="/submit/">Create</a></create-post-entry-point-wrapper><button id="expand-user-drawer-button">Account</button></div></nav></header><prominent-search><button id="expand-search-button">Search Reddit</button></prominent-search></reddit-header-small>';
const attr='data-rt-home-nav';
function fixture(t,path='/'){
 const {window:W}=new JSDOM(native+'<main></main>',{url:'https://www.reddit.com'+path,runScripts:'outside-only'});
 const D=W.document,frames=[],media=new W.EventTarget();
 media.matches=true;W.matchMedia=()=>media;
 let y=0;
 Object.defineProperty(W,'scrollY',{get:()=>y});
 W.requestAnimationFrame=fn=>frames.push(fn);W.cancelAnimationFrame=()=>{};
 for(const file of ['feed-filters.js','mobile-home-header.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
 const home=new W.RTMobileHomeHeader.HomeHeader();
 t.after(()=>{home.destroy();W.close();});
 const scroll=top=>{y=top;W.dispatchEvent(new W.Event('scroll'));while(frames.length)frames.shift()();};
 return {W,D,scroll,media,header:()=>D.querySelector('reddit-header-small')};
}
test('the compact mobile Home row reveals on upward scroll and ignores small directional changes',t=>{
 const {header,scroll,D}=fixture(t);
 assert.equal(header().hasAttribute(attr),false);
 scroll(750);assert.equal(header().getAttribute(attr),'hidden');
 scroll(747);assert.equal(header().getAttribute(attr),'hidden');
 scroll(738);assert.equal(header().getAttribute(attr),'shown');
 scroll(741);assert.equal(header().getAttribute(attr),'shown');
 scroll(751);assert.equal(header().getAttribute(attr),'hidden');
 scroll(0);assert.equal(header().hasAttribute(attr),false);
 assert.ok(D.querySelector('prominent-search'));
});
test('the compact Search button uses the existing Home trigger and navigation row',t=>{
 const {D,header,scroll}=fixture(t),row=header().querySelector('header'),nativeSearch=D.querySelector('#expand-search-button');
 let opens=0;nativeSearch.addEventListener('click',()=>opens++);
 scroll(200);scroll(150);
 assert.equal(header().querySelector('header'),row);
 const search=D.querySelector('button[data-rt-home-search]');
 assert.equal(search.getAttribute('aria-label'),'Search');
 assert.ok(search.querySelector('[icon-name="search"]'));
 assert.equal(search.nextElementSibling.localName,'create-post-entry-point-wrapper');
 search.click();assert.equal(opens,1);
 assert.equal(D.querySelectorAll('#expand-search-button').length,1);
});
test('leaving Home or widening the window returns the header to Reddit',t=>{
 const {D,W,header,scroll,media}=fixture(t);
 scroll(580);scroll(450);assert.equal(header().getAttribute(attr),'shown');
 W.history.pushState({},'','/r/Example/');D.dispatchEvent(new W.Event('reddit:route'));
 assert.equal(header().hasAttribute(attr),false);assert.equal(D.querySelector('[data-rt-home-search]'),null);
 W.history.pushState({},'','/');W.dispatchEvent(new W.PopStateEvent('popstate'));
 scroll(580);scroll(450);assert.equal(header().getAttribute(attr),'shown');
 media.matches=false;media.dispatchEvent(new W.Event('change'));
 assert.equal(header().hasAttribute(attr),false);assert.equal(D.querySelector('[data-rt-home-search]'),null);
});
test('a replaced Home header has just one compact Search control',async t=>{
 const {D,header,scroll}=fixture(t),old=header();
 old.outerHTML=native;await new Promise(resolve=>setImmediate(resolve));
 assert.equal(D.querySelectorAll('[data-rt-home-search]').length,1);
 assert.equal(old.querySelector('[data-rt-home-search]'),null);
 scroll(300);scroll(280);assert.equal(header().getAttribute(attr),'shown');
});
test('a native search trigger that hydrates after the header remains usable in compact mode',async t=>{
 const {D,header,scroll}=fixture(t),trigger=D.querySelector('#expand-search-button');
 header().outerHTML=native.replace('<button id="expand-search-button">Search Reddit</button>','');
 await new Promise(resolve=>setImmediate(resolve));
 scroll(200);scroll(170);assert.equal(header().getAttribute(attr),'shown');
 assert.equal(D.querySelector('[data-rt-home-search]'),null);
 D.querySelector('prominent-search').append(trigger);
 await new Promise(resolve=>setImmediate(resolve));
 assert.ok(D.querySelector('[data-rt-home-search]'));assert.equal(header().getAttribute(attr),'shown');
});
