/* Minimal, safe Reddit-markdown renderer for archived text. Builds DOM nodes
   only (never innerHTML). Links must be http(s) or Reddit-relative. */
(() => {
  'use strict';
  if(globalThis.RTMarkdown)return;
  const entities={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&#39;':"'",'&#x27;':"'",'&nbsp;':' ','&#x200B;':'','&#x200b;':''};
  const decode=text=>text.replace(/&(?:amp|lt|gt|quot|nbsp|#39|#x27|#x200[Bb]);/g,match=>entities[match] ?? match);
  function safeHref(value){
    const raw=value.trim();
    if(/^\/?(?:r|u|user)\//i.test(raw))return new URL(raw.startsWith('/')?raw:'/'+raw,'https://www.reddit.com').href;
    try{const url=new URL(raw);return ['http:','https:'].includes(url.protocol) && !url.username && !url.password?url.href:'';}catch{return '';}
  }
  // Inline: [text](url), bare URLs, r/ and u/ mentions, **bold**, *italic* / _italic_, ~~strike~~, `code`.
  const inlinePattern=/\[([^\]\n]{1,500})\]\(([^)\s]{1,2000})\)|(https?:\/\/[^\s<>()]{1,2000})|(^|[\s(])(\/?(?:r|u)\/[A-Za-z0-9_-]{2,21})|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|`([^`\n]+)`|\*([^*\n]+)\*|(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?])/g;
  function inline(text,doc){
    const fragment=doc.createDocumentFragment();let last=0;
    for(const m of text.matchAll(inlinePattern)){
      let start=m.index,prefix='';
      if(m[4]!==undefined || m[11]!==undefined){prefix=m[4] ?? m[11];start+=prefix.length;}
      if(start>last || prefix)fragment.append(text.slice(last,start));
      const link=(label,href)=>{const url=safeHref(href);if(!url)return doc.createTextNode(label);const a=doc.createElement('a');a.href=url;a.rel='noopener noreferrer nofollow';a.textContent=label;return a;};
      if(m[1]!==undefined)fragment.append(link(m[1],m[2]));
      else if(m[3]!==undefined)fragment.append(link(m[3],m[3]));
      else if(m[5]!==undefined)fragment.append(link(m[5],m[5]));
      else{const [tag,value]=m[6]!==undefined?['strong',m[6]]:m[7]!==undefined?['strong',m[7]]:m[8]!==undefined?['del',m[8]]:m[9]!==undefined?['code',m[9]]:m[10]!==undefined?['em',m[10]]:['em',m[12]];const el=doc.createElement(tag);if(tag==='code')el.textContent=value;else el.append(inline(value,doc));fragment.append(el);}
      last=m.index+m[0].length;
    }
    if(last<text.length)fragment.append(text.slice(last));
    return fragment;
  }
  function render(source,doc=globalThis.document){
    const fragment=doc.createDocumentFragment(),lines=decode(String(source || '')).replace(/\r\n?/g,'\n').split('\n');
    let i=0;const paragraph=[];
    const flush=()=>{if(!paragraph.length)return;const p=doc.createElement('p');paragraph.forEach((line,index)=>{if(index)p.append(doc.createElement('br'));p.append(inline(line.trim(),doc));});fragment.append(p);paragraph.length=0;};
    while(i<lines.length){
      const line=lines[i];
      if(/^\s*```/.test(line)){flush();const code=[];i++;while(i<lines.length && !/^\s*```/.test(lines[i]))code.push(lines[i++]);i++;const pre=doc.createElement('pre'),c=doc.createElement('code');c.textContent=code.join('\n');pre.append(c);fragment.append(pre);continue;}
      if(!line.trim()){flush();i++;continue;}
      const heading=line.match(/^\s{0,3}#{1,6}\s+(.*)$/);if(heading){flush();const p=doc.createElement('p'),strong=doc.createElement('strong');strong.append(inline(heading[1],doc));p.append(strong);fragment.append(p);i++;continue;}
      if(/^\s*>/.test(line)){flush();const quote=[];while(i<lines.length && /^\s*>/.test(lines[i]))quote.push(lines[i++].replace(/^\s*>\s?/,''));const block=doc.createElement('blockquote');block.append(render(quote.join('\n'),doc));fragment.append(block);continue;}
      const bullet=/^\s*[-*+]\s+(.*)$/,number=/^\s*\d{1,3}[.)]\s+(.*)$/;
      if(bullet.test(line) || number.test(line)){flush();const ordered=number.test(line),pattern=ordered?number:bullet,list=doc.createElement(ordered?'ol':'ul');while(i<lines.length && pattern.test(lines[i])){const li=doc.createElement('li');li.append(inline(lines[i].match(pattern)[1],doc));list.append(li);i++;}fragment.append(list);continue;}
      if(/^\s*(?:[-*_]\s*){3,}$/.test(line)){flush();fragment.append(doc.createElement('hr'));i++;continue;}
      paragraph.push(line);i++;
    }
    flush();
    return fragment;
  }
  globalThis.RTMarkdown=Object.freeze({render,decode});
})();
