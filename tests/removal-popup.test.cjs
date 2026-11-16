const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
async function setup(t,{active=true,profilePost=false}={}){const dom=new JSDOM(fs.readFileSync('extension/popup.html','utf8'),{url:'https://extension.test/popup.html',runScripts:'outside-only'}),W=dom.window,calls=[],opened=[],storage={};t.after(()=>W.close());W.chrome={storage:{local:{async get(k){return {[k]:storage[k]};},async set(v){Object.assign(storage,v);}}},tabs:{async query(){return active?[{id:1,url:'https://www.reddit.com/'}]:[];},async create(v){opened.push(v);}},runtime:{async sendMessage(m){calls.push(m);if(m.scope==='rt-removal'){if(!active)return {ok:false,error:'Open a signed-in Reddit tab'};return {ok:true,value:{username:'Example',owner:'t2_self',items:{t3_a:{state:'unknown'}},unread:m.action==='seen'?0:1,lastChecked:Date.now(),changes:[{type:'removed',state:'removed-auto',confidence:'likely',why:'The archive saw a removal',permalink:profilePost?'/user/Example/comments/post1/title/':'/r/Alpha/comments/post1/title/',checkedAt:Date.now()}]}};}return m.action==='stats'?{ok:true,stats:{messages:0,rooms:0}}:{ok:true};}}};W.eval(fs.readFileSync('extension/popup.js','utf8'));await settle();return {W,calls,opened,storage};}
test('monitoring defaults off, has separate dependent notification control, and describes browsing limits',async t=>{
 const s=await setup(t),d=s.W.document;assert.equal(d.querySelector('#own-removal').checked,false);assert.equal(d.querySelector('#removal-notifications').checked,false);assert.equal(d.querySelector('#removal-notifications').closest('.setting-row').hidden,true);assert.match(d.querySelector('#own-removal-desc').textContent,/brows/i);
 d.querySelector('#own-removal').click();await settle();assert.equal(s.storage['rt-settings-v1'].ownRemoval,true);assert.equal(d.querySelector('#removal-notifications').closest('.setting-row').hidden,false);
});
test('the popup no longer shows the removed-content summary, link or recent changes; Removed lives on your profile',async t=>{
 const s=await setup(t),d=s.W.document;for(const id of ['removal-home-heading','removal-summary','open-removed','removal-history-toggle','removal-history'])assert.equal(d.getElementById(id),null,id);
 assert.equal(s.calls.some(m=>m.scope==='rt-removal'&&m.action==='seen'),false,'opening the popup acknowledges nothing');
});
test('without an active Reddit identity the clear button stays disabled',async t=>{
 const s=await setup(t,{active:false}),d=s.W.document;assert.equal(d.querySelector('#clear-removal-history').disabled,true);
});
test('clearing removal history stays in the Your removed content settings, needs a second click and identifies the current account scope',async t=>{
 const s=await setup(t),d=s.W.document,b=d.querySelector('#clear-removal-history');assert.ok(b.closest('[aria-labelledby="removal-settings-heading"]'),'kept with the removal settings');assert.equal(b.disabled,false);b.click();assert.equal(s.calls.some(m=>m.scope==='rt-removal'&&m.action==='clear'),false);assert.match(b.textContent,/Confirm/);b.click();await settle();assert.ok(s.calls.some(m=>m.scope==='rt-removal'&&m.action==='clear'&&m.tabId===1&&m.owner==='t2_self'));
});
