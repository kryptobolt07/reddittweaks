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
  function render(source,doc=globalThis.document,paragraphReplacement=null){
    const fragment=doc.createDocumentFragment(),lines=decode(String(source || '')).replace(/\r\n?/g,'\n').split('\n');
    let i=0;const paragraph=[];
    const flush=()=>{if(!paragraph.length)return;const replacement=paragraphReplacement?.(paragraph.join('\n').trim());if(replacement)fragment.append(replacement);else{const p=doc.createElement('p');paragraph.forEach((line,index)=>{if(index)p.append(doc.createElement('br'));p.append(inline(line.trim(),doc));});fragment.append(p);}paragraph.length=0;};
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
  // Rebuild archive-rendered HTML from an allowlist. The source document is
  // inert (DOMParser runs no scripts and loads nothing); only text and
  // formatting elements are recreated in the page document.
  const keep=new Set(['P','BR','HR','STRONG','EM','DEL','CODE','PRE','BLOCKQUOTE','UL','OL','LI','H1','H2','H3','H4','H5','H6','SUP','SUB','TABLE','THEAD','TBODY','TR','TH','TD']),rename={B:'STRONG',I:'EM',S:'DEL',STRIKE:'DEL'},drop=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','IMG','VIDEO','AUDIO','SVG','MATH','FORM','INPUT','BUTTON','TEXTAREA','SELECT','LINK','META','TEMPLATE','NOSCRIPT']);
  function fromHtml(html,doc=globalThis.document){
    if(typeof html!=='string' || !html || html.length>120000 || typeof DOMParser!=='function')return null;
    const source=new DOMParser().parseFromString(html,'text/html').body,fragment=doc.createDocumentFragment();let budget=5000;
    const copy=(from,to,depth)=>{
      for(const node of from.childNodes){
        if(--budget<0)return;
        // Markdown backslash escapes that the archive renderer leaves in text (e.g. \+).
        if(node.nodeType===3){to.append(doc.createTextNode(node.parentElement?.closest('code,pre')?node.textContent:node.textContent.replace(/\\([\\`*_{}\[\]()#+\-.!|~>^])/g,'$1')));continue;}
        if(node.nodeType!==1)continue;
        const tag=rename[node.tagName] || node.tagName;
        if(drop.has(tag))continue;
        if(depth>40){to.append(doc.createTextNode(node.textContent));continue;}
        let el=null;
        if(keep.has(tag)){el=doc.createElement(tag.toLowerCase());if((tag==='TH' || tag==='TD') && ['left','center','right'].includes(node.getAttribute('align')))el.style.textAlign=node.getAttribute('align');}
        else if(tag==='A'){const href=safeHref(node.getAttribute('href') || '');if(href){el=doc.createElement('a');el.href=href;el.rel='noopener noreferrer nofollow';}}
        else if(tag==='SPAN' && node.classList.contains('md-spoiler-text')){el=doc.createElement('span');el.className='rt-spoiler';el.tabIndex=0;}
        if(el){copy(node,el,depth+1);to.append(el);}else copy(node,to,depth+1); // unknown wrappers (div.md, span) unwrap to their text
      }
    };
    copy(source,fragment,0);
    return fragment.childNodes.length?fragment:null;
  }
  // Comment attachments are shown only when validated metadata names a body
  // reference. Replace a media-only paragraph, while keeping ordinary links.
  function renderComment(text,html,media,{restricted=false,doc=globalThis.document}={}){
    const images=restricted?[]:(Array.isArray(media)?media:[]).filter(item=>item?.kind==='image' && globalThis.RTPostModel?.mediaUrl(item.url)).slice(0,20);
    if(!images.length)return fromHtml(html,doc) || render(text,doc);
    return render(text,doc,raw=>{
      const marker=raw.match(/^!\[[^\]\n]*\]\(([^)\s]+)\)$/),reference=marker?marker[1]:raw,direct=globalThis.RTPostModel.mediaUrl(reference);
      const id=direct?new URL(direct).pathname.split('/').pop().replace(/\.[^.]+$/,''):marker?reference:'';
      const item=images.find(candidate=>new URL(globalThis.RTPostModel.mediaUrl(candidate.url)).pathname.split('/').pop().replace(/\.[^.]+$/,'')===id);
      if(!item)return null;
      const url=globalThis.RTPostModel.mediaUrl(item.url);
      const figure=doc.createElement('div');figure.className='rt-comment-media';
      const img=doc.createElement('img');img.src=url;img.alt='Comment image';img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';
      img.style.cssText='max-width: 100%; max-height: 512px; width: auto; height: auto; border-radius: 8px; object-fit: contain;';
      if(item.width && item.height){img.width=item.width;img.height=item.height;}figure.append(img);return figure;
    });
  }
  globalThis.RTMarkdown=Object.freeze({render,decode,fromHtml,renderComment});
})();
