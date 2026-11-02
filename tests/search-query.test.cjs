const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({console});vm.runInContext(fs.readFileSync('extension/search-core.js','utf8'),context);
const C=context.RCSCore,plain=value=>JSON.parse(JSON.stringify(value));
const fields=['title','body','author','subreddit','site','url','flair','self','nsfw','spoiler','type'];
const parse=query=>C.parseQuery(query,{fields});
const record={title:'Alpha launch',body:'A quiet place for beta gamma',author:'Example_1',subreddit:'ExampleSub',url:'https://www.example.test/article',domain:'www.example.test',flair:'Project news',isSelf:true,nsfw:false,spoiler:true,type:'text',created:Date.parse('2026-01-15T12:00:00Z')};

test('explicit AND and implicit AND retain NOT > OR > AND precedence',()=>{
  const p=parse('alpha AND beta OR gamma NOT delta');
  assert.equal(p.invalid,false);
  assert.deepEqual(plain(p.expr),{type:'and',children:[{type:'term',text:'alpha'},{type:'or',children:[{type:'term',text:'beta'},{type:'term',text:'gamma'}]},{type:'not',child:{type:'term',text:'delta'}}]});
  for(const [text,wanted]of [['alpha gamma',true],['beta gamma',false],['alpha beta delta',false]])assert.equal(C.matchesText(p,text),wanted,text);
  assert.deepEqual(plain(parse('alpha and or not').terms),['alpha','and','or','not']);
});

test('parentheses override precedence and nest',()=>{
  const p=parse('(alpha AND beta) OR (gamma AND NOT (delta OR epsilon))');
  for(const [text,wanted]of [['alpha beta delta',true],['gamma',true],['gamma delta',false],['alpha',false]])assert.equal(C.matchesText(p,text),wanted,text);
  const nested=parse('('.repeat(80)+'alpha OR beta'+')'.repeat(80));
  assert.equal(nested.invalid,false);assert.equal(C.matchesText(nested,'beta'),true);
});

test('NOT and attached - negate atoms, phrases, fields and groups',()=>{
  for(const query of ['alpha NOT beta','alpha -beta','alpha NOT "beta gamma"','alpha -"beta gamma"','alpha -(beta OR gamma)']){
    assert.equal(parse(query).invalid,false,query);
    assert.equal(C.matchesText(parse(query),'alpha beta gamma'),false,query);
    assert.equal(C.matchesText(parse(query),'alpha delta'),true,query);
  }
  assert.equal(C.matchRecord(parse('NOT nsfw:yes'),record),true);
  assert.equal(C.matchRecord(parse('-nsfw:no'),record),false);
  assert.equal(C.matchesText(parse('NOT NOT alpha'),'alpha'),true);
  assert.deepEqual(plain(parse('alpha NOT (beta OR "gamma delta")').excluded),['beta','gamma delta']);
  assert.deepEqual(plain(parse('e-mail - mixed-case').terms),['e-mail','-','mixed-case']);
  assert.deepEqual(plain(parse('-alpha').errors),['Add a word to search for']);
});

test('quotes protect Boolean words, parentheses, colons, spaces and escaped quotes',()=>{
  const p=parse('"AND OR NOT" title:"two (quiet) words" body:"say \\"hi\\""');
  assert.equal(p.invalid,false);
  assert.deepEqual(plain(p.phrases),['AND OR NOT']);
  assert.equal(p.expr.children[1].value,'two (quiet) words');
  assert.equal(p.expr.children[2].value,'say "hi"');
  assert.equal(C.matchRecord(parse('title:"Alpha launch" body:"quiet place"'),record),true);
  assert.equal(C.matchRecord(parse('title:"launch Alpha"'),record),false);
  assert.equal(parse('""').invalid,false);
});

