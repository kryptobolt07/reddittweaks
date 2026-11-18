const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const names=['reddit_session','token_v2','loid','csrf_token','session_tracker'];
function fixture(){
 const jar=new Map(names.map(name=>[name,{name,value:name+'-alice',domain:'.reddit.com',path:'/',secure:true,httpOnly:true,hostOnly:false,session:true}]));jar.set('_ga',{name:'_ga',value:'device',domain:'.reddit.com',path:'/'});
 const values={},reloads=[],hooks={};let listener,fail=0;
 const chrome={runtime:{id:'own',getURL:p=>'chrome-extension://own/'+p,onMessage:{addListener(f){listener=f;}}},storage:{local:{async get(k){return {[k]:structuredClone(values[k])}},async set(v){Object.assign(values,structuredClone(v))}}},cookies:{async getAll(){return [...jar.values()].map(c=>({...c}))},async remove({name}){if(fail && --fail===0)throw Error('cookie failure');jar.delete(name)},async set(c){jar.set(c.name,{...c,domain:c.domain||'reddit.com',hostOnly:!c.domain,session:true});return c}},tabs:{async query(){return [{id:1}]},async reload(id){reloads.push(id)},async update(id){return {id}},async create(){return {id:9}},onRemoved:{addListener(f){hooks.removed=f}}}};
 const start=()=>{const ctx=vm.createContext({chrome,URL,console});vm.runInContext(fs.readFileSync('extension/account-broker.js','utf8'),ctx)};start();
 const page={id:'own',frameId:0,tab:{id:1},url:'https://www.reddit.com/'},popup={id:'own',url:'chrome-extension://own/popup.html'};
 const send=(m,s=page)=>new Promise(resolve=>listener({scope:'rt-accounts',...m},s,resolve));
 return {jar,values,reloads,hooks,send,page,popup,start,fail:(at=1)=>{fail=at}};
}
const alice={owner:'t2_alice',username:'alice',avatar:''};
test('anonymous saves current session, clears authentication only, survives restart, and returns to saved account',async()=>{
 const w=fixture();let result=await w.send({action:'anonymous',from:alice.owner,username:alice.username});assert.equal(result.ok,true);
 assert.equal(w.jar.has('reddit_session'),false);assert.equal(w.jar.has('token_v2'),false);for(const n of ['loid','csrf_token','session_tracker','_ga'])assert.equal(w.jar.has(n),true);
 w.start();await w.send({action:'remember',owner:''});result=await w.send({action:'list'},w.popup);assert.equal(result.anonymous,true);assert.equal(result.current,'');assert.equal(result.accounts[0].current,false);assert.equal(JSON.stringify(result).includes('reddit_session-alice'),false);
 result=await w.send({action:'switch',owner:alice.owner,from:''});assert.equal(result.ok,true);assert.equal(w.jar.get('reddit_session').value,'reddit_session-alice');assert.equal((await w.send({action:'list'},w.popup)).anonymous,false);
});
test('adding from anonymous and canceling stays anonymous; native sign-in exits anonymous',async()=>{
 const w=fixture();await w.send({action:'anonymous',from:alice.owner,username:alice.username});await w.send({action:'add',owner:''});await w.send({action:'remember',owner:''});await w.hooks.removed(1);assert.equal(w.jar.has('reddit_session'),false);assert.equal((await w.send({action:'list'},w.popup)).anonymous,true);
 w.jar.set('reddit_session',{name:'reddit_session',value:'native',domain:'.reddit.com',path:'/'});await w.send({action:'remember',owner:'t2_bob'});const result=await w.send({action:'list'},w.popup);assert.equal(result.anonymous,false);assert.equal(result.current,'t2_bob');
});
test('anonymous refuses unsaved sessions and a cookie failure leaves the account signed in',async()=>{
 const w=fixture();let r=await w.send({action:'anonymous'},w.popup);assert.equal(r.ok,false);assert.equal(w.jar.get('reddit_session').value,'reddit_session-alice');
 await w.send({action:'save-current',...alice});w.fail(2);r=await w.send({action:'anonymous',from:alice.owner});assert.equal(r.ok,false);assert.equal(w.jar.get('reddit_session').value,'reddit_session-alice');assert.equal((await w.send({action:'list'},w.popup)).anonymous,false);
});

test('concurrent anonymous and list operations are serialized',async()=>{
 const w=fixture();const [a,list]=await Promise.all([w.send({action:'anonymous',from:alice.owner,username:alice.username}),w.send({action:'list'},w.popup)]);
 assert.equal(a.ok,true);assert.equal(list.anonymous,true);assert.equal(list.current,'');assert.equal(list.accounts[0].username,'alice');
});
