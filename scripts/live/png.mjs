// Minimal dependency-free PNG decode/encode and pixel diff (8-bit RGB/RGBA, non-interlaced: what Chrome screenshots produce).
import zlib from 'node:zlib';
const SIG=Buffer.from([137,80,78,71,13,10,26,10]);
export function decodePng(buf){
  if(!buf.subarray(0,8).equals(SIG))throw Error('not a PNG');
  let off=8,width=0,height=0,type=0,depth=0,interlace=0;const idat=[];
  while(off<buf.length){const len=buf.readUInt32BE(off),kind=buf.toString('ascii',off+4,off+8),data=buf.subarray(off+8,off+8+len);off+=12+len;
    if(kind==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);depth=data[8];type=data[9];interlace=data[12];}
    else if(kind==='IDAT')idat.push(data);else if(kind==='IEND')break;}
  if(depth!==8 || ![2,6].includes(type) || interlace)throw Error(`unsupported PNG (depth ${depth}, colour type ${type}, interlace ${interlace})`);
  const bpp=type===6?4:3,stride=width*bpp,raw=zlib.inflateSync(Buffer.concat(idat)),px=Buffer.alloc(width*height*4);let prev=Buffer.alloc(stride);
  for(let y=0;y<height;y++){const f=raw[y*(stride+1)],line=Buffer.from(raw.subarray(y*(stride+1)+1,(y+1)*(stride+1)));
    for(let x=0;x<stride;x++){const a=x>=bpp?line[x-bpp]:0,b=prev[x],c=x>=bpp?prev[x-bpp]:0;let v=line[x];
      if(f===1)v+=a;else if(f===2)v+=b;else if(f===3)v+=(a+b)>>1;else if(f===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);v+=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
      line[x]=v&255;}
    for(let x=0;x<width;x++){const i=(y*width+x)*4,j=x*bpp;px[i]=line[j];px[i+1]=line[j+1];px[i+2]=line[j+2];px[i+3]=bpp===4?line[j+3]:255;}
    prev=line;}
  return {width,height,data:px};
}
const chunk=(kind,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const body=Buffer.concat([Buffer.from(kind,'ascii'),data]);const crc=Buffer.alloc(4);crc.writeUInt32BE(zlib.crc32(body)>>>0);return Buffer.concat([len,body,crc]);};
export function encodePng({width,height,data}){
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=6;
  const raw=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)data.copy(raw,y*(width*4+1)+1,y*width*4,(y+1)*width*4);
  return Buffer.concat([SIG,chunk('IHDR',ihdr),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
// masks: [{x,y,width,height}] = areas where change is intended. Returns counts, bounding boxes and a highlight image.
export function diffPng(a,b,{threshold=16,masks=[]}={}){
  if(a.width!==b.width || a.height!==b.height)return {sizeMismatch:`${a.width}x${a.height} vs ${b.width}x${b.height}`};
  const {width,height}=a,out=Buffer.alloc(width*height*4),box=()=>({x0:Infinity,y0:Infinity,x1:-1,y1:-1}),all=box(),outside=box();let changed=0,outsideCount=0;
  const inMask=(x,y)=>masks.some(m=>x>=m.x&&y>=m.y&&x<m.x+m.width&&y<m.y+m.height);
  const grow=(bx,x,y)=>{bx.x0=Math.min(bx.x0,x);bx.y0=Math.min(bx.y0,y);bx.x1=Math.max(bx.x1,x);bx.y1=Math.max(bx.y1,y);};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4,d=Math.max(Math.abs(a.data[i]-b.data[i]),Math.abs(a.data[i+1]-b.data[i+1]),Math.abs(a.data[i+2]-b.data[i+2]));
    if(d>threshold){changed++;grow(all,x,y);const masked=inMask(x,y);if(!masked){outsideCount++;grow(outside,x,y);}out[i]=masked?255:220;out[i+1]=masked?160:0;out[i+2]=0;out[i+3]=255;}
    else{const g=Math.round((b.data[i]+b.data[i+1]+b.data[i+2])/3*0.35+165);out[i]=out[i+1]=out[i+2]=g;out[i+3]=255;}}
  const fmt=bx=>bx.x1<0?null:{x:bx.x0,y:bx.y0,width:bx.x1-bx.x0+1,height:bx.y1-bx.y0+1};
  return {width,height,changed,ratio:+(changed/(width*height)).toFixed(5),changedBox:fmt(all),outsideMask:outsideCount,outsideBox:fmt(outside),image:{width,height,data:out}};
}