test('malformed syntax always returns human-readable errors',()=>{
  for(const query of ['AND alpha','alpha AND','alpha AND AND beta','OR alpha','alpha OR','alpha OR OR beta','alpha OR AND beta','NOT','alpha NOT','alpha OR NOT','(','alpha (beta','alpha)','()','( )','alpha AND ()','NOT ()','"unfinished','title:"unfinished']){
    let p;assert.doesNotThrow(()=>{p=parse(query);},query);
    assert.equal(p.invalid,true,query);assert.ok(p.errors.length,query);
    assert.ok(p.errors.every(error=>typeof error==='string' && error.length>8),query);
    assert.equal(C.matchRecord(p,record),false,query);assert.equal(C.matchesText(p,'alpha beta'),false,query);
    assert.equal(C.matchesQuery({text:'alpha beta'},p),false,query);assert.equal(C.splitQuery(p,['and','or','not','term']).server.invalid,true,query);
  }
});

test('every Reddit field and alias is canonicalized and evaluated',()=>{
  const cases=[['title:Alpha','title'],['body:quiet','body'],['selftext:quiet','body'],['text:quiet','body'],['author:Example_1','author'],['u/Example_1','author'],['subreddit:ExampleSub','subreddit'],['r/ExampleSub','subreddit'],['site:example.test','site'],['domain:example.test','site'],['url:example.test/article','url'],['flair:"Project news"','flair'],['self:yes','self'],['nsfw:no','nsfw'],['spoiler:yes','spoiler'],['type:text','type']];
  for(const [query,field]of cases){
    const p=parse(query);assert.equal(p.invalid,false,query);assert.equal(p.expr.children[0].type,'field');assert.equal(p.expr.children[0].field,field,query);
    assert.equal(C.matchRecord(p,record),true,query);
    assert.equal(C.matchRecord(p,{}),false,'missing '+query);
    assert.equal(p.hasOperators,true,query);
  }
  assert.equal(C.matchRecord(parse('AUTHOR:example_1 SUBREDDIT:examplesub SELF:YES TYPE:TEXT'),record),true);
  assert.equal(C.matchRecord(parse('author:example_1 subreddit:examplesub'),{author:'u/EXAMPLE_1',subreddit:'r/EXAMPLESUB'}),true);
  assert.equal(C.matchRecord(parse('site:example.test'),{domain:'notexample.test'}),false);
  for(const type of ['text','image','video','gallery','link','gif','poll'])assert.equal(C.matchRecord(parse('type:'+type),{type}),true,type);
  for(const field of ['self','nsfw','spoiler'])for(const value of ['yes','no'])assert.equal(parse(`${field}:${value}`).invalid,false);
});

test('fields are opt-in, scopes are aliases, and legacy literal scopes stay compatible',()=>{
  for(const field of fields){
    const p=C.parseQuery(field+':valid',{fields:[]});
    assert.equal(p.invalid,true,field);assert.ok(p.errors.includes(`${field}: isn't available in this search`),field);
  }
  for(const alias of ['selftext','text','domain'])assert.ok(C.parseQuery(alias+':value',{fields:[]}).errors.includes(`${alias}: isn't available in this search`));
  for(const [query,hint]of [['u/Example_1','u/'],['r/ExampleSub','r/']])assert.ok(C.parseQuery(query,{fields:[]}).errors.includes(`${hint} isn't available in this search`));
  assert.equal(C.parseQuery('text:quiet domain:example.test',{fields:['selftext','domain']}).invalid,false);
  const p=C.parseQuery('u/Example_1 r/ExampleSub',{scopes:['author','subreddit']});
  assert.deepEqual(plain(p.authors),['Example_1']);assert.deepEqual(plain(p.subreddits),['ExampleSub']);
  assert.equal(C.parseQuery('author:Example_1 OR title:Alpha',{fields:['title'],scopes:['author']}).invalid,false);
  assert.deepEqual(plain(C.parseQuery('u/Example_1 r/ExampleSub author:Example_1').terms),['u/Example_1','r/ExampleSub','author:Example_1']);
});

