const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
// Synthetic server markup: production must copy what Reddit serves, never these fixture strings.
const markup='<div id="empty-search-results" class="native-empty-shell"><img data-native-art="search-empty" src="https://www.redditstatic.com/synthetic-search-empty.png"><h2>Hm...we couldn’t find any results for a query</h2><p>Double-check your spelling or try different keywords</p><button>Adjust your search</button></div>';
function setup(t,{present=false}={}){
 const dom=new JSDOM('<main>'+(present?markup:'')+'<div id="rt-search-empty-example" data-rt-ui="search-empty"></div></main>',{url:'https://www.reddit.com/user/Example/search/?rt_list=removed',runScripts:'outside-only'}),W=dom.window,calls=[];t.after(()=>W.close());
 W.customElements.define('faceplate-partial',class extends W.HTMLElement{constructor(){super();this.setAttribute('data-native-constructor','true');}_renderContent(html){this.innerHTML=html;}});
 W.fetch=async(url,init)=>{calls.push({url,init});return {ok:true,status:200,headers:{get:()=>null},async text(){return '<main>'+markup+'</main>';}};};
 for(const f of ['post-model.js','post-page-bridge.js'])W.eval(fs.readFileSync('extension/'+f,'utf8'));
 return {W,calls,send(args={}){return new Promise(resolve=>{
  const channel=W.crypto.randomUUID(),id=W.crypto.randomUUID(),receive=e=>{const v=JSON.parse(e.detail);if(v.channel!==channel || v.id!==id)return;W.document.removeEventListener('rt-post-response',receive);resolve(v);};
  W.document.addEventListener('rt-post-response',receive);W.document.dispatchEvent(new W.CustomEvent('rt-post-request',{detail:JSON.stringify({channel,id,action:'render-search-empty',username:'Example',target:'rt-search-empty-example',...args})}));
 });}};
}
for(const present of [true,false])test('empty-search renderer reuses Reddit native markup and caches its fixed search read ('+present+')',async t=>{
 const s=setup(t,{present}),r=await s.send();assert.equal(r.ok,true);assert.equal(r.rendered,true);const target=s.W.document.getElementById('rt-search-empty-example');assert.ok(target.querySelector('[data-native-art="search-empty"]'));assert.equal(target.querySelector('button').textContent,'Adjust your search');assert.equal(s.calls.length,present?0:1);await s.send();assert.equal(s.calls.length,present?0:1);
 if(!present){const u=new URL(s.calls[0].url);assert.equal(u.origin,'https://www.reddit.com');assert.equal(u.pathname,'/user/Example/search/');assert.equal(u.searchParams.get('type'),'posts');assert.equal(s.calls[0].init.credentials,'include');}
});
test('empty-search renderer rejects arbitrary destinations and unmatched profiles',async t=>{const s=setup(t);assert.equal((await s.send({username:'Other'})).ok,false);assert.equal((await s.send({target:'main'})).ok,false);assert.equal(s.calls.length,0);});

test('empty-search renderer treats a challenge page as failure, not an empty result',async t=>{
 const s=setup(t);s.W.fetch=async()=>({ok:true,status:200,headers:{get:()=>null},async text(){return '<main>Prove your humanity</main>';}});const result=await s.send();assert.equal(result.ok,false);assert.match(result.error,/no native empty search view/);assert.equal(s.W.document.querySelector('[data-native-art]'),null);
});
