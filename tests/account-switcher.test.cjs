// Account switcher (docs/account-switcher-spec.md): worker store and session swap, Reddit menu rows, popup card.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const read=file=>fs.readFileSync('extension/'+file,'utf8');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(r=>setImmediate(r));};
const SESSION=['reddit_session','token_v2','loid','csrf_token','session_tracker'];

// A cookie jar keyed by name: the browser's current reddit.com cookies.
function jarFor(account){const jar=new Map();for(const name of SESSION)jar.set(name,{name,value:name+'-'+account,domain:name==='csrf_token'?'.reddit.com':'.reddit.com',path:'/',secure:true,httpOnly:['reddit_session','token_v2'].includes(name),sameSite:'lax',hostOnly:false,session:name==='csrf_token',expirationDate:name==='csrf_token'?undefined:1900000000});
 jar.set('_ga',{name:'_ga',value:'device',domain:'.reddit.com',path:'/',secure:false,httpOnly:false,sameSite:'unspecified',hostOnly:false,session:false,expirationDate:1900000000});return jar;}
function worker({jar=jarFor('alice'),privateJar=new Map(),focused={id:1,incognito:false,tabs:[{id:1,active:true}]}}={}){
 // Store '0' is the normal cookie jar; store '1' is a private (incognito) window's jar with tab 3.
 const values={},sessionValues={},tabs=[{id:1,url:'https://www.reddit.com/user/alice/'},{id:2,url:'https://www.reddit.com/r/pics/'},{id:3,url:'https://www.reddit.com/',incognito:true}],reloads=[],updates=[],created=[],hooks={};let listener;
 const jars={'0':jar,'1':privateJar},pick=storeId=>jars[storeId ?? '0'];
 const area=bag=>({async get(k){if(k===null)return structuredClone(bag);return {[k]:structuredClone(bag[k])};},async set(v){Object.assign(bag,structuredClone(v));}});
 const chrome={runtime:{id:'own',getURL:p=>'chrome-extension://own/'+p,onMessage:{addListener(fn){listener=fn;}}},
  storage:{local:area(values),session:area(sessionValues)},
  windows:{async getLastFocused(){return structuredClone(focused);}},
  cookies:{async getAll({domain,storeId}){return [...pick(storeId).values()].filter(c=>c.domain.replace(/^\./,'').endsWith(domain)).map(c=>({...c}));},
   async getAllCookieStores(){return [{id:'0',tabIds:[1,2]},{id:'1',tabIds:[3]}];},
   async remove({url,name,storeId}){pick(storeId).delete(name);return {url,name};},
   async set(details){assert.ok(details.url.startsWith('https://'),'cookie urls are https');const {url,storeId,...rest}=details;pick(storeId).set(details.name,{hostOnly:!details.domain,session:!details.expirationDate,...rest,domain:details.domain || new URL(url).hostname});return details;}},
  tabs:{async query(){return tabs.map(t=>({...t}));},async reload(id){reloads.push(id);},async update(id,props){updates.push([id,props]);return {id,...props};},async create(props){created.push(props);return {id:9,...props};},onRemoved:{addListener(fn){hooks.removed=fn;}}}};
 const ctx=vm.createContext({chrome,URL,console,setTimeout,clearTimeout,structuredClone});
 for(const file of ['post-model.js','account-broker.js'])vm.runInContext(read(file),ctx);
 const reddit={id:'own',frameId:0,tab:{id:1},url:'https://www.reddit.com/user/alice/'},popup={id:'own',url:'chrome-extension://own/popup.html'};
 const send=(message,from=reddit)=>new Promise(resolve=>{if(listener({scope:'rt-accounts',...message},from,resolve)!==true)resolve(undefined);});
 const incognito={id:'own',frameId:0,tab:{id:3,incognito:true,windowId:7},url:'https://www.reddit.com/'};
 return {send,values,sessionValues,jar,privateJar,reloads,updates,created,reddit,popup,incognito,hooks};
}
const alice={owner:'t2_alice',username:'alice',avatar:'https://styles.redditmedia.com/t5_a/styles/profileIcon_alice.png'};
const bob={owner:'t2_bob',username:'bob',avatar:'https://styles.redditmedia.com/t5_b/styles/profileIcon_bob.png'};