test('unknown colon tokens, URLs and times stay ordinary text',()=>{
  const p=parse('https://example.test 10:30 custom:value');
  assert.equal(p.invalid,false);assert.deepEqual(plain(p.terms),['https://example.test','10:30','custom:value']);
  assert.equal(C.matchesText(p,'at 10:30 https://example.test custom:value'),true);
});

test('field values validate emptiness, names, booleans and enumerated types',()=>{
  for(const query of ['title:','body:""','site:','url:','flair:" "','author:ab','u/name!','author:abcdefghijklmnopqrstu','r/x','subreddit:bad-name','self:true','nsfw:maybe','spoiler:1','type:audio','type:','before:2026-02-30','after:tomorrow','has:poll','from:']){
    const p=parse(query);assert.equal(p.invalid,true,query);assert.ok(p.errors.length,query);
  }
  for(const query of ['u/abc','author:abcdefghijklmnopqrst','r/ab','subreddit:abcdefghijklmnopqrstu'])assert.equal(parse(query).invalid,false,query);
});

test('legacy chat fields and side-channel arrays remain available',()=>{
  const p=C.parseQuery('coffee "quiet place" -spam from:Alice from:Bob before:2026-02-01 after:2026-01-01 has:links has:image has:gif has:video has:audio has:file');
  assert.equal(p.invalid,false);
  assert.deepEqual(plain(p.terms),['coffee']);assert.deepEqual(plain(p.phrases),['quiet place']);assert.deepEqual(plain(p.excluded),['spam']);
  assert.deepEqual(plain(p.from),['alice','bob']);assert.deepEqual(plain(p.before),['2026-02-01']);assert.deepEqual(plain(p.after),['2026-01-01']);
  for(const flag of ['hasLink','hasImage','hasGif','hasVideo','hasAudio','hasFile'])assert.equal(p[flag],true,flag);
  assert.equal(C.parseQuery('from:Alice OR coffee').invalid,false);assert.equal(C.parseQuery('from:Alice OR coffee').explicitBoolean,true);
});

test('shared chat matching evaluates new Boolean field groups without changing legacy sender alternatives',()=>{
  const mine={text:'coffee',author:'You',authorSelf:true,attachmentType:'image',timestamp:Date.parse('2026-01-15T12:00:00Z')},theirs={text:'tea',author:'Example_1',authorSelf:false};
  assert.equal(C.matchesQuery(mine,'coffee NOT has:image'),false);
  assert.equal(C.matchesQuery(mine,'coffee -has:image'),false);
  assert.equal(C.matchesQuery(theirs,'(from:me OR tea)'),true);
  assert.equal(C.matchesQuery(mine,'(from:me OR tea)'),true);
  assert.equal(C.matchesQuery(mine,'NOT from:me'),false);
  assert.equal(C.matchesQuery(theirs,'NOT from:me'),true);
  assert.equal(C.matchesQuery(theirs,'from:Other_1 from:Example_1'),true);
  assert.equal(C.matchesQuery(theirs,'from:Other_1 AND from:Example_1'),false);
  assert.equal(C.matchesQuery(mine,'coffee AND after:2026-01-01'),true);
  assert.equal(C.matchesQuery(mine,'coffee AND before:2026-01-01'),false);
  assert.equal(C.matchesQuery(mine,'coffee AND has:video',{ignoreMedia:true}),true);
  assert.equal(C.matchesQuery(mine,'coffee AND NOT has:image',{ignoreMedia:true}),true);
  assert.equal(C.matchesQuery(mine,'coffee AND has:image',{dates:{from:'2027-01-01'}}),false);
});

