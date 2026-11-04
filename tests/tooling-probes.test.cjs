const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');

test('png tools round-trip pixels and report changes outside the intended area',async()=>{
  const {decodePng,encodePng,diffPng}=await import('../scripts/live/png.mjs');
  const width=40,height=20,data=Buffer.alloc(width*height*4);
  for(let i=0;i<data.length;i+=4){data[i]=(i/4)%256;data[i+1]=40;data[i+2]=200;data[i+3]=255;}
  const a=decodePng(encodePng({width,height,data}));assert.equal(a.width,width);assert.deepEqual(a.data,data);
  const b={...a,data:Buffer.from(a.data)};for(let y=2;y<6;y++)for(let x=2;x<12;x++)b.data[(y*width+x)*4+1]=255;
  const d=diffPng(a,b,{masks:[{x:2,y:2,width:5,height:4}]});
  assert.equal(d.changed,40);assert.deepEqual(d.changedBox,{x:2,y:2,width:10,height:4});
  assert.equal(d.outsideMask,20);assert.deepEqual(d.outsideBox,{x:7,y:2,width:5,height:4});
  assert.equal(diffPng(a,{width:1,height:1,data:Buffer.alloc(4)}).sizeMismatch,'40x20 vs 1x1');
  assert.throws(()=>decodePng(Buffer.from('nope')),/not a PNG/);
});

test('probe tools share the port-aware relay client and parse options',async()=>{
  const {parseArgs,PAGE_HELPERS}=await import('../scripts/live/relay-client.mjs');
  assert.deepEqual(parseArgs(['s','.root','--max','5','--console']),{positional:['s','.root'],options:{max:'5',console:true}});
  assert.match(PAGE_HELPERS,/shadowRoot/);
  for(const name of ['probe-inventory','probe-shot','probe-timeline','probe-ui','probe-sheet']){
    const source=fs.readFileSync(path.join(__dirname,'../scripts/live',name+'.mjs'),'utf8');
    assert.match(source,/from '\.\/relay-client\.mjs'/,name);assert.doesNotMatch(source,/9333|relay-token/,name);
  }
});

test('fixture browser uses a throwaway profile, its own relay port and no background throttling',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../scripts/live/fixture-browser.mjs'),'utf8');
  assert.match(source,/9333 is reserved/);assert.match(source,/mkdtempSync\(path\.join\(ROOT,'artifacts','research','fixture-profile-'\)\)/);
  assert.match(source,/rmSync\(profile/);assert.match(source,/RELAY_PORT:port/);
  for(const flag of ['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--remote-debugging-port=0'])assert.ok(source.includes(flag),flag);
});