test('saving the current account keeps only its five session cookies, and lists never expose cookie values',async()=>{
 const w=worker();assert.equal((await w.send({action:'save-current',...alice})).ok,true);
 const saved=w.values['rt-accounts-v1'].accounts[0];assert.equal(saved.owner,'t2_alice');assert.deepEqual(saved.cookies.map(c=>c.name).sort(),[...SESSION].sort(),'analytics and device cookies are not part of an account');
 const list=await w.send({action:'list',owner:'t2_alice'});assert.equal(list.ok,true);assert.equal(list.accounts.length,1);
 assert.equal(JSON.stringify(list).includes('reddit_session-alice'),false,'no cookie values leave the worker');assert.equal(list.accounts[0].current,true);assert.equal(list.accounts[0].username,'alice');
});
test('switching re-saves the current account, swaps only the session cookies and reloads every Reddit tab',async()=>{
 const w=worker();await w.send({action:'save-current',...alice});
 // Bob was added earlier: switch the jar to Bob and save him.
 for(const [k,v] of jarFor('bob'))w.jar.set(k,v);await w.send({action:'save-current',...bob});
 for(const [k,v] of jarFor('alice'))w.jar.set(k,v);w.jar.get('token_v2').value='token_v2-alice-rotated';
 const r=await w.send({action:'switch',owner:'t2_bob',from:'t2_alice'});assert.equal(r.ok,true);
 assert.equal(w.jar.get('reddit_session').value,'reddit_session-bob');assert.equal(w.jar.get('token_v2').value,'token_v2-bob');assert.equal(w.jar.get('_ga').value,'device','device cookies untouched');
 assert.deepEqual(w.reloads.sort(),[1,2]);
 const back=await w.send({action:'switch',owner:'t2_alice',from:'t2_bob'});assert.equal(back.ok,true);assert.equal(w.jar.get('token_v2').value,'token_v2-alice-rotated','the rotated token was re-saved before switching away');
});
test('add account saves the current one, clears only the sign-in cookies and opens Reddit login without reloading other tabs',async()=>{
 const w=worker();const r=await w.send({action:'add',...alice});assert.equal(r.ok,true);
 assert.equal(w.values['rt-accounts-v1'].accounts.length,1);for(const name of ['reddit_session','token_v2'])assert.equal(w.jar.has(name),false,name+' cleared');
 for(const name of ['loid','csrf_token','session_tracker'])assert.equal(w.jar.has(name),true,name+' kept so Reddit’s sign-in form stays valid');assert.equal(w.jar.get('_ga').value,'device');assert.deepEqual(w.reloads,[],'no reload race while signing in');
 assert.deepEqual(JSON.parse(JSON.stringify(w.updates.at(-1))),[1,{url:'https://www.reddit.com/login/'}]);
 const fromPopup=worker({jar:new Map()});await fromPopup.send({action:'add'},fromPopup.popup);assert.equal(fromPopup.created.at(-1).url,'https://www.reddit.com/login/');
});
test('a switch that lands on another account or signed out marks the target “Sign in again”',async()=>{
 const w=worker();await w.send({action:'save-current',...alice});for(const [k,v] of jarFor('bob'))w.jar.set(k,v);await w.send({action:'save-current',...bob});
 await w.send({action:'switch',owner:'t2_alice',from:'t2_bob'});await w.send({action:'remember',owner:''});
 const list=await w.send({action:'list',owner:''});assert.equal(list.accounts.find(a=>a.owner==='t2_alice').expired,true);
 for(const [k,v] of jarFor('alice'))w.jar.set(k,v);await w.send({action:'save-current',...alice});assert.equal((await w.send({action:'list',owner:'t2_alice'})).accounts.find(a=>a.owner==='t2_alice').expired,false,'saving again clears it');
});
test('remove forgets an account; invalid or foreign senders are refused',async()=>{
 const w=worker();await w.send({action:'save-current',...alice});assert.equal((await w.send({action:'remove',owner:'t2_alice'},w.popup)).ok,true);assert.equal((await w.send({action:'list'},w.popup)).accounts.length,0);
 assert.equal((await w.send({action:'save-current',...alice},{id:'evil',frameId:0,tab:{id:1},url:'https://www.reddit.com/'})).ok,false);
 assert.equal((await w.send({action:'save-current',...alice},{id:'own',frameId:2,tab:{id:1},url:'https://www.reddit.com/'})).ok,false,'subframes');
 assert.equal((await w.send({action:'save-current',...alice},{id:'own',frameId:0,tab:{id:1},url:'https://evil.example/'})).ok,false,'non-Reddit pages');
 assert.equal((await w.send({action:'save-current',owner:'nope',username:'alice'})).ok,false);
});

test('the popup never drops a signed-in session that was not saved: Add account and Switch refuse until it is saved',async()=>{
 const w=worker({jar:jarFor('bob')});await w.send({action:'remember',owner:'t2_bob'});
 // Alice is saved from earlier; Bob is signed in now but was never saved.
 w.values['rt-accounts-v1'].accounts.push({owner:'t2_alice',username:'alice',avatar:'',savedAt:1,expired:false,cookies:[...jarFor('alice').values()].filter(c=>SESSION.includes(c.name))});
 const added=await w.send({action:'add'},w.popup);assert.equal(added.ok,false);assert.match(added.error,/Reload a Reddit tab/);assert.equal(w.jar.get('reddit_session').value,'reddit_session-bob','session kept');assert.equal(w.created.length,0);
 const switched=await w.send({action:'switch',owner:'t2_alice'},w.popup);assert.equal(switched.ok,false);assert.equal(w.jar.get('reddit_session').value,'reddit_session-bob');
 // Signed out: Add account just opens Reddit's sign-in.
 const out=worker({jar:new Map()});assert.equal((await out.send({action:'add'},out.popup)).ok,true);assert.equal(out.created.at(-1).url,'https://www.reddit.com/login/');
});