test('matchRecord evaluates the entire Boolean expression on title plus body',()=>{
  const p=parse('(title:Alpha AND body:quiet) OR (author:Other_1 AND NOT nsfw:yes)');
  assert.equal(C.matchRecord(p,record),true);
  assert.equal(C.matchRecord(p,{author:'Other_1',nsfw:false}),true);
  assert.equal(C.matchRecord(p,{title:'Alpha',author:'Other_1',nsfw:true}),false);
  assert.equal(C.matchRecord(parse('launch quiet'),record),true);
  assert.equal(C.matchRecord(parse('launch quiet -gamma'),record),false);
  assert.equal(C.matchRecord(null,{}),true);assert.equal(C.matchRecord(parse(''),{}),true);
  assert.equal(C.matchRecord('alpha',record),true);
  assert.equal(C.matchRecord(parse('title:ab'),{title:'cab'}),false);
  assert.equal(C.matchRecord(parse('title:ab'),{title:'cab'},{shortTermsWholeWord:false}),true);
  assert.equal(C.matchRecord(parse('body:猫猫猫 title:café'),{title:'CAFE\u0301',body:'今日は猫猫猫です'}),true);
});

test('negative fields match absent data, positive no values require actual false',()=>{
  for(const query of ['self:no','nsfw:no','spoiler:no'])assert.equal(C.matchRecord(parse(query),{}),false,query);
  assert.equal(C.matchRecord(parse('NOT nsfw:yes'),{}),true);
  assert.equal(C.matchRecord(parse('nsfw:no'),{nsfw:'no'}),false);
});

test('matchRecord supports before/after with seconds, milliseconds and ISO dates',()=>{
  const p=parse('after:2026-01-01 before:2026-02-01');
  for(const created of [record.created,record.created/1000,'2026-01-15T12:00:00Z'])assert.equal(C.matchRecord(p,{created}),true);
  for(const created of [undefined,null,'bad','2025-01-01T00:00:00Z','2026-02-02T00:00:00Z'])assert.equal(C.matchRecord(p,{created}),false,String(created));
  const lower=new Date(2026,0,1).getTime(),upper=new Date(2026,1,1).getTime();
  assert.equal(C.matchRecord(p,{created:lower}),true);assert.equal(C.matchRecord(p,{created:upper}),false);
});

test('toRedditQuery uses explicit grouping and Reddit field aliases',()=>{
  assert.equal(C.toRedditQuery(parse('alpha beta OR gamma')),'(alpha AND (beta OR gamma))');
  assert.equal(C.toRedditQuery(parse('(alpha beta) OR gamma')),'((alpha AND beta) OR gamma)');
  assert.equal(C.toRedditQuery(parse('alpha NOT (beta OR gamma)')),'(alpha AND NOT (beta OR gamma))');
  const p=parse('title:"Alpha launch" text:quiet u/Example_1 r/ExampleSub domain:example.test url:example.test/article flair:"Project news" self:yes nsfw:no');
  assert.equal(C.toRedditQuery(p),'(title:"Alpha launch" AND selftext:quiet AND author:Example_1 AND subreddit:ExampleSub AND site:example.test AND url:example.test/article AND flair:"Project news" AND self:yes AND nsfw:no)');
  assert.equal(C.toRedditQuery(parse('title:"say \\"hi\\""')),'title:"say \\"hi\\""');
  for(const query of ['type:poll','spoiler:yes','alpha OR type:image','alpha NOT has:image','alpha AND'])assert.equal(C.toRedditQuery(parse(query)),'',query);
  assert.equal(C.toRedditQuery(parse('https://example.test 10:30')), '(\"https://example.test\" AND \"10:30\")');
  assert.equal(C.toRedditQuery(null),'');assert.equal(C.toRedditQuery(''),'');assert.equal(C.toRedditQuery('alpha'),'alpha');
});

