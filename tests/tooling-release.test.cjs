const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process'),repo=path.join(__dirname,'..');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'rt-release-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.cpSync(path.join(repo,'extension'),path.join(root,'extension'),{recursive:true});
 const version=JSON.parse(fs.readFileSync(path.join(root,'extension/manifest.json'))).version;
 fs.writeFileSync(path.join(root,'CHANGELOG.md'),`# ${version} preview\n\nCurrent release notes.\n\n# 0.0.1\n\nOlder notes.\n`);
 const built=spawnSync('python3',[path.join(repo,'scripts/package.py'),'--root',root],{encoding:'utf8'});assert.equal(built.status,0,built.stderr);
 return {root,version,zip:path.join(root,'artifacts',`reddit-tweaks-v${version}.zip`),verify(...args){return spawnSync('python3',['-I',path.join(repo,'scripts/verify-package.py'),'--root',root,...args],{encoding:'utf8'});}};
}
test('release verifier checks the real package and emits its checksum, exact notes and workflow outputs',t=>{
 const s=fixture(t),output=path.join(s.root,'job-output'),r=s.verify('--tag','v'+s.version,'--github-output',output);assert.equal(r.status,0,r.stderr);
 const hash=crypto.createHash('sha256').update(fs.readFileSync(s.zip)).digest('hex');assert.equal(fs.readFileSync(s.zip+'.sha256','utf8'),`${hash}  ${path.basename(s.zip)}\n`);
 const notes=fs.readFileSync(path.join(s.root,'artifacts/release-notes.md'),'utf8');assert.match(notes,/Current release notes/);assert.doesNotMatch(notes,/Older notes/);
 assert.equal(fs.readFileSync(output,'utf8'),`version=${s.version}\nprerelease=true\n`);
});
test('release verifier rejects a mismatched tag or missing current release notes',t=>{
 const s=fixture(t);let r=s.verify('--tag','v9.9.9');assert.notEqual(r.status,0);assert.match(r.stderr,/tag.*manifest/i);
 fs.writeFileSync(path.join(s.root,'CHANGELOG.md'),'# 0.0.1\n\nOlder notes.\n');r=s.verify();assert.notEqual(r.status,0);assert.match(r.stderr,/CHANGELOG/);
});
test('release verifier rejects changed and extra unpacked files',t=>{
 const s=fixture(t),popup=path.join(s.root,'artifacts/reddit-chat-search/popup.js'),original=fs.readFileSync(popup);fs.appendFileSync(popup,'\n// stale export');let r=s.verify();assert.notEqual(r.status,0);assert.match(r.stderr,/popup.js/);
 fs.writeFileSync(popup,original);fs.writeFileSync(path.join(s.root,'artifacts/reddit-chat-search/private.json'),'{}');r=s.verify();assert.notEqual(r.status,0);assert.match(r.stderr,/unpacked.*membership/i);
});
test('release verifier rejects corrupted archives and differing ZIP bytes',t=>{
 const s=fixture(t),original=fs.readFileSync(s.zip);fs.writeFileSync(s.zip,'broken archive');let r=s.verify();assert.notEqual(r.status,0);assert.match(r.stderr,/ZIP/i);assert.doesNotMatch(r.stderr,/Traceback/);
 fs.writeFileSync(s.zip,original);const changed=spawnSync('python3',['-c','import sys,zipfile\np=sys.argv[1]\nwith zipfile.ZipFile(p) as z: items=[(i,z.read(i)) for i in z.infolist()]\nwith zipfile.ZipFile(p,"w") as z:\n for i,b in items: z.writestr(i,b+b"\\n// changed" if i.filename=="popup.js" else b)',s.zip],{encoding:'utf8'});assert.equal(changed.status,0,changed.stderr);r=s.verify();assert.notEqual(r.status,0);assert.match(r.stderr,/popup.js/);
});
test('release verifier rejects additional ZIP members',t=>{
 const s=fixture(t);const changed=spawnSync('python3',['-c','import sys,zipfile\nwith zipfile.ZipFile(sys.argv[1],"a") as z: z.writestr("private.json","{}")',s.zip]);assert.equal(changed.status,0);const r=s.verify();assert.notEqual(r.status,0);assert.match(r.stderr,/ZIP.*membership/i);
});
