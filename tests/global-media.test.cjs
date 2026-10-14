const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function environment(){const context=vm.createContext({TextEncoder,URL});for(const file of ['search-core.js','message-store.js'])vm.runInContext(fs.readFileSync(`extension/${file}`,'utf8'),context);return context;}
const owner='@alice:reddit.com',sender='@bob:reddit.com',room='!media:reddit.com';
const event=(id,msgtype,body='',info)=>({event_id:id,room_id:room,type:'m.room.message',sender,origin_server_ts:1000,content:{msgtype,body,...(info?{info}:{})}});
const ids=result=>Array.from(result.records,record=>record.id).sort();

test('media filters classify native types and GIF MIME without guessing filenames or URLs',async()=>{
  const {RCSMessageStore:{Store},RCSCore:C}=environment(),store=new Store({indexedDB:null});
  await store.ingest({owner,events:[event('photo','m.image'),event('gif','m.image','animation',{mimetype:'image/gif'}),event('video','m.video'),event('audio','m.audio'),event('file','m.file'),event('fake','m.text','clip.mp4 song.mp3 picture.gif'),event('link','m.text','https://example.com/photo.gif'),event('gif-file','m.file','picture.gif',{mimetype:'image/gif'}),{...event('sticker','m.text'),type:'m.sticker'}]});
  for(const [kind,expected]of [['image',['gif','photo','sticker']],['gif',['gif']],['video',['video']],['audio',['audio']],['file',['file','gif-file']],['link',['link']]]){
    assert.deepEqual(ids(await store.search(owner,{query:`has:${kind}`})),expected);
    assert.deepEqual(ids(await store.search(owner,{query:`has:${kind}s`})),expected,'plural aliases use the same predicate');
  }
  assert.deepEqual(ids(await store.search(owner,{query:'has:image has:gif'})),['gif']);
  assert.equal((await store.search(owner,{query:'has:video has:audio'})).total,0);
  assert.equal((await store.search(sender,{query:'has:gif'})).total,0);
  for(const [kind,flag]of [['link','hasLink'],['image','hasImage'],['file','hasFile'],['video','hasVideo'],['audio','hasAudio'],['gif','hasGif']])assert.equal(C.parseQuery(`has:${kind}`)[flag],true);
  assert.equal(C.parseQuery('has:unsupported').invalid,true);
  const saved=[...store.memory.values()][0];
  assert.equal(saved.events.find(item=>item.id==='gif').attachmentMime,'image/gif');
  assert.equal(saved.events.find(item=>item.id==='video').body,'Video');
  assert.equal(saved.events.find(item=>item.id==='audio').body,'Audio');
  assert.equal(saved.events.find(item=>item.id==='file').body,'File');
});

test('edits replace media metadata and redactions erase it without native replay resurrection',async()=>{
  const {RCSMessageStore:{Store}}=environment(),store=new Store({indexedDB:null}),original=event('base','m.image','secret',{mimetype:'image/gif'});
  await store.ingest({owner,events:[original]});
  const edit={...event('edit','m.text','* changed'),content:{body:'* changed','m.new_content':{body:'',msgtype:'m.video',info:{mimetype:'video/mp4'}},'m.relates_to':{rel_type:'m.replace',event_id:'base'}}};
  await store.ingest({owner,events:[edit]});
  assert.equal((await store.search(owner,{query:'has:gif'})).total,0);
  const result=await store.search(owner,{query:'has:video'});
  assert.deepEqual(ids(result),['base']);assert.equal(result.records[0].text,'Video');assert.equal(result.records[0].attachmentMime,'video/mp4');
  await store.ingest({owner,events:[{...event('remove','m.text'),type:'m.room.redaction',redacts:'base'}]});
  assert.equal((await store.search(owner,{})).total,0);
  const tombstones=[...store.memory.values()][0].events.filter(item=>['base','edit'].includes(item.id));
  for(const item of tombstones){assert.equal(item.body,'');assert.equal(item.attachmentType,'');assert.equal(item.attachmentMime,'');}
  assert.equal((await store.ingest({owner,events:[original,edit]})).changed,false);
  assert.equal(JSON.stringify(await store.snapshot(owner)).includes('secret'),false);
});

