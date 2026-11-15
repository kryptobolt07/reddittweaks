const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {JSDOM}=require('jsdom');
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setImmediate(r));};
async function setup(t,{active=true,profilePost=false}={}){const dom=new JSDOM(fs.readFileSync('extension/popup.html','utf8'),{url:'https://extension.test/popup.html',runScripts:'outside-only'}),W=dom.window,calls=[],opened=[],storage={};t.after(()=>W.close());W.chrome={storage:{local:{async get(k){return {[k]:storage[k]};},async set(v){Object.assign(storage,v);}}},tabs:{async query(){return active?[{id:1,url:'https://www.reddit.com/'}]:[];},async create(v){opened.push(v);}},runtime:{async sendMessage(m){calls.push(m);if(m.scope==='rt-removal'){if(!active)return {ok:false,error:'Open a signed-in Reddit tab'};return {ok:true,value:{username:'Example',owner:'t2_self',items:{t3_a:{state:'unknown'}},unread:m.action==='seen'?0:1,lastChecked:Date.now(),changes:[{type:'removed',state:'removed-auto',confidence:'likely',why:'The archive saw a removal',permalink:profilePost?'/user/Example/comments/post1/title/':'/r/Alpha/comments/post1/title/',checkedAt:Date.now()}]}};}return m.action==='stats'?{ok:true,stats:{messages:0,rooms:0}}:{ok:true};}}};W.eval(fs.readFileSync('extension/popup.js','utf8'));await settle();return {W,calls,opened,storage};}
test('monitoring defaults off, has separate dependent notification control, and describes browsing limits',async t=>{
 const s=await setup(t),d=s.W.document;assert.equal(d.querySelector('#own-removal').checked,false);assert.equal(d.querySelector('#removal-notifications').checked,false);assert.equal(d.querySelector('#removal-notifications').closest('.setting-row').hidden,true);assert.match(d.querySelector('#own-removal-desc').textContent,/brows/i);
 d.querySelector('#own-removal').click();await settle();assert.equal(s.storage['rt-settings-v1'].ownRemoval,true);assert.equal(d.querySelector('#removal-notifications').closest('.setting-row').hidden,false);
});
test('popup renders current-account changes safely and marks history seen only on explicit review',async t=>{
 const s=await setup(t),d=s.W.document;assert.match(d.querySelector('#removal-summary').textContent,/Example/);assert.equal(s.calls.some(m=>m.scope==='rt-removal'&&m.action==='seen'),false);
 d.querySelector('#removal-history-toggle').click();await settle();assert.equal(d.querySelector('#removal-history').hidden,false);assert.match(d.querySelector('#removal-history').textContent,/automatically.*likely/i);assert.ok(s.calls.some(m=>m.action==='seen'));assert.match(d.querySelector('#removal-history a').href,/^https:\/\/www\.reddit\.com\/r\/Alpha\/comments\//);
 d.querySelector('#open-removed').click();await settle();assert.equal(s.opened[0].url,'https://www.reddit.com/user/Example/search/?rt_list=removed');
});
test('without an active Reddit identity popup never substitutes another account or enables its history',async t=>{
 const s=await setup(t,{active:false}),d=s.W.document;assert.match(d.querySelector('#removal-summary').textContent,/signed-in Reddit tab/);assert.equal(d.querySelector('#open-removed').disabled,true);assert.equal(d.querySelector('#removal-history-toggle').disabled,true);
});
test('clearing removal history needs a second click and identifies the current account scope',async t=>{
 const s=await setup(t),d=s.W.document,b=d.querySelector('#clear-removal-history');b.click();assert.equal(s.calls.some(m=>m.scope==='rt-removal'&&m.action==='clear'),false);assert.match(b.textContent,/Confirm/);b.click();await settle();assert.ok(s.calls.some(m=>m.scope==='rt-removal'&&m.action==='clear'&&m.tabId===1));
});

test('recent changes keep links to posts published on a user profile',async t=>{
 const s=await setup(t,{profilePost:true});s.W.document.querySelector('#removal-history-toggle').click();await settle();assert.match(s.W.document.querySelector('#removal-history a')?.href || '',/\/user\/Example\/comments\/post1\//);
});
