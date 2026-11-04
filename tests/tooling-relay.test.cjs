const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const load=()=>import('../scripts/live/relay-guard.mjs');
const req=(headers)=>({headers});

test('relay accepts only token-bearing, origin-free requests addressed to 127.0.0.1:<port>',async()=>{
  const {newToken,checkRequest,parseCommand}=await load(),token=newToken(),port=9333,ok={host:'127.0.0.1:9333','x-relay-token':token};
  assert.match(token,/^[0-9a-f]{48}$/);assert.notEqual(newToken(),token);
  assert.equal(checkRequest(req(ok),{token,port}),null);
  assert.equal(checkRequest(req({...ok,origin:'https://evil.test'}),{token,port})[0],403);
  assert.equal(checkRequest(req({...ok,origin:'null'}),{token,port})[0],403);
  assert.equal(checkRequest(req({...ok,host:'evil.test:9333'}),{token,port})[0],403);
  assert.equal(checkRequest(req({...ok,host:'localhost:9333'}),{token,port})[0],403);
  assert.equal(checkRequest(req({host:ok.host}),{token,port})[0],401);
  assert.equal(checkRequest(req({...ok,'x-relay-token':'x'.repeat(48)}),{token,port})[0],401);
  assert.equal(parseCommand('{bad'),null);assert.equal(parseCommand('[]'),null);assert.deepEqual(parseCommand('{"method":"A"}'),{method:'A'});assert.deepEqual(parseCommand(''),{});
});

test('relay and cdp client wire the token, idle exit and safe JSON parsing',()=>{
  const relay=fs.readFileSync(path.join(__dirname,'../scripts/live/relay.mjs'),'utf8'),cdp=fs.readFileSync(path.join(__dirname,'../scripts/live/cdp.mjs'),'utf8');
  assert.match(relay,/checkRequest\(req/);assert.match(relay,/IDLE_MS=15\*60\*1000/);assert.doesNotMatch(relay,/JSON\.parse\(body/);assert.match(relay,/relay token:/);
  assert.match(cdp,/RELAY_TOKEN/);assert.match(cdp,/x-relay-token/);assert.match(cdp,/live-probe/);
});

test('preview serves only demo and extension; measure-cache resolves paths from its own folder; manifest pins Chrome 111',()=>{
  const pkg=JSON.parse(fs.readFileSync(path.join(__dirname,'../package.json'),'utf8'));
  assert.match(pkg.scripts.preview,/preview-server\.py/);assert.doesNotMatch(pkg.scripts.preview,/http\.server/);
  const server=fs.readFileSync(path.join(__dirname,'../scripts/preview-server.py'),'utf8');assert.match(server,/ALLOWED = \('\/demo\/', '\/extension\/'\)/);
  const measure=fs.readFileSync(path.join(__dirname,'../scripts/measure-cache.cjs'),'utf8');assert.match(measure,/__dirname/);assert.doesNotMatch(measure,/`extension\//);
  assert.equal(JSON.parse(fs.readFileSync(path.join(__dirname,'../extension/manifest.json'),'utf8')).minimum_chrome_version,'111');
});

test('relay port is configurable and each port gets its own token file',async()=>{
  const {relayPort,tokenPath}=await load();
  assert.equal(relayPort({}),9333);assert.equal(relayPort({RELAY_PORT:'9334'}),9334);
  for(const bad of ['80','70000','9333x','','-1'])assert.throws(()=>relayPort({RELAY_PORT:bad}),/RELAY_PORT/);
  assert.match(tokenPath(9333,'/r'),/artifacts\/research\/live-probe\/relay-token$/);
  assert.match(tokenPath(9334,'/r'),/artifacts\/research\/live-probe\/relay-token-9334$/);
  const relay=fs.readFileSync(path.join(__dirname,'../scripts/live/relay.mjs'),'utf8'),cdp=fs.readFileSync(path.join(__dirname,'../scripts/live/cdp.mjs'),'utf8');
  assert.match(relay,/PORT=relayPort\(\)/);assert.match(relay,/tokenPath\(PORT\)/);assert.match(cdp,/relayPort\(\)/);assert.doesNotMatch(cdp,/9333\//);
});