test('native replay backfills MIME and empty-body attachments without schema or completeness changes',async()=>{
  const {RCSMessageStore:{Store}}=environment(),store=new Store({indexedDB:null}),gif=event('gif','m.image','',{mimetype:'image/gif',url:'private'}),coverage={complete:true,dateComplete:true};
  await store.ingest({owner,roomId:room,events:[gif],coverage});
  const saved=[...store.memory.values()][0];delete saved.events[0].attachmentMime;saved.events[0].body='';saved.records=[];
  assert.equal((await store.search(owner,{query:'has:gif'})).total,0);
  assert.equal((await store.ingest({owner,roomId:room,events:[gif],coverage})).changed,true);
  assert.deepEqual(ids(await store.search(owner,{query:'has:gif'})),['gif']);
  assert.equal((await store.search(owner,{roomId:room})).coverage.complete,true);
  assert.equal((await store.ingest({owner,roomId:room,events:[gif],coverage})).changed,false);
  assert.equal(JSON.stringify(saved.events).includes('private'),false,'retain only minimal classification metadata');
});

test('available media types come from materialized account data independently of filters and pagination',async()=>{
  const {RCSMessageStore:{Store}}=environment(),store=new Store({indexedDB:null});
  await store.ingest({owner,events:[event('gif','m.image','animation',{mimetype:'image/gif'}),event('audio','m.audio','song'),{...event('file','m.file','doc'),room_id:'!other:reddit.com'},event('link','m.text','www.example.com')]});
  const result=await store.search(owner,{query:'missing from:me',roomIds:[],limit:1});
  assert.equal(result.total,0);
  assert.deepEqual(Array.from(result.availableMediaTypes),['image','gif','audio','file','link']);
  assert.deepEqual(Array.from((await store.search(sender,{})).availableMediaTypes),[]);
  await store.ingest({owner,events:[{...event('edit','m.text'),content:{'m.new_content':{body:'plain text',msgtype:'m.text'},'m.relates_to':{rel_type:'m.replace',event_id:'gif'}}},{...event('redaction','m.text'),type:'m.room.redaction',redacts:'audio'}]});
  assert.deepEqual(Array.from((await store.search(owner,{})).availableMediaTypes),['file','link']);
});

test('image preview references are bounded and credential-free, update on replay/edits, and disappear on redaction',async()=>{
  const {RCSMessageStore:{Store}}=environment(),store=new Store({indexedDB:null}),photo=event('photo','m.image','photo.jpeg');
  await store.ingest({owner,events:[photo]});assert.equal((await store.search(owner,{query:'has:image'})).records[0].attachmentPreview,'');
  photo.content.url='https://example.invalid/original.jpg';photo.content.info={thumbnail_url:'https://example.invalid/thumb.jpg'};
  assert.equal((await store.ingest({owner,events:[photo]})).changed,true);assert.equal((await store.ingest({owner,events:[photo]})).changed,false);
  assert.equal((await store.search(owner,{query:'has:image'})).records[0].attachmentPreview,'https://example.invalid/original.jpg');
  assert.equal((await store.summaries(owner)).summaries[0].attachmentPreview,'https://example.invalid/original.jpg');
  const rejected=['http://example.invalid/img','data:image/png,abc','javascript:alert(1)','https://user:secret@example.invalid/img','https://example.invalid/img?access_token=secret','https://example.invalid/img?X-Amz-Signature=secret','https://example.invalid/img#secret'];
  for(const [i,url]of rejected.entries())await store.ingest({owner,events:[{...event('bad-'+i,'m.image','picture.jpeg'),content:{msgtype:'m.image',body:'picture.jpeg',url}}]});
  assert.ok((await store.search(owner,{query:'picture'})).records.every(record=>!record.attachmentPreview));assert.equal(JSON.stringify(await store.snapshot(owner)).includes('secret'),false);
  await store.ingest({owner,events:[{...event('edit','m.image','* replaced'),content:{'m.relates_to':{rel_type:'m.replace',event_id:'photo'},'m.new_content':{msgtype:'m.image',body:'new.jpeg',url:'https://example.invalid/new.jpg'}}}]});
  assert.equal((await store.search(owner,{query:'new.jpeg'})).records[0].attachmentPreview,'https://example.invalid/new.jpg');
  await store.ingest({owner,events:[{...event('redact','m.text'),type:'m.room.redaction',redacts:'photo'}]});
  const ledger=(await store.snapshot(owner)).rows[0].events;assert.ok(ledger.filter(record=>['photo','edit'].includes(record.id)).every(record=>record.attachmentPreview===''));
});

