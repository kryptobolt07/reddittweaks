// Chat startup (docs/chat-startup-spec.md): Reddit's cached conversation read, and holding the list until it settles.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const read=file=>fs.readFileSync('extension/'+file,'utf8');

function page(){
 const dom=new JSDOM('<!doctype html><body></body>',{url:'https://www.reddit.com/chat',runScripts:'outside-only'}),W=dom.window;W.eval(read('chat-cache-read.js'));
 const calls=[];class MatrixClient extends W.HTMLElement{startSync(){this.started=(this.started||0)+1;return this.client.store.getSavedSync({limit:20,cursor:undefined});}}
 const store={getSavedSync(options){calls.push(options===undefined?'none':JSON.parse(JSON.stringify(options)));return Promise.resolve({data:null});}};
 return {W,calls,store,MatrixClient};
}
test('after Reddit’s first cached page (newest 20), the rest of the saved conversations are read 100 at a time',async t=>{
 const {W,calls,store,MatrixClient}=page();t.after(()=>W.close());
 W.customElements.define('rs-matrix-client',MatrixClient);const el=W.document.createElement('rs-matrix-client');el.client={store};W.document.body.append(el);
 await el.startSync();assert.deepEqual(calls[0],{limit:20},'the first page stays Reddit’s 20 newest');
 await el.client.store.getSavedSync({limit:20,cursor:{updated_at:5,room_id:'!a'}});assert.equal(calls[1].limit,100);assert.deepEqual(calls[1].cursor,{updated_at:5,room_id:'!a'});
 await el.client.store.getSavedSync();assert.equal(calls[2],'none','the unpaged full read is untouched');
 await el.client.store.getSavedSync({limit:500,cursor:{}});assert.equal(calls[3].limit,500,'larger pages are never shrunk');
 await el.startSync();await el.client.store.getSavedSync({limit:20,cursor:{}});assert.equal(calls.at(-1).limit,100,'wrapped once, not twice');assert.equal(el.started,2);
});
test('other components and a missing client or store are left alone',async t=>{
 const {W,MatrixClient}=page();t.after(()=>W.close());
 class Other extends W.HTMLElement{startSync(){return 'own';}}W.customElements.define('rs-other',Other);assert.equal(new Other().startSync(),'own');
 W.customElements.define('rs-matrix-client',class extends MatrixClient{startSync(){return 'started';}});const el=W.document.createElement('rs-matrix-client');assert.equal(el.startSync(),'started','no client yet: Reddit runs unchanged');
});