test('if you leave sign-in without signing in, or close its tab, the previous account comes back',async()=>{
 const w=worker();await w.send({action:'add',...alice});
 await w.send({action:'remember',owner:''},{...w.reddit,url:'https://www.reddit.com/login/?solution=x'});assert.equal(w.jar.has('reddit_session'),false,'still on the sign-in page: wait');
 const other=await w.send({action:'remember',owner:''},{...w.reddit,tab:{id:2},url:'https://www.reddit.com/r/pics/'});assert.notEqual(other.restored,true,'another tab loading does not cut sign-in short');
 const r=await w.send({action:'remember',owner:''},{...w.reddit,url:'https://www.reddit.com/r/pics/'});assert.equal(r.restored,true);
 assert.equal(w.jar.get('reddit_session').value,'reddit_session-alice');assert.equal(w.jar.get('token_v2').value,'token_v2-alice');assert.deepEqual(w.reloads.sort(),[1,2]);
 const v=worker();await v.send({action:'add',...alice});v.hooks.removed(1);await flush();assert.equal(v.jar.get('reddit_session').value,'reddit_session-alice','closing the sign-in tab restores');
});
test('signing in to a new account during Add account asks the page to save it, and stops the restore',async()=>{
 const w=worker();await w.send({action:'add',...alice});for(const [k,v] of jarFor('bob'))w.jar.set(k,v);
 const r=await w.send({action:'remember',owner:'t2_bob'},{...w.reddit,url:'https://www.reddit.com/'});assert.equal(r.save,true);
 await w.send({action:'save-current',...bob},{...w.reddit,url:'https://www.reddit.com/'});await w.send({action:'remember',owner:''},{...w.reddit,url:'https://www.reddit.com/r/pics/'});
 assert.equal(w.jar.get('reddit_session').value,'reddit_session-bob','no restore once signed in');assert.deepEqual(w.values['rt-accounts-v1'].accounts.map(a=>a.owner).sort(),['t2_alice','t2_bob']);
});

test('any signed-in account Reddit reports is saved straight away, without opening the account menu',async()=>{
 const w=worker();const r=await w.send({action:'remember',owner:'t2_alice'});assert.equal(r.save,true,'the page is asked to read its name and save');
 await w.send({action:'save-current',...alice});assert.equal((await w.send({action:'remember',owner:'t2_alice'})).save,false,'saved accounts only refresh');
});
test('on phones the popup opens as a tab and still manages accounts',async()=>{
 const w=worker();await w.send({action:'save-current',...alice});const asTab={...w.popup,tab:{id:7,windowId:1}};
 const list=await w.send({action:'list'},asTab);assert.equal(list.ok,true);assert.equal(list.accounts.length,1);
 assert.equal((await w.send({action:'add'},asTab)).ok,true);assert.equal(w.created.at(-1).url,'https://www.reddit.com/login/','opens sign-in in a new tab, never in the popup’s own tab');assert.equal(w.updates.length,0);
});
test('a private window switches its own cookie store, keeps its accounts in session storage and reloads only private tabs',async()=>{
 const w=worker({privateJar:jarFor('carol')});await w.send({action:'save-current',...alice});
 // Carol is signed in only in the private window.
 await w.send({action:'save-current',owner:'t2_carol',username:'carol',avatar:''},w.incognito);
 assert.equal(w.values['rt-accounts-v1'].accounts.some(a=>a.owner==='t2_carol'),false,'never written to persistent storage');
 assert.ok(w.sessionValues['rt-accounts-v1:1'].accounts.some(a=>a.owner==='t2_carol'));
 const list=await w.send({action:'list',owner:'t2_carol'},w.incognito);assert.deepEqual(JSON.parse(JSON.stringify(list.accounts.map(a=>a.owner+(a.private?'*':'')).sort())),['t2_alice','t2_carol*'],'normal accounts are offered too');assert.equal(list.private,true);
 const r=await w.send({action:'switch',owner:'t2_alice',from:'t2_carol'},w.incognito);assert.equal(r.ok,true);
 assert.equal(w.privateJar.get('reddit_session').value,'reddit_session-alice','private store switched');assert.equal(w.jar.get('reddit_session').value,'reddit_session-alice','normal store untouched');
 assert.deepEqual(JSON.parse(JSON.stringify(w.reloads)),[3],'only the private window’s Reddit tabs reload');
 assert.equal(w.values['rt-accounts-v1'].accounts.find(a=>a.owner==='t2_alice').cookies.find(c=>c.name==='reddit_session').value,'reddit_session-alice','the normal record is never overwritten from a private window');
});
test('the popup opened from a private window acts on that window’s cookie store',async()=>{
 const w=worker({privateJar:jarFor('carol'),focused:{id:7,incognito:true,tabs:[{id:3,active:true}]}});await w.send({action:'save-current',...alice});
 await w.send({action:'remember',owner:'t2_carol'},w.incognito);await w.send({action:'save-current',owner:'t2_carol',username:'carol',avatar:''},w.incognito);
 const list=await w.send({action:'list'},w.popup);assert.equal(list.private,true);assert.equal(list.current,'t2_carol');
 assert.equal((await w.send({action:'switch',owner:'t2_alice'},w.popup)).ok,true);assert.equal(w.privateJar.get('reddit_session').value,'reddit_session-alice');assert.equal(w.jar.get('reddit_session').value,'reddit_session-alice');
});

