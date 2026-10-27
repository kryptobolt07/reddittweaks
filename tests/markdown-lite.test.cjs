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