test('image compaction falls back to a safe thumbnail when the original is not usable',()=>{
  const {RCSMessageStore:{compact}}=environment();
  for(const url of ['mxc://reddit.com/original','https://example.invalid/photo?access_token=secret']){
    const raw=event('fallback','m.image','photo.jpeg');raw.content.url=url;raw.content.info={thumbnail_url:'https://example.invalid/safe-thumbnail'};
    assert.equal(compact(raw).attachmentPreview,'https://example.invalid/safe-thumbnail');
    raw.content.rcs_preview_url='https://example.invalid/native-conversion';assert.equal(compact(raw).attachmentPreview,'https://example.invalid/native-conversion');
  }
});

test('image layout hints persist through replay, edits and redactions with bounded metadata',async()=>{
  const {RCSMessageStore:{Store,compact}}=environment(),store=new Store({indexedDB:null}),photo=event('portrait','m.image','portrait.jpeg');
  await store.ingest({owner,events:[photo]});photo.content.info={w:1200,h:1600};
  assert.equal((await store.ingest({owner,events:[photo]})).changed,true);assert.equal((await store.ingest({owner,events:[photo]})).changed,false);
  const image=(await store.search(owner,{query:'portrait.jpeg'})).records[0];assert.equal(image.attachmentWidth,1200);assert.equal(image.attachmentHeight,1600);assert.equal((await store.summaries(owner)).summaries[0].attachmentHeight,1600);
  await store.ingest({owner,events:[{...event('edit-aspect','m.image','* landscape'),content:{'m.relates_to':{rel_type:'m.replace',event_id:'portrait'},'m.new_content':{msgtype:'m.image',body:'landscape.jpeg',info:{width:1600,height:900}}}}]});
  assert.equal((await store.search(owner,{query:'landscape.jpeg'})).records[0].attachmentHeight,900);
  await store.ingest({owner,events:[{...event('redact-aspect','m.text'),type:'m.room.redaction',redacts:'portrait'}]});assert.ok((await store.snapshot(owner)).rows[0].events.filter(e=>['portrait','edit-aspect'].includes(e.id)).every(e=>!e.attachmentWidth && !e.attachmentHeight));
  for(const info of [{w:10},{w:0,h:10},{w:NaN,h:20},{w:100001,h:10},{w:'100',h:50}]){photo.content.info=info;assert.equal(compact(photo).attachmentWidth,undefined);}
});

test('decoded image hints update only the current attachment and preserve content and coverage',async()=>{
  const {RCSMessageStore:{Store}}=environment(),store=new Store({indexedDB:null}),photo=event('learn','m.image','image.jpeg');photo.content.url='https://example.invalid/original';photo.content.info={w:100,h:100};
  await store.ingest({owner,roomId:room,events:[photo],coverage:{complete:true}});
  const patch={roomId:room,eventId:'learn',preview:photo.content.url,width:400,height:800},save=records=>store.rememberDimensions({owner,records});
  assert.equal((await save([patch])).changed,true);assert.equal((await save([patch])).changed,false);
  await store.ingest({owner,roomId:room,events:[photo],coverage:{complete:true}});let found=await store.room(owner,room);assert.equal(found.records[0].attachmentWidth,400);assert.equal(found.coverage.complete,true);assert.equal(found.records[0].text,'image.jpeg');
  const edited={...event('edit-learn','m.image','* edit'),content:{'m.relates_to':{rel_type:'m.replace',event_id:'learn'},'m.new_content':{msgtype:'m.image',body:'edited.jpeg',url:'https://example.invalid/edited',info:{w:800,h:400}}}};
  await store.ingest({owner,events:[edited]});assert.equal((await save([patch])).changed,false,'ignore an image load from before an edit');assert.equal((await store.room(owner,room)).records[0].attachmentWidth,800);
  assert.equal((await store.rememberDimensions({owner:sender,records:[{...patch,preview:'https://example.invalid/edited'}]})).changed,false,'account-isolated records');
  for(const width of [0,Infinity,100001])await assert.rejects(save([{...patch,width}]),/Invalid image dimensions/);
  await store.ingest({owner,events:[{...event('redact-learn','m.text'),type:'m.room.redaction',redacts:'learn'}]});assert.equal((await save([{...patch,preview:'https://example.invalid/edited'}])).changed,false);assert.equal((await store.room(owner,room)).records.length,0);
});