test('Reddit’s device settings (sort, view, chat layout, codecs, consent) are never touched by switching, adding or anonymous browsing',async()=>{
 // Measured 2026-11-19: these reddit.com cookies hold device preferences; only the five session cookies belong to an account.
 const device=['pc','csv','subreddit_sort','edgebucket','reddit_chat_path','reddit_chat_view','reddit_supported_media_codecs','ads_cookie'];
 const seed=jar=>{for(const name of device)jar.set(name,{name,value:name+'-device',domain:'.reddit.com',path:'/',secure:true,httpOnly:false,sameSite:'lax',hostOnly:false,session:false,expirationDate:1900000000});return jar;};
 const w=worker({jar:seed(jarFor('alice'))});await w.send({action:'save-current',...alice});
 for(const [k,v] of jarFor('bob'))w.jar.set(k,v);await w.send({action:'save-current',...bob});
 await w.send({action:'switch',owner:'t2_alice',from:'t2_bob'});await w.send({action:'anonymous',from:'t2_alice',...alice});await w.send({action:'switch',owner:'t2_bob'});await w.send({action:'add',...bob});
 for(const name of device)assert.equal(w.jar.get(name)?.value,name+'-device',name+' kept');
});

// Reddit's account menu, as measured live 2026-11-17 (synthetic names): ul sections, View Profile first.
const viewProfile=name=>'<faceplate-tracker class="contents"><li rpl="" class="relative list-none mt-0 " role="presentation"><a class="flex justify-between relative px-md gap-xs text-secondary-plain hover:bg-neutral-background-hover cursor-pointer py-xs no-underline" href="/user/'+name+'/" style="padding-inline-end: 16px"><span class="flex items-center gap-xs min-w-0 shrink"><span class="flex shrink-0 items-center justify-center h-xl w-xl "><span class="text-20 leading-4"><span avatar="">default</span></span></span><span class="flex flex-col justify-center min-w-0 shrink py-[0.375rem]"><span class="text-body-2">View Profile</span><span class="text-caption-1 text-secondary-plain-weak">u/'+name+'</span></span></span><span class="flex items-center shrink-0"><span class="flex items-center justify-center h-lg"></span></span></a></li></faceplate-tracker>';
const menuHtml=(id,name)=>'<div id="'+id+'"><faceplate-loader></faceplate-loader><ul class="w-100 p-0 m-0 list-none my-xs">'+viewProfile(name)+'<faceplate-tracker class="contents"><li><a href="/avatar">Edit Avatar</a></li></faceplate-tracker></ul><hr class="h-px w-100 bg-neutral-border-weak border-0"><ul class="w-100 p-0 m-0 list-none my-xs"><li><a href="/settings">Settings</a></li></ul></div>';
async function page(t,{owner='t2_alice',loggedIn=true,menu='user-drawer-content',accounts=[{owner:'t2_alice',username:'alice',avatar:'',expired:false},{owner:'t2_bob',username:'bob',avatar:'https://styles.redditmedia.com/b.png',expired:false}],list}={}){
 const dom=new JSDOM('<shreddit-app user-logged-in="'+loggedIn+'" logged-in-user-id="'+owner+'"></shreddit-app>'+(menu?menuHtml(menu,'alice'):''),{url:'https://www.reddit.com/r/pics/',runScripts:'outside-only'});
 const W=dom.window,sent=[];t.after(()=>{s?.destroy();W.close();});W.__rtAccountSwitcherTest=true;W.eval(read('account-switcher.js'));
 const transport=async message=>{sent.push(JSON.parse(JSON.stringify(message)));if(message.action==='list')return list?list(message):{ok:true,accounts:accounts.map(a=>({...a,current:a.owner===message.owner}))};if(message.action==='save-current'){accounts.push({owner:message.owner,username:message.username,avatar:'',expired:false});return {ok:true,accounts};}return {ok:true};};
 const s=new W.RTAccountSwitcher.Switcher({send:transport});await s.ready;await flush();return {W,s,sent,d:W.document};
}
const rows=d=>[...d.querySelectorAll('[data-rt-ui="account-row"]')].map(li=>li.querySelector('.text-body-2').textContent+'|'+li.querySelector('.text-caption-1').textContent);

