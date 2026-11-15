const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs'),vm=require('node:vm');
function setup(){let listener,changed,me={owner:'t2_self',username:'Example'};const values={'rt-settings-v1':{ownRemoval:true,removalNotifications:true}},badges=[];
 const chrome={runtime:{id:'extension',getURL:p=>'chrome-extension://extension/'+p,onMessage:{addListener(fn){listener=fn;}}},storage:{local:{async get(k){return {[k]:structuredClone(values[k])};},async set(v){Object.assign(values,structuredClone(v));},async remove(k){delete values[k];}},onChanged:{addListener(fn){changed=fn;}}},tabs:{async sendMessage(id,msg){return me;},async query(){return [{id:1}];},onRemoved:{addListener(){}}},action:{async setBadgeText(v){badges.push(v);},async setBadgeBackgroundColor(){}}};
 const c=vm.createContext({chrome,URL,Date,Map,Set,Promise,console});for(const f of ['removal-model.js','removal-store.js','removal-broker.js'])vm.runInContext(fs.readFileSync('extension/'+f,'utf8'),c);
 const sender={id:'extension',frameId:0,tab:{id:1},url:'https://www.reddit.com/r/Alpha/comments/post1/title/'},popup={id:'extension',url:'chrome-extension://extension/popup.html'};
 const send=(message,from=sender)=>new Promise(resolve=>{if(listener({scope:'rt-removal',...message},from,resolve)!==true)resolve(undefined);});return {send,popup,values,badges,setMe:v=>me=v,changed};
}
const rec=(state,time)=>({fullname:'t3_post1',state,confidence:'verified',flags:[],permalink:'/r/Alpha/comments/post1/title/',checkedAt:time});
test('monitor broker verifies current native account and rejects stale, foreign and subframe reports',async()=>{
 const b=setup(),t=Date.now()-1000;const report={action:'record',owner:'t2_self',username:'Example',records:[rec('visible',t)]};assert.equal((await b.send(report)).ok,true);
 b.setMe({owner:'t2_other',username:'Other'});assert.equal((await b.send(report)).ok,false);
 assert.equal((await b.send(report,{id:'extension',frameId:2,tab:{id:1},url:'https://www.reddit.com/'})).ok,false);
 assert.equal((await b.send(report,{id:'evil',tab:{id:1},url:'https://www.reddit.com/'})).ok,false);
});
test('toolbar unread is tab-scoped; popup history acknowledges only the active account',async()=>{
 const b=setup(),t=Date.now()-1000;for(const [state,time] of [['visible',t],['removed-mod',t+1]])await b.send({action:'record',owner:'t2_self',username:'Example',records:[rec(state,time)]});
 assert.equal(b.badges.at(-1).text,'1');assert.equal(b.badges.at(-1).tabId,1);
 const summary=await b.send({action:'summary',tabId:1},b.popup);assert.equal(summary.value.unread,1);
 assert.equal((await b.send({action:'seen',tabId:1,owner:'t2_self'},b.popup)).value.unread,0);assert.equal(b.badges.at(-1).text,'');
 b.setMe(null);assert.equal((await b.send({action:'summary',tabId:1},b.popup)).ok,false);
});
test('monitoring off blocks records; notifications off leaves toolbar empty',async()=>{
 const b=setup();b.values['rt-settings-v1'].ownRemoval=false;assert.equal((await b.send({action:'record',owner:'t2_self',username:'Example',records:[]})).ok,false);
 await b.changed({'rt-settings-v1':{newValue:b.values['rt-settings-v1']}},'local');assert.equal(b.badges.at(-1).text,'');
});
test('a site page cannot clear history or choose another tab; only the extension popup may do that',async()=>{
 const b=setup();assert.equal((await b.send({action:'clear',tabId:1})).ok,false);assert.equal((await b.send({action:'summary',tabId:999})).ok,false);
 assert.equal((await b.send({action:'clear',tabId:1,owner:'t2_self'},b.popup)).ok,true);
});
test('popup acknowledgement and clear cannot affect an account other than the one displayed',async()=>{
 const b=setup();b.setMe({owner:'t2_other',username:'Other'});for(const action of ['seen','clear'])assert.equal((await b.send({action,tabId:1,owner:'t2_self'},b.popup)).ok,false);
});