test('toArchiveQuery preserves established outputs and omits only legacy top-level fields',()=>{
  for(const [query,wanted]of [['alpha beta','alpha beta'],['alpha beta OR gamma','alpha beta OR alpha gamma'],['"alpha beta" -gamma','"alpha beta" -gamma'],['alpha from:Alice before:2026-02-01 has:image','alpha'],['from:Alice -gamma','']])assert.equal(C.toArchiveQuery(C.parseQuery(query)),wanted,query);
  assert.equal(C.toArchiveQuery(C.parseQuery('alpha u/Example_1 r/ExampleSub',{scopes:['author','subreddit']})),'alpha');
  for(const query of ['alpha title:Alpha','alpha OR body:quiet','alpha NOT type:image','alpha AND'])assert.equal(C.toArchiveQuery(parse(query)),'',query);
});

test('toArchiveQuery rewrites new grouping and NOT into the backend websearch syntax',()=>{
  const cases=[['alpha AND (beta OR gamma)','alpha beta OR alpha gamma'],['(alpha beta) OR gamma','alpha beta OR gamma'],['alpha NOT (beta OR gamma)','alpha -beta -gamma'],['alpha NOT (beta gamma)','alpha -beta OR alpha -gamma'],['alpha NOT NOT beta','alpha beta'],['"alpha beta" AND gamma','"alpha beta" gamma']];
  for(const [query,wanted]of cases)assert.equal(C.toArchiveQuery(parse(query)),wanted,query);
  // The documented backend ignores parentheses and binds AND before OR.
  const archiveMatch=(query,text)=>query.split(' OR ').some(clause=>(clause.match(/-?"[^"]*"|\S+/g) || []).every(token=>{const negative=token.startsWith('-');if(negative)token=token.slice(1);token=token.replace(/^"|"$/g,'');return negative?!text.includes(token):text.includes(token);}));
  for(const [query]of cases)for(let mask=0;mask<8;mask++){
    const text=['alpha','beta','gamma'].filter((_,i)=>mask&(1<<i)).join(' ');
    assert.equal(archiveMatch(C.toArchiveQuery(parse(query)),text),C.matchesText(parse(query),text),query+' / '+text);
  }
  const huge=Array.from({length:8},(_,i)=>`(left${i} OR right${i})`).join(' AND ');
  assert.equal(C.toArchiveQuery(parse(huge)),'');
});

test('splitQuery keeps supported conjunctions and drops unsupported OR and NOT completely',()=>{
  const supported=['and','or','not','term','phrase','title'];
  const first=C.splitQuery(parse('alpha AND title:Alpha AND type:image'),supported);
  assert.equal(first.residual,true);assert.equal(C.toRedditQuery(first.server),'(alpha AND title:Alpha)');
  for(const query of ['title:Alpha OR type:image','NOT (title:Alpha AND type:image)','(title:Alpha type:image) OR body:quiet']){
    const {server,residual}=C.splitQuery(parse(query),supported);assert.equal(residual,true,query);
    assert.deepEqual(plain(server.expr),{type:'and',children:[]},query);assert.equal(C.matchRecord(server,{}),true);
  }
  const {server,residual}=C.splitQuery(parse('alpha AND (title:Alpha OR type:image)'),supported);
  assert.equal(C.toRedditQuery(server),'alpha');assert.equal(residual,true);
});

test('splitQuery supports capability objects, aliases, exact queries and no capabilities',()=>{
  const p=parse('alpha AND text:quiet AND domain:example.test');
  const exact=C.splitQuery(p,{nodes:['term','and'],fields:['selftext','domain']});
  assert.equal(exact.residual,false);assert.equal(C.matchRecord(exact.server,record),true);
  assert.equal(C.toRedditQuery(exact.server),'(alpha AND selftext:quiet AND site:example.test)');
  const none=C.splitQuery(p,[]);assert.equal(none.residual,true);assert.equal(C.toRedditQuery(none.server),'');
  assert.equal(C.splitQuery(parse('alpha'),['term']).residual,false);
  assert.equal(C.splitQuery(parse('alpha'),new Set(['term'])).residual,false);
  assert.equal(C.splitQuery(parse(''),[]).residual,false);
  assert.equal(C.splitQuery(parse('NOT nsfw:yes'),['not','nsfw']).residual,false);
  assert.equal(C.splitQuery(parse('title:Alpha'),['field:title']).residual,false);
  assert.equal(C.splitQuery(parse('title:Alpha'),['field']).residual,true);
  assert.equal(C.splitQuery(parse('title:Alpha OR body:quiet'),['title','body']).residual,true);
  assert.equal(C.splitQuery(parse('alpha AND'),['and','term']).server.invalid,true);
});

test('splitQuery rebuilds legacy fields without leaking conditional atoms',()=>{
  const all=['and','or','not','term','phrase',...fields,'from','has','before','after'];
  const p=parse('u/Example_1 OR r/ExampleSub'),split=C.splitQuery(p,all);
  assert.equal(split.residual,false);assert.deepEqual(plain(split.server.authors),[]);assert.deepEqual(plain(split.server.subreddits),[]);
  const dropped=C.splitQuery(parse('u/Example_1 OR type:image'),['and','or','author']);
  assert.deepEqual(plain(dropped.server.authors),[]);
  const kept=C.splitQuery(parse('u/Example_1 after:2026-01-01 has:image'),all).server;
  assert.deepEqual(plain(C.splitQuery(parse('from:Example_1'),all).server.from),['example_1']);
  assert.deepEqual(plain(kept.authors),['Example_1']);assert.deepEqual(plain(kept.after),['2026-01-01']);assert.equal(kept.hasImage,true);
});

test('randomized backend projection is a superset of full matching',()=>{
  let state=0x51ced;const random=n=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state%n;};
  const atoms=[
    ['alpha',r=>(r.title+' '+r.body).includes('alpha')],['"beta gamma"',r=>(r.title+' '+r.body).includes('beta gamma')],
    ['title:alpha',r=>r.title.includes('alpha')],['body:beta',r=>r.body.includes('beta')],
    ['nsfw:yes',r=>r.nsfw===true],['author:Example_1',r=>r.author==='Example_1'],['type:image',r=>r.type==='image'],['spoiler:no',r=>r.spoiler===false]
  ];
  function generate(depth){
    if(!depth || random(4)===0){const [text,match]=atoms[random(atoms.length)];return {text,match};}
    const left=generate(depth-1);if(random(3)===0)return {text:'NOT ('+left.text+')',match:r=>!left.match(r)};
    const right=generate(depth-1),or=random(2)===0;
    return {text:`(${left.text} ${or?'OR':'AND'} ${right.text})`,match:r=>or?left.match(r)||right.match(r):left.match(r)&&right.match(r)};
  }
  const records=Array.from({length:60},()=>({title:(random(2)?'anchor ':'')+(random(2)?'alpha':'delta'),body:random(2)?'beta gamma':'epsilon',author:random(2)?'Example_1':undefined,nsfw:[true,false,undefined][random(3)],spoiler:[true,false,undefined][random(3)],type:random(2)?'image':'text'}));
  const capabilities=[[],['and','term'],['and','or','not','term','phrase'],['and','or','title','author','nsfw'],['and','or','not','term','phrase',...fields]];
  let positives=0;
  for(let i=0;i<100;i++){
    const generated=generate(3),query='anchor AND ('+generated.text+')',p=parse(query);assert.equal(p.invalid,false,query);
    for(const supported of capabilities){
      const {server,residual}=C.splitQuery(p,supported);
      for(const row of records){
        const full=C.matchRecord(p,row),remote=C.matchRecord(server,row),expected=row.title.includes('anchor')&&generated.match(row);
        assert.equal(full,expected,query);if(full){positives++;assert.equal(remote,true,query+' capabilities '+supported.join(','));}
        if(!residual)assert.equal(remote,full,query);
      }
    }
  }
  assert.ok(positives>100);
});
