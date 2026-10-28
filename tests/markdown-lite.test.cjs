const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
function md(){const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.eval(fs.readFileSync('extension/markdown-lite.js','utf8'));const W=dom.window;return text=>{const box=W.document.createElement('div');box.append(W.RTMarkdown.render(text));return box;};}
test('archived markdown renders paragraphs, emphasis, lists, quotes and code as DOM',()=>{
 const render=md(),box=render('Intro with **bold** and *italic* and `code` and ~~gone~~.\nSecond line\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n```\nraw <b>\n```');
 assert.equal(box.querySelectorAll(':scope > p').length,1);assert.equal(box.querySelector('p br')!==null,true);assert.equal(box.querySelector('strong').textContent,'bold');assert.equal(box.querySelector('em').textContent,'italic');assert.equal(box.querySelector('code').textContent,'code');assert.equal(box.querySelector('del').textContent,'gone');
 assert.equal(box.querySelectorAll('ul li').length,2);assert.equal(box.querySelectorAll('ol li').length,2);assert.equal(box.querySelector('blockquote').textContent.trim(),'quoted');assert.equal(box.querySelector('pre code').textContent,'raw <b>');assert.equal(box.querySelector('b'),null,'no HTML is ever parsed');
});
test('links allow only http(s) and Reddit-relative targets; entities decode as text',()=>{
 const render=md(),box=render('[safe](https://example.com/a) [bad](javascript:alert(1)) see r/AskReddit and u/spez &amp; &lt;img src=x onerror=bad()&gt; https://bare.example/x');
 const links=[...box.querySelectorAll('a')].map(a=>a.href);
 assert.deepEqual(links,['https://example.com/a','https://www.reddit.com/r/AskReddit','https://www.reddit.com/u/spez','https://bare.example/x']);
 assert.match(box.textContent,/bad/);assert.equal(box.querySelector('img'),null);assert.match(box.textContent,/& <img src=x onerror=bad\(\)>/);
 for(const a of box.querySelectorAll('a'))assert.equal(a.rel,'noopener noreferrer nofollow');
});
test('archive-rendered HTML is rebuilt from an allowlist: formatting and tables kept, active content dropped',()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.eval(fs.readFileSync('extension/markdown-lite.js','utf8'));const W=dom.window;
 const html='<div class="md"><p>Hi <strong>there</strong> <a href="https://ok.example/x" target="_blank" onclick="bad()">ok</a> <a href="javascript:bad()">nope</a></p><table><thead><tr><th align="left">A</th></tr></thead><tbody><tr><td align="right" style="color:red">1</td></tr></tbody></table><script>bad()</script><img src="https://tracker.example/p.gif" onerror="bad()"><iframe src="https://x"></iframe><span class="md-spoiler-text">secret</span><p style="position:fixed" class="evil" id="x">tail</p></div>';
 const box=W.document.createElement('div');box.append(W.RTMarkdown.fromHtml(html,W.document));
 assert.equal(box.querySelector('strong').textContent,'there');const links=[...box.querySelectorAll('a')];assert.equal(links.length,1);assert.equal(links[0].href,'https://ok.example/x');assert.equal(links[0].getAttribute('target'),null);assert.equal(links[0].getAttribute('onclick'),null);assert.equal(links[0].rel,'noopener noreferrer nofollow');
 assert.equal(box.querySelector('th').style.textAlign,'left');assert.equal(box.querySelector('td').style.textAlign,'right');assert.equal(box.querySelector('td').getAttribute('style'),'text-align: right;');
 for(const sel of ['script','img','iframe','[onclick]','[onerror]','#x','.evil','.md'])assert.equal(box.querySelector(sel),null,sel);
 assert.equal(box.textContent.includes('bad()'),false,'script text is dropped, not shown');assert.equal(box.querySelector('.rt-spoiler').textContent,'secret');assert.match(box.textContent,/tail/);
 assert.equal(W.RTMarkdown.fromHtml('',W.document),null);
});
test('markdown backslash escapes left in archive HTML are removed outside code',()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'});dom.window.eval(fs.readFileSync('extension/markdown-lite.js','utf8'));const W=dom.window,box=W.document.createElement('div');
 box.append(W.RTMarkdown.fromHtml('<div class="md"><p>A \\+ B \\* C</p><pre><code>keep \\+ here</code></pre></div>',W.document));
 assert.equal(box.querySelector('p').textContent,'A + B * C');assert.equal(box.querySelector('code').textContent,'keep \\+ here');
});

test('comment images retain their place after headings and lists without replacing ordinary links',()=>{
 const dom=new JSDOM('',{runScripts:'outside-only'}),W=dom.window;
 for(const file of ['post-model.js','markdown-lite.js'])W.eval(fs.readFileSync('extension/'+file,'utf8'));
 const url='https://i.redd.it/synthetic123.jpg',media=[{kind:'image',url}],box=W.document.createElement('div');
 box.append(W.RTMarkdown.renderComment('# Heading\n- item\n'+url+'\n\n[ordinary link]('+url+')','',media));
 assert.deepEqual([...box.children].map(node=>node.tagName),['P','UL','DIV','P']);
 assert.equal(box.querySelector('.rt-comment-media img').src,url);
 assert.equal(box.querySelector('p a').textContent,'ordinary link');
 const restricted=W.document.createElement('div');restricted.append(W.RTMarkdown.renderComment(url,'',media,{restricted:true}));assert.equal(restricted.querySelector('img'),null);
 W.close();
});
