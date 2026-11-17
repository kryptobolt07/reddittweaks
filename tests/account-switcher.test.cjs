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
function worker({jar=jarFor('alice')}={}){
 const values={},tabs=[{id:1,url:'https://www.reddit.com/user/alice/'},{id:2,url:'https://www.reddit.com/r/pics/'}],reloads=[],updates=[],created=[],hooks={};let listener;
 const chrome={runtime:{id:'own',getURL:p=>'chrome-extension://own/'+p,onMessage:{addListener(fn){listener=fn;}}},
  storage:{local:{async get(k){return {[k]:structuredClone(values[k])};},async set(v){Object.assign(values,structuredClone(v));}}},
  cookies:{async getAll({domain}){return [...jar.values()].filter(c=>c.domain.replace(/^\./,'').endsWith(domain)).map(c=>({...c}));},
   async remove({url,name}){jar.delete(name);return {url,name};},
   async set(details){assert.ok(details.url.startsWith('https://'),'cookie urls are https');const {url,...rest}=details;jar.set(details.name,{hostOnly:!details.domain,session:!details.expirationDate,...rest,domain:details.domain || new URL(url).hostname});return details;}},
  tabs:{async query(){return tabs.map(t=>({...t}));},async reload(id){reloads.push(id);},async update(id,props){updates.push([id,props]);return {id,...props};},async create(props){created.push(props);return {id:9,...props};},onRemoved:{addListener(fn){hooks.removed=fn;}}}};
 const ctx=vm.createContext({chrome,URL,console,setTimeout,clearTimeout,structuredClone});
 for(const file of ['post-model.js','account-broker.js'])vm.runInContext(read(file),ctx);
 const reddit={id:'own',frameId:0,tab:{id:1},url:'https://www.reddit.com/user/alice/'},popup={id:'own',url:'chrome-extension://own/popup.html'};
 const send=(message,from=reddit)=>new Promise(resolve=>{if(listener({scope:'rt-accounts',...message},from,resolve)!==true)resolve(undefined);});
 return {send,values,jar,reloads,updates,created,reddit,popup,hooks};
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
 const added=await w.send({action:'add'},w.popup);assert.equal(added.ok,false);assert.match(added.error,/account menu/);assert.equal(w.jar.get('reddit_session').value,'reddit_session-bob','session kept');assert.equal(w.created.length,0);
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

test('the Accounts group sits directly after View Profile in Reddit’s menu, built from Reddit’s own row',async t=>{
 const {d,sent}=await page(t);assert.deepEqual(sent[0],{action:'remember',owner:'t2_alice'});
 const group=d.querySelector('[data-rt-ui="accounts"]'),tracker=d.querySelector('faceplate-tracker');assert.equal(group.previousElementSibling,tracker,'right after View Profile');
 assert.deepEqual(rows(d),['u/alice|Signed in','u/bob|Switch account','Add account|Sign in to another account']);
 const alice=d.querySelector('[data-owner="t2_alice"] a'),bob=d.querySelector('[data-owner="t2_bob"] a');
 assert.equal(alice.getAttribute('aria-current'),'true');assert.ok(alice.querySelector('[data-rt-icon="checkmark"]'));assert.equal(bob.hasAttribute('href'),false,'rows never navigate');
 assert.match(bob.className,/hover:bg-neutral-background-hover/,'Reddit’s own row classes');assert.equal(bob.querySelector('img').src,'https://styles.redditmedia.com/b.png');
 assert.equal(group.querySelectorAll('hr').length,2,'Reddit’s dividers around the group');
});
test('choosing an account switches from the current one; Add account and an expired account run the add flow',async t=>{
 const {d,sent}=await page(t,{accounts:[{owner:'t2_alice',username:'alice',avatar:''},{owner:'t2_bob',username:'bob',avatar:''},{owner:'t2_carol',username:'carol',avatar:'',expired:true}]});
 assert.deepEqual(rows(d)[2],'u/carol|Sign in again');
 d.querySelector('[data-owner="t2_bob"] a').click();await flush();assert.deepEqual(sent.at(-1),{action:'switch',owner:'t2_bob',from:'t2_alice'});
 assert.equal(d.querySelector('[data-owner="t2_bob"] .text-caption-1').textContent,'Switching…');
 const carol=d.querySelector('[data-owner="t2_carol"] a'),press=()=>carol.dispatchEvent(new d.defaultView.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));press();await flush();assert.notEqual(sent.at(-1).action,'add','Add account signs Reddit out here, so it asks first');assert.match(carol.querySelector('.text-caption-1').textContent,/again/);press();await flush();assert.equal(sent.at(-1).action,'add');assert.equal(sent.at(-1).owner,'t2_alice');assert.equal(sent.at(-1).username,'alice');
 const before=sent.length;d.querySelector('[data-owner="t2_alice"] a').click();await flush();assert.equal(sent.length,before,'the current account does nothing');
 const addRow=[...d.querySelectorAll('[data-rt-ui="account-row"] a')].at(-1);const adds=()=>sent.filter(m=>m.action==='add').length,n=adds();addRow.click();await flush();assert.equal(adds(),n,'first press only asks');addRow.click();await flush();assert.equal(adds(),n+1);
});
test('after signing in through Add account the page saves the new account under its own name',async t=>{
 const dom=new JSDOM('<shreddit-app user-logged-in="true" logged-in-user-id="t2_bob"></shreddit-app>',{url:'https://www.reddit.com/',runScripts:'outside-only'}),W=dom.window,sent=[];t.after(()=>W.close());W.__rtAccountSwitcherTest=true;
 W.fetch=async url=>{assert.equal(url,'/api/me.json');return {ok:true,json:async()=>({data:{id:'bob',name:'bob',icon_img:'https://styles.redditmedia.com/b.png?x=1'}})};};
 W.eval(read('account-switcher.js'));const s=new W.RTAccountSwitcher.Switcher({send:async m=>{sent.push(JSON.parse(JSON.stringify(m)));return m.action==='remember'?{ok:true,save:true}:{ok:true};}});await s.ready;await flush();s.destroy();
 assert.deepEqual(sent[1],{action:'save-current',owner:'t2_bob',username:'bob',avatar:'https://styles.redditmedia.com/b.png?x=1'});
});
test('a scripted click (not the person) never switches or opens Add account',async t=>{
 const {W,d,sent}=await page(t);W.__rtAccountSwitcherTest=false;const before=sent.length;
 d.querySelector('[data-owner="t2_bob"] a').click();[...d.querySelectorAll('[data-rt-ui="account-row"] a')].at(-1).dispatchEvent(new W.MouseEvent('click',{bubbles:true}));await flush();
 assert.equal(sent.length,before);assert.equal(d.querySelector('[data-owner="t2_bob"] .text-caption-1').textContent,'Switch account');
});
test('an unsaved signed-in account is saved when the menu first shows; Reddit re-renders never duplicate the group',async t=>{
 const {d,sent,s}=await page(t,{accounts:[]});assert.deepEqual(sent.find(m=>m.action==='save-current'),{action:'save-current',owner:'t2_alice',username:'alice',avatar:''});
 assert.deepEqual(rows(d),['u/alice|Signed in','Add account|Sign in to another account']);
 d.querySelector('[data-rt-ui="accounts"]').remove();s.scan();await flush();s.scan();await flush();assert.equal(d.querySelectorAll('[data-rt-ui="accounts"]').length,1);
 const lists=sent.filter(m=>m.action==='list').length;assert.equal(lists,1,'a re-render reuses the list just read');
});
test('the phone bottom sheet gets the same group; signed out gets none; a failed list says so',async t=>{
 const phone=await page(t,{menu:'hui-user-drawer-bottom-sheet'});assert.equal(phone.d.querySelector('#hui-user-drawer-bottom-sheet [data-rt-ui="accounts"]').previousElementSibling.matches('faceplate-tracker'),true);
 const out=await page(t,{loggedIn:false,owner:''});assert.deepEqual(out.sent[0],{action:'remember',owner:''});assert.equal(out.d.querySelector('[data-rt-ui="accounts"]'),null);
 const failed=await page(t,{list:()=>({ok:false,error:'Worker unavailable'})});assert.deepEqual(rows(failed.d),['Accounts unavailable|Worker unavailable','Add account|Sign in to another account']);
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
test('removing needs a second click, and a failed list is reported',async t=>{
 const {d,sent}=await popupPage(t);const remove=d.querySelector('#account-list > li:nth-child(2) .account-remove');assert.equal(remove.getAttribute('aria-label'),'Remove u/bob from this device');
 remove.click();await flush();assert.equal(sent.some(m=>m.action==='remove'),false);assert.equal(remove.textContent,'Remove?');
 remove.click();await flush();assert.deepEqual(sent.find(m=>m.action==='remove'),{scope:'rt-accounts',action:'remove',owner:'t2_bob'});assert.deepEqual(popupRows(d).map(r=>r.split('|')[0]),['u/alice','u/carol']);
 const failed=await popupPage(t,{fail:'Worker unavailable'});assert.match(failed.d.querySelector('#accounts-status').textContent,/Worker unavailable/);assert.ok(failed.d.querySelector('#accounts-status').classList.contains('error'));
 const empty=await popupPage(t,{accounts:[]});assert.match(empty.d.querySelector('#account-list').textContent+empty.d.querySelector('#accounts-home').textContent,/account menu/);
});