const signedOutMenu=id=>'<div id="'+id+'"><ul class="w-100 p-0 m-0 list-none my-xs"><li class="relative list-none mt-0"><a class="flex justify-between relative px-md py-xs" href="/login/"><span class="flex items-center gap-xs"><svg></svg><span>Log In / Sign Up</span></span></a></li><li><a href="/advertise">Advertise on Reddit</a></li></ul></div>';
const panelRows=d=>[...d.querySelectorAll('[data-rt-ui="accounts-panel"] [data-rt-ui="account-row"],[data-rt-ui="accounts-panel"] [data-rt-ui="account-back"]')].map(li=>li.dataset.rtUi==='account-back'?'←'+li.querySelector('.rt-accounts-title').textContent:li.querySelector('.text-body-2').textContent+'|'+(li.querySelector('.text-caption-1').hidden?'':li.querySelector('.text-caption-1').textContent));
const entry=d=>d.querySelector('[data-rt-ui="accounts"] a');
const open=async d=>{entry(d).click();await flush();};
test('one Switch accounts row sits right after View Profile, built from Reddit’s own row',async t=>{
 const {d,sent}=await page(t);assert.deepEqual(sent[0],{action:'remember',owner:'t2_alice'});
 const wrap=d.querySelector('[data-rt-ui="accounts"]');assert.equal(wrap.previousElementSibling,d.querySelector('faceplate-tracker'),'directly after View Profile');
 assert.equal(entry(d).querySelector('.text-body-2').textContent,'Switch accounts');assert.equal(entry(d).querySelector('.text-caption-1').textContent,'1 other account');assert.equal(entry(d).querySelector('.text-caption-1').hidden,false,'the caption shows');
 assert.ok(entry(d).querySelector('[data-rt-icon="switchAccount"]') && entry(d).querySelector('[data-rt-icon="next"]'));assert.equal(entry(d).getAttribute('aria-haspopup'),'menu');
 assert.match(entry(d).className,/hover:bg-neutral-background-hover/,'Reddit’s own row classes');assert.equal(d.querySelectorAll('[data-owner="t2_bob"]').length,0,'accounts stay in the submenu');
});
test('the submenu replaces Reddit’s sections in place: current account checked, others, Browse signed out, Add account',async t=>{
 const {d}=await page(t);await open(d);const menu=d.querySelector('#user-drawer-content');
 assert.equal([...menu.children].filter(c=>c.dataset.rtUi!=='accounts-panel').every(c=>c.style.display==='none'),true,'Reddit’s sections are hidden, not removed');
 assert.deepEqual(panelRows(d),['←Accounts','u/alice|Signed in','u/bob|Switch to this account','Anonymous browsing|Use Reddit without an account','Add account|Sign in to another account']);
 assert.ok(d.querySelector('[data-rt-ui="accounts-panel"] [data-owner="t2_alice"] [data-rt-icon="checkmark"]'));assert.equal(d.querySelector('[data-owner="t2_bob"] img').src,'https://styles.redditmedia.com/b.png');
 assert.equal(d.querySelector('[data-rt-ui="account-back"] button').getAttribute('aria-label'),'Back to menu');assert.equal(d.querySelector('[data-rt-ui="accounts-panel"]').textContent.includes('Switch accounts'),false,'the row we came from is not repeated');d.querySelector('[data-rt-ui="account-back"] button').click();await flush();assert.equal(d.querySelector('[data-rt-ui="accounts-panel"]'),null);assert.equal([...menu.children].some(c=>c.style.display==='none'),false,'Back restores Reddit’s menu');
 await open(d);d.dispatchEvent(new d.defaultView.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await flush();assert.equal(d.querySelector('[data-rt-ui="accounts-panel"]'),null,'Escape goes back first');
 await open(d);d.body.insertAdjacentHTML('beforeend','<button id="expand-user-drawer-button"></button>');d.querySelector('#expand-user-drawer-button').dispatchEvent(new d.defaultView.Event('pointerdown',{bubbles:true}));assert.equal(d.querySelector('[data-rt-ui="accounts-panel"]'),null,'reopening Reddit’s menu starts from its own view');
});
test('on phones Switch accounts opens an Accounts sheet: accounts (current checked, sign out here), Anonymous browsing, Add account',async t=>{
 const {W,d,sent}=await page(t,{menu:'hui-user-drawer-bottom-sheet'});W.eval(read('feed-sheet.js'));W.matchMedia=q=>({matches:/max-width/.test(q),addEventListener(){},removeEventListener(){}});
 await open(d);await flush();const sheet=d.querySelector('[data-rt-ui="feed-sheet"]');assert.ok(sheet,'the Accounts sheet opens');assert.equal(d.querySelector('[data-rt-ui="accounts-panel"]'),null,'Reddit’s sheet content is left alone');
 assert.equal(sheet.querySelector('.rt-fsheet-title').textContent,'Accounts');
 assert.deepEqual([...sheet.querySelectorAll('.rt-fsheet-row')].map(r=>r.querySelector('.rt-fsheet-label').textContent+(r.hasAttribute('aria-current')?'✓':'')),['u/alice✓','u/bob','Anonymous browsing','Add account']);
 assert.equal(sheet.querySelector('.rt-fsheet-row[aria-current] img,.rt-fsheet-row[aria-current] [avatar]')!==null,true,'the current account keeps Reddit’s own avatar');assert.equal(sheet.querySelectorAll('.rt-fsheet-row')[1].querySelector('img').src,'https://styles.redditmedia.com/b.png');
 const out=sheet.querySelector('.rt-fsheet-action');assert.equal(out.getAttribute('aria-label'),'Sign out of u/alice here');assert.ok(out.querySelector('[data-rt-icon="logout"]'),'Reddit’s Log Out door');
 out.click();await flush();assert.equal(sent.some(m=>m.action==='anonymous'),false,'signing out asks once more');out.click();await flush();assert.deepEqual(sent.find(m=>m.action==='anonymous'),{action:'anonymous',from:'t2_alice',username:'alice',avatar:''});
 await open(d);await flush();const bob=[...d.querySelectorAll('.rt-fsheet-row')].find(r=>r.textContent.includes('u/bob'));bob.click();await flush();assert.deepEqual(sent.at(-1),{action:'switch',owner:'t2_bob',from:'t2_alice'});
 await open(d);await flush();const add=[...d.querySelectorAll('.rt-fsheet-row')].find(r=>r.textContent.includes('Add account'));add.click();await flush();assert.match(add.textContent,/Tap again/);add.click();await flush();assert.equal(sent.at(-1).action,'add');
});
test('switching sends the current account; Browse signed out, Add account and expired accounts ask twice',async t=>{
 const {d,sent}=await page(t,{accounts:[{owner:'t2_alice',username:'alice',avatar:''},{owner:'t2_bob',username:'bob',avatar:''},{owner:'t2_carol',username:'carol',avatar:'',expired:true}]});await open(d);
 d.querySelector('[data-rt-ui="accounts-panel"] [data-owner="t2_bob"] a').click();await flush();assert.deepEqual(sent.at(-1),{action:'switch',owner:'t2_bob',from:'t2_alice'});assert.equal(d.querySelector('[data-owner="t2_bob"] .text-caption-1').textContent,'Switching…');
 const count=action=>sent.filter(m=>m.action===action).length,rowNamed=label=>[...d.querySelectorAll('[data-rt-ui="accounts-panel"] [data-rt-ui="account-row"]')].find(li=>li.querySelector('.text-body-2').textContent===label).querySelector('a');
 const carol=d.querySelector('[data-rt-ui="accounts-panel"] [data-owner="t2_carol"] a'),press=el=>el.dispatchEvent(new d.defaultView.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
 press(carol);await flush();assert.equal(count('add'),0);assert.match(carol.querySelector('.text-caption-1').textContent,/again/);press(carol);await flush();assert.equal(count('add'),1);
 rowNamed('Anonymous browsing').click();await flush();assert.equal(count('anonymous'),0,'first press only asks');rowNamed('Anonymous browsing').click();await flush();assert.deepEqual(sent.at(-1),{action:'anonymous',from:'t2_alice',username:'alice',avatar:''});
 rowNamed('Add account').click();await flush();assert.equal(count('add'),1);rowNamed('Add account').click();await flush();assert.equal(count('add'),2);
 const before=sent.length;d.querySelector('[data-rt-ui="accounts-panel"] [data-owner="t2_alice"] a').click();await flush();assert.equal(sent.length,before,'the current account does nothing');
});
test('after signing in through Add account the page saves the new account under its own name',async t=>{
 const dom=new JSDOM('<shreddit-app user-logged-in="true" logged-in-user-id="t2_bob"></shreddit-app>',{url:'https://www.reddit.com/',runScripts:'outside-only'}),W=dom.window,sent=[];t.after(()=>W.close());W.__rtAccountSwitcherTest=true;
 W.fetch=async url=>{assert.equal(url,'/api/me.json');return {ok:true,json:async()=>({data:{id:'bob',name:'bob',icon_img:'https://styles.redditmedia.com/b.png?x=1'}})};};
 W.eval(read('account-switcher.js'));const s=new W.RTAccountSwitcher.Switcher({send:async m=>{sent.push(JSON.parse(JSON.stringify(m)));return m.action==='remember'?{ok:true,save:true}:{ok:true};}});await s.ready;await flush();s.destroy();
 assert.deepEqual(sent[1],{action:'save-current',owner:'t2_bob',username:'bob',avatar:'https://styles.redditmedia.com/b.png?x=1'});
});
test('a scripted click (not the person) never switches, and taps on rows never reach Reddit’s menu handlers',async t=>{
 const {W,d,sent}=await page(t);await open(d);W.__rtAccountSwitcherTest=false;const before=sent.length;
 d.querySelector('[data-owner="t2_bob"] a').click();await flush();assert.equal(sent.length,before);assert.equal(d.querySelector('[data-owner="t2_bob"] .text-caption-1').textContent,'Switch to this account');
 let reached=0;d.querySelector('#user-drawer-content').addEventListener('pointerdown',()=>reached++);d.querySelector('[data-owner="t2_bob"] a').dispatchEvent(new W.Event('pointerdown',{bubbles:true}));assert.equal(reached,0,'the phone sheet never sees the tap');
});
test('a tap on a phone acts on pointerup even when the sheet swallows the click, and the late click never acts twice',async t=>{
 const {W,d,sent}=await page(t,{menu:'hui-user-drawer-bottom-sheet'});
 const tap=(el,{x=10,y=10,dx=0,type='touch'}={})=>{const ev=(name,cx)=>{const e=new W.Event(name,{bubbles:true,cancelable:true});Object.assign(e,{pointerType:type,clientX:cx,clientY:y,pointerId:1});return e;};el.dispatchEvent(ev('pointerdown',x));el.dispatchEvent(ev('pointerup',x+dx));};
 tap(entry(d));await flush();assert.ok(d.querySelector('[data-rt-ui="accounts-panel"]'),'the tap opened the submenu without a click');
 const bob=d.querySelector('[data-rt-ui="accounts-panel"] [data-owner="t2_bob"] a');tap(bob);await flush();assert.equal(sent.filter(m=>m.action==='switch').length,1);
 bob.click();await flush();assert.equal(sent.filter(m=>m.action==='switch').length,1,'the click that follows the tap is ignored');
 const add=[...d.querySelectorAll('[data-rt-ui="accounts-panel"] [data-rt-ui="account-row"] a')].at(-1);tap(add,{dx:40});await flush();assert.doesNotMatch(add.querySelector('.text-caption-1').textContent,/again/,'a drag is not a tap');
 tap(add,{type:'mouse'});await flush();assert.doesNotMatch(add.querySelector('.text-caption-1').textContent,/again/,'mouse input waits for its click');
});
test('an unsaved account is saved when the menu first shows; Reddit re-renders never duplicate the row or lose the open submenu',async t=>{
 const {d,sent,s}=await page(t,{accounts:[]});assert.deepEqual(sent.find(m=>m.action==='save-current'),{action:'save-current',owner:'t2_alice',username:'alice',avatar:''});
 d.querySelector('[data-rt-ui="accounts"]').remove();s.scan();await flush();s.scan();await flush();assert.equal(d.querySelectorAll('[data-rt-ui="accounts"]').length,1);
 await open(d);d.querySelector('[data-rt-ui="accounts-panel"]').remove();s.scan();await flush();assert.equal(d.querySelectorAll('[data-rt-ui="accounts-panel"]').length,1,'reopened after Reddit re-rendered');
 assert.equal(sent.filter(m=>m.action==='list').length,1,'a re-render reuses the list just read');
});
test('the phone sheet gets the same row; signed out it follows Log In when accounts are saved; a failed list says so',async t=>{
 const phone=await page(t,{menu:'hui-user-drawer-bottom-sheet'});assert.ok(phone.d.querySelector('#hui-user-drawer-bottom-sheet [data-rt-ui="accounts"]'));await open(phone.d);assert.equal(panelRows(phone.d).length,5);
 const dom=new JSDOM('<shreddit-app user-logged-in="false"></shreddit-app>'+signedOutMenu('user-drawer-content'),{url:'https://www.reddit.com/',runScripts:'outside-only'}),W=dom.window;t.after(()=>W.close());W.__rtAccountSwitcherTest=true;W.eval(read('account-switcher.js'));
 const out=new W.RTAccountSwitcher.Switcher({send:async m=>m.action==='list'?{ok:true,anonymous:true,accounts:[{owner:'t2_alice',username:'alice',avatar:''}]}:{ok:true}});await out.ready;await flush();
 const row=W.document.querySelector('[data-rt-ui="accounts"]');assert.equal(row.previousElementSibling.textContent.trim(),'Log In / Sign Up');assert.equal(row.querySelector('.text-caption-1').textContent,'Browsing anonymously');
 row.querySelector('a').click();await flush();assert.deepEqual(panelRows(W.document).slice(1,3),['u/alice|Switch to this account','Anonymous browsing|Signed out here']);out.destroy();
 const none=new JSDOM('<shreddit-app user-logged-in="false"></shreddit-app>'+signedOutMenu('user-drawer-content'),{url:'https://www.reddit.com/',runScripts:'outside-only'}).window;t.after(()=>none.close());none.__rtAccountSwitcherTest=true;none.eval(read('account-switcher.js'));
 const empty=new none.RTAccountSwitcher.Switcher({send:async m=>m.action==='list'?{ok:true,anonymous:false,accounts:[]}:{ok:true}});await empty.ready;await flush();assert.equal(none.document.querySelector('[data-rt-ui="accounts"]'),null,'nothing saved: only Reddit’s Log In');empty.destroy();
 const failed=await page(t,{list:()=>({ok:false,error:'Worker unavailable'})});assert.equal(entry(failed.d).querySelector('.text-caption-1').textContent,'Worker unavailable');
});
async function popupPage(t,{accounts=[{owner:'t2_alice',username:'alice',avatar:'',expired:false,current:true},{owner:'t2_bob',username:'bob',avatar:'https://styles.redditmedia.com/b.png',expired:false,current:false},{owner:'t2_carol',username:'carol',avatar:'',expired:true,current:false}],fail=''}={}){
 const dom=new JSDOM(fs.readFileSync('extension/popup.html','utf8'),{url:'https://extension.test/popup.html',runScripts:'outside-only'}),W=dom.window,sent=[];t.after(()=>W.close());
 W.chrome={runtime:{async sendMessage(m){sent.push(JSON.parse(JSON.stringify(m)));if(m.scope!=='rt-accounts')return {ok:true};if(m.action==='list')return fail?{ok:false,error:fail}:{ok:true,accounts};if(m.action==='remove'){accounts=accounts.filter(a=>a.owner!==m.owner);return {ok:true,accounts};}return {ok:true};}}};
 W.eval(read('popup-accounts.js'));await flush();return {W,d:W.document,sent};
}
const popupRows=d=>[...d.querySelectorAll('#account-list > li')].map(li=>li.querySelector('.account-name').textContent+'|'+li.querySelector('.account-caption').textContent+'|'+[...li.querySelectorAll('button')].map(b=>b.textContent).join(','));
test('the popup Accounts card lists saved accounts with Switch, Sign in again and Remove, and Add account',async t=>{
 const {d,sent}=await popupPage(t);assert.ok(d.querySelector('#panel-home #accounts-home'),'on Home');assert.match(fs.readFileSync('extension/popup.html','utf8'),/<script src="popup-accounts\.js"><\/script>/);
 assert.deepEqual(popupRows(d),['u/alice|Signed in|','u/bob|Saved on this device|Switch,×','u/carol|Session expired|Sign in again,×']);
 assert.equal(d.querySelector('#account-list > li:nth-child(2) img').src,'https://styles.redditmedia.com/b.png');
 d.querySelector('#account-list > li:nth-child(2) .account-switch').click();await flush();assert.deepEqual(sent.find(m=>m.action==='switch'),{scope:'rt-accounts',action:'switch',owner:'t2_bob'});assert.match(d.querySelector('#accounts-status').textContent,/Reddit tabs reload/);
 d.querySelector('#account-list > li:nth-child(3) .account-switch').click();await flush();assert.equal(sent.at(-1).action,'add');
 d.querySelector('#add-account').click();await flush();assert.equal(sent.at(-1).action,'add');
});
test('the popup offers Browse signed out (asks twice) and labels private-window accounts',async t=>{
 const {d,sent}=await popupPage(t,{accounts:[{owner:'t2_alice',username:'alice',avatar:'',expired:false,current:true},{owner:'t2_carol',username:'carol',avatar:'',expired:false,current:false,private:true}]});
 assert.match(popupRows(d)[1],/This private window/);const button=d.querySelector('#browse-signed-out');assert.equal(button.textContent,'Anonymous browsing');
 button.click();await flush();assert.equal(sent.some(m=>m.action==='anonymous'),false,'first click only asks');assert.equal(button.textContent,'Sign out here?');
 button.click();await flush();assert.deepEqual(sent.find(m=>m.action==='anonymous'),{scope:'rt-accounts',action:'anonymous'});
});
test('removing needs a second click, and a failed list is reported',async t=>{
 const {d,sent}=await popupPage(t);const remove=d.querySelector('#account-list > li:nth-child(2) .account-remove');assert.equal(remove.getAttribute('aria-label'),'Remove u/bob from this device');
 remove.click();await flush();assert.equal(sent.some(m=>m.action==='remove'),false);assert.equal(remove.textContent,'Remove?');
 remove.click();await flush();assert.deepEqual(sent.find(m=>m.action==='remove'),{scope:'rt-accounts',action:'remove',owner:'t2_bob'});assert.deepEqual(popupRows(d).map(r=>r.split('|')[0]),['u/alice','u/carol']);
 const failed=await popupPage(t,{fail:'Worker unavailable'});assert.match(failed.d.querySelector('#accounts-status').textContent,/Worker unavailable/);assert.ok(failed.d.querySelector('#accounts-status').classList.contains('error'));
 const empty=await popupPage(t,{accounts:[]});assert.match(empty.d.querySelector('#account-list').textContent+empty.d.querySelector('#accounts-home').textContent,/account menu/);
});
