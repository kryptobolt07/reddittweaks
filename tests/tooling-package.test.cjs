const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const repo=path.join(__dirname,'..');

function tempRoot(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'rt-package-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.cpSync(path.join(repo,'extension'),path.join(root,'extension'),{recursive:true});
  return root;
}
const run=root=>spawnSync('python3',['-I',path.join(repo,'scripts/package.py'),'--root',root],{encoding:'utf8'});
const zipInfo=zip=>JSON.parse(spawnSync('python3',['-I','-c',`import json,sys,zipfile
z=zipfile.ZipFile(sys.argv[1]);print(json.dumps([[i.filename,list(i.date_time),i.external_attr>>16] for i in z.infolist()]))`,zip],{encoding:'utf8'}).stdout);

test('package.py builds a deterministic, allowlisted archive and the stable folder',t=>{
  const root=tempRoot(t),first=run(root);assert.equal(first.status,0,first.stderr);
  const version=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'),'utf8')).version;
  const zip=path.join(root,'artifacts',`reddit-tweaks-v${version}.zip`),before=fs.readFileSync(zip);
  for(const name of ['reddit-tweaks.zip','reddit-chat-search.zip'])assert.deepEqual(fs.readFileSync(path.join(root,'artifacts',name)),before);
  // Rewriting source mtimes must not change the archive.
  const later=new Date(Date.now()+86400000);fs.utimesSync(path.join(root,'extension/popup.js'),later,later);
  assert.equal(run(root).status,0);assert.deepEqual(fs.readFileSync(zip),before);
  const entries=zipInfo(zip),names=entries.map(e=>e[0]);
  assert.deepEqual(names,[...names].sort());
  for(const [,date,mode] of entries){assert.deepEqual(date,[1980,1,1,0,0,0]);assert.equal(mode,0o644);}
  for(const required of ['manifest.json','popup.html','popup.js','popup.css','post-broker.js','icons/logo.svg','icons/logo-small.svg','icons/128.png'])assert.ok(names.includes(required),required);
  // The unpacked folder mirrors the source byte for byte.
  for(const name of names)assert.deepEqual(fs.readFileSync(path.join(root,'artifacts/reddit-chat-search',name)),fs.readFileSync(path.join(root,'extension',name)));
});

test('package.py fails on unexpected files, missing assets and mismatched version_name',t=>{
  let root=tempRoot(t);fs.writeFileSync(path.join(root,'extension/stray-capture.json'),'{}');
  let result=run(root);assert.notEqual(result.status,0);assert.match(result.stderr,/Unexpected files.*stray-capture\.json/);assert.equal(fs.existsSync(path.join(root,'artifacts')),false);
  root=tempRoot(t);fs.rmSync(path.join(root,'extension/popup.css'));
  result=run(root);assert.notEqual(result.status,0);assert.match(result.stderr,/Missing extension asset: popup\.css/);assert.doesNotMatch(result.stderr,/Traceback/);
  root=tempRoot(t);const file=path.join(root,'extension/manifest.json'),manifest=JSON.parse(fs.readFileSync(file,'utf8'));manifest.version_name='9.9.9 preview';fs.writeFileSync(file,JSON.stringify(manifest,null,2));
  result=run(root);assert.notEqual(result.status,0);assert.match(result.stderr,/version_name/);
});
