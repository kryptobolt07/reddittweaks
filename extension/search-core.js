/* Search stays in the content-script isolated world and never leaves this tab. */
(() => {
  const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/^u\//, '').trim();
  const matches = (text, query) => normalize(query).split(/\s+/).filter(Boolean).every(word => normalize(text).includes(word));
  const ranges = (text, query) => {
    // Keep offsets in the original string, including Unicode characters whose case expands.
    const terms = String(query).trim().split(/\s+/).filter(Boolean);
    const found = [];
    for (const term of terms) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      for (const match of String(text).matchAll(new RegExp(escaped, 'giu'))) found.push([match.index, match.index + match[0].length]);
    }
    found.sort((a, b) => a[0] - b[0]);
    return found.reduce((all, next) => {
      const last = all.at(-1);
      if (last && next[0] <= last[1]) last[1] = Math.max(last[1], next[1]);
      else all.push(next);
      return all;
    }, []);
  };
  function dateBounds({from='',to=''}={}) {
    const day=value=>{
      if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
      const [y,m,d]=value.split('-').map(Number),date=new Date(y,m-1,d);
      return date.getFullYear()===y && date.getMonth()===m-1 && date.getDate()===d ? date : null;
    };
    const first=from?day(from):null,last=to?day(to):null;
    const invalid=Boolean(from&&!first || to&&!last || first&&last&&first>last);
    if(last)last.setDate(last.getDate()+1);
    return {start:first?.getTime()??-Infinity,end:last?.getTime()??Infinity,active:Boolean(from||to),invalid};
  }
  const authorName=/^[A-Za-z0-9_-]{3,20}$/,subredditName=/^[A-Za-z0-9_]{2,21}$/;
  const fieldAliases={selftext:'body',text:'body',domain:'site'},queryFields=['title','body','author','subreddit','site','url','flair','self','nsfw','spoiler','type'];
  const canonicalField=field=>fieldAliases[field] || field;
  const emptyQuery=()=>({terms:[],phrases:[],excluded:[],from:[],after:[],before:[],hasLink:false,hasImage:false,hasFile:false,hasVideo:false,hasAudio:false,hasGif:false,invalid:false,errors:[],expr:{type:'and',children:[]},hasOperators:false});
  const joinExpr=(type,children)=>children.length===1?children[0]:{type,children};
  // Grammar: AND (including whitespace) < OR < NOT/-; OR deliberately binds
  // tighter than AND for compatibility: a b OR c = a AND (b OR c).
  function parseQuery(query='',{scopes=[],fields}={}) {
    const parsed=emptyQuery(),enabled=new Set([...scopes,...fields || []].map(canonicalField)),tokens=[];
    if(enabled.has('author'))parsed.authors=[];if(enabled.has('subreddit'))parsed.subreddits=[];
    const error=message=>{if(!parsed.errors.includes(message))parsed.errors.push(message);};
    const source=String(query),decode=value=>value.replace(/\\(["\\])/g,'$1').replace(/^"|"$/g,'');
    // Keep spaces and parentheses inside quotes, and leave unknown colon tokens
    // (https://..., 10:30, etc.) as ordinary text.
    for(let i=0;i<source.length;){
      if(/\s/.test(source[i])){i++;continue;}
      const char=source[i];
      if(char==='(' || char===')'){tokens.push({kind:char});i++;continue;}
      if(char==='-' && i+1<source.length && !/[\s)]/.test(source[i+1])){tokens.push({kind:'NOT',minus:true});i++;continue;}
      const start=i;let quoted=false;
      while(i<source.length){
        const next=source[i];
        if(quoted && next==='\\' && /["\\]/.test(source[i+1] || '')){i+=2;continue;}
        if(next==='"')quoted=!quoted;
        if(!quoted && /[\s()]/.test(next))break;
        i++;
      }
      if(quoted)error('Close the quoted phrase with "');
      const raw=source.slice(start,i);
      tokens.push({kind:['AND','OR','NOT'].includes(raw)?raw:'atom',raw});
    }
    parsed.explicitBoolean=tokens.some(token=>['(',')','AND'].includes(token.kind) || token.kind==='NOT' && !token.minus);
    function atom(token){
      const raw=token.raw,operator=raw.match(/^(from|after|before|has):(.*)$/i),named=raw.match(/^([a-z]+):(.*)$/i),scope=raw.match(/^(u|r)\/(.*)$/i);
      let field=operator?.[1].toLowerCase() || (scope?scope[1].toLowerCase()==='u'?'author':'subreddit':named?canonicalField(named[1].toLowerCase()):null);
      // Before fields was introduced, disabled author/subreddit scopes were
      // literal text. Keep that contract until a surface opts into fields.
      const known=operator || queryFields.includes(field),legacyScope=fields===undefined && ['author','subreddit'].includes(field) && !enabled.has(field);
      if(known && !legacyScope){
        const value=decode(operator?operator[2]:scope?scope[2]:named[2]),legacy=fields===undefined;
        if(!operator && !enabled.has(field))error(`${scope?scope[1]+'/':named[1]+':'} isn't available in this search`);
        if(!value.trim())error(`Add a value after ${field}:`);
        if(field==='author' && !authorName.test(value))error('Use a valid username after u/');
        else if(field==='subreddit' && !subredditName.test(value))error('Use a valid subreddit name after r/');
        else if(['self','nsfw','spoiler'].includes(field) && !/^(yes|no)$/i.test(value))error(`Use ${field}:yes or ${field}:no`);
        else if(field==='type' && !/^(text|image|video|gallery|link|gif|poll)$/i.test(value))error('Use type:text, type:image, type:video, type:gallery, type:link, type:gif or type:poll');
        else if(field==='has' && !/^(links?|images?|gifs?|videos?|audios?|files?)$/i.test(value))error('Use has:link, has:image, has:gif, has:video, has:audio or has:file');
        else if(field==='from' && !value)error('Add a sender after from:');
        else if(['after','before'].includes(field) && (!value || dateBounds({from:value}).invalid))error('Use a valid YYYY-MM-DD date');
        if(!legacy)parsed.hasOperators=true;
        return {type:'field',field,value,...(raw.includes('"')?{quoted:true}:{}),...(legacy?{legacy:true}:{})};
      }
      const phrase=raw.startsWith('"') && raw.endsWith('"'),text=phrase?decode(raw):raw.replace(/"/g,'');
      return {type:phrase?'phrase':'term',text};
    }
    let index=0;
    const canStart=token=>token && ['atom','NOT','('].includes(token.kind);
    function unary(){
      const token=tokens[index++];
      if(token.kind==='NOT'){
        parsed.hasOperators=true;
        if(!canStart(tokens[index])){error('Add a word or group after NOT');return null;}
        return {type:'not',child:unary()};
      }
      if(token.kind==='('){
        parsed.hasOperators=true;
        if(tokens[index]?.kind===')'){index++;error('Add a word inside the empty group');return null;}
        const child=and();
        if(tokens[index]?.kind===')')index++;else error('Close the group with )');
        return child;
      }
      return atom(token);
    }
    function or(){
      let node=unary();const children=node?[node]:[];
      while(tokens[index]?.kind==='OR'){
        parsed.hasOperators=true;index++;
        if(!canStart(tokens[index])){error('Put a word on both sides of OR');continue;}
        const right=unary();
        // A field beside OR (from:alice OR from:bob) is a structured alternative, the same as its parenthesised form.
        if(node?.legacy || right?.legacy)parsed.explicitBoolean=true;
        if(right)children.push(right);node=right;
      }
      return joinExpr('or',children);
    }
    function and(){
      const children=[];
      while(index<tokens.length && tokens[index].kind!==')'){
        const kind=tokens[index].kind;
        if(kind==='AND' || kind==='OR'){
          parsed.hasOperators=true;index++;
          if(kind==='OR')error('Put a word on both sides of OR');
          else if(!children.length || !canStart(tokens[index]))error('Put a word or group on both sides of AND');
          continue;
        }
        const child=or();if(child)children.push(child);
      }
      return joinExpr('and',children);
    }
    try{
      const root=and();parsed.expr=root.type==='and'?root:{type:'and',children:[root]};
      while(index<tokens.length){error('Unexpected ); remove it or add a matching (');index++;}
    }catch{error('The query is nested too deeply; use fewer groups');}
    let positive=false,negative=false,filtered=false;
    function collect(node,negated=false){
      if(!node)return;
      if(node.type==='not'){collect(node.child,!negated);return;}
      if(node.type==='term' || node.type==='phrase'){
        if(!node.text)return;
        if(negated){parsed.excluded.push(node.text);negative=true;}
        else{parsed[node.type==='term'?'terms':'phrases'].push(node.text);positive=true;}
      }else if(node.type==='field'){
        filtered=true;if(negated)return;
        const {field,value}=node;
        if(field==='author' && authorName.test(value))parsed.authors?.push(value);
        else if(field==='subreddit' && subredditName.test(value))parsed.subreddits?.push(value);
        else if(['from','after','before'].includes(field))parsed[field].push(field==='from'?normalize(value):value);
        else if(field==='has'){const kind=normalize(value).replace(/s$/,'');if(['link','image','file','video','audio','gif'].includes(kind))parsed['has'+kind[0].toUpperCase()+kind.slice(1)]=true;}
      }else for(const child of node.children || [])collect(child,negated);
    }
    try{collect(parsed.expr);}catch{error('The query is nested too deeply; use fewer groups');}
    // Retain the existing hint for exclusion-only text searches. Field-only
    // predicates (including NOT nsfw:yes) are useful structured searches.
    if(negative && !positive && !filtered)error('Add a word to search for');
    parsed.invalid=parsed.errors.length>0;return parsed;
  }
  const wordCharacter=char=>Boolean(char && /[\p{L}\p{N}_]/u.test(char));
  const beforeCharacter=(text,index)=>{const last=text.charCodeAt(index-1);return last>=0xdc00 && last<=0xdfff?text.slice(index-2,index):text[index-1];};
  const wordBoundary=(text,start,end)=>!wordCharacter(beforeCharacter(text,start)) && !wordCharacter(String.fromCodePoint(text.codePointAt(end) ?? 0));
  let segmenter;
  function foldedText(text){
    const original=String(text ?? '');
    // ASCII offsets never change: avoid thousands of grapheme objects and maps
    // for the usual chat messages and long links.
    if(!/[^\x00-\x7f]/.test(original))return {value:original.toLowerCase(),starts:null,ends:null};
    const starts=[],ends=[];let value='';
    const append=(segment,index)=>{const folded=segment.normalize('NFKC').toLocaleLowerCase();value+=folded;for(let i=0;i<folded.length;i++){starts.push(index);ends.push(index+segment.length);}};
    if(typeof Intl.Segmenter==='function'){
      segmenter ||= new Intl.Segmenter(undefined,{granularity:'grapheme'});
      for(const item of segmenter.segment(original))append(item.segment,item.index);
    }else{let index=0;for(const char of original){append(char,index);index+=char.length;}}
    return {value,starts,ends};
  }
  const needlesFor=parsed=>[...new Set([...parsed.terms,...parsed.phrases].map(normalize).filter(Boolean))];
  const wordAt=(folded,term,bounded)=>{let offset=0;while((offset=folded.indexOf(term,offset))!==-1){const end=offset+term.length;if(!bounded || wordBoundary(folded,offset,end))return true;offset=end;}return false;};
  // Compile the expression into a test over folded text; empty terms drop out, and a tree with nothing left is null (matches everything).
  function compileExpr(node,options){
    if(node.type==='term' || node.type==='phrase'){const needle=normalize(node.text);if(!needle)return null;const bounded=requiresBoundary(needle,options);return folded=>wordAt(folded,needle,bounded);}
    if(node.type==='not'){const child=compileExpr(node.child,options);return child && (folded=>!child(folded));}
    const tests=(node.children || []).map(child=>compileExpr(child,options)).filter(Boolean);
    if(!tests.length)return null;
    if(tests.length===1)return tests[0];
    return node.type==='or'?folded=>tests.some(test=>test(folded)):folded=>tests.every(test=>test(folded));
  }
  const exprFor=parsed=>parsed.expr || {type:'and',children:[...parsed.terms.map(text=>({type:'term',text})),...parsed.phrases.map(text=>({type:'phrase',text}))]};
  const foldedValue=text=>/[^\x00-\x7f]/.test(text)?foldedText(text).value:text.toLowerCase();
  function textMatcher(parsed,options={}){const test=compileExpr(exprFor(parsed),options);return test?text=>test(foldedValue(String(text ?? ''))):()=>true;}
  function matchesText(parsed,text,options={}){if(parsed==null)return true;parsed=typeof parsed==='object'?parsed:parseQuery(parsed);return !parsed.invalid && textMatcher(parsed,options)(text);}
  function matchRecord(parsed,record={},options={}){
    if(parsed==null)return true;
    parsed=typeof parsed==='object'?parsed:parseQuery(parsed);
    if(parsed.invalid)return false;
    const contains=(value,needle)=>{needle=normalize(needle);return value!=null && Boolean(needle) && wordAt(foldedValue(String(value)),needle,requiresBoundary(needle,options));};
    function fieldMatch({field,value}){
      const wanted=normalize(value);
      if(field==='title' || field==='body' || field==='flair')return contains(record[field],value);
      if(field==='author' || field==='subreddit')return record[field]!=null && normalize(String(record[field]).replace(/^[ur]\//i,''))===wanted;
      if(field==='site'){
        const domain=record.domain==null?'':normalize(record.domain);
        return Boolean(domain) && (domain===wanted || domain.endsWith('.'+wanted));
      }
      if(field==='url')return record.url!=null && foldedValue(String(record.url)).includes(wanted);
      if(['self','nsfw','spoiler'].includes(field)){const actual=record[field==='self'?'isSelf':field];return typeof actual==='boolean' && actual===(wanted==='yes');}
      if(field==='type')return record.type!=null && normalize(record.type)===wanted;
      if(field==='after' || field==='before'){
        const created=record.created,time=typeof created==='number'?(Math.abs(created)<1e12?created*1000:created):Date.parse(created),bound=dateBounds({from:value}).start;
        return Number.isFinite(time) && (field==='after'?time>=bound:time<bound);
      }
      if(field==='from'){
        if(record.authorSelf==null && record.author==null && record.sender==null)return false;
        const self=typeof record.authorSelf==='boolean'?record.authorSelf:normalize(record.author)==='you';
        return wanted==='me'?self:wanted==='them'?!self:!self && matches(record.author || record.sender,value);
      }
      if(field==='has')return Boolean(mediaFlags({...record,attachmentType:record.attachmentType || record.type,text:record.text ?? record.body ?? record.url})&mediaKinds[wanted.replace(/s$/,'')]);
      return false;
    }
    const text=[record.title,record.body].filter(value=>value!=null).join(' ');
    function evaluate(node){
      if(node.type==='term' || node.type==='phrase')return !normalize(node.text) || contains(text,node.text);
      if(node.type==='field')return fieldMatch(node);
      if(node.type==='not')return !evaluate(node.child);
      return node.type==='or'?node.children.some(evaluate):node.children.every(evaluate);
    }
    return evaluate(exprFor(parsed));
  }
  const queryObject=parsed=>typeof parsed==='object'?parsed:parseQuery(parsed);
  const quotedValue=value=>'"'+String(value).replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"';
  const queryAtom=node=>node.type==='phrase' || /[\s()"\\]/.test(node.text) || /^(AND|OR|NOT)$/.test(node.text) || node.text.startsWith('-')?quotedValue(node.text):node.text;
  function toArchiveQuery(parsed){
    if(parsed==null || parsed==='')return '';
    parsed=queryObject(parsed);if(parsed.invalid || !parsed.terms.length && !parsed.phrases.length)return '';
    // Legacy positive scope/chat filters are sent separately by existing callers.
    // New fields cannot be encoded in Arctic Shift's text parameter. In particular,
    // dropping a field inside OR/NOT would change the expression's meaning.
    const root=exprFor(parsed),children=root.type==='and'?root.children:[root],text=children.filter(node=>node.type!=='field' || !node.legacy);
    function textOnly(node){return node.type==='term' || node.type==='phrase' || node.type==='not' && textOnly(node.child) || ['and','or'].includes(node.type) && node.children.every(textOnly);}
    if(!text.every(textOnly))return '';
    // The backend (websearch_to_tsquery) binds AND before OR and ignores
    // parentheses, while ours binds OR first. Plain queries without OR keep the
    // established wire format; anything with OR or grouping is expanded to a
    // disjunction of conjunctions so the archive reads the same meaning.
    if(!parsed.explicitBoolean && !(text.length>1 && text.some(node=>node.type==='or'))){
      const atom=node=>node.type==='not'?'-'+atom(node.child):node.text==='-'?'':queryAtom(node);
      if(text.every(node=>node.type==='term' || node.type==='phrase' || node.type==='not' && ['term','phrase'].includes(node.child.type) || node.type==='or' && node.children.every(child=>['term','phrase'].includes(child.type) || child.type==='not' && ['term','phrase'].includes(child.child.type))))return text.map(node=>node.type==='or'?node.children.map(atom).filter(Boolean).join(' OR '):atom(node)).filter(Boolean).join(' ');
    }
    // Bound distribution: a large product must fall back to local filtering.
    function dnf(node,negated=false){
      if(node.type==='not')return dnf(node.child,!negated);
      if(node.type==='term' || node.type==='phrase'){
        if(!node.text || /["\\]/.test(node.text))return null;
        return [[(negated?'-':'')+queryAtom(node)]];
      }
      const union=(node.type==='or')!==negated;let result=union?[]:[[]];
      for(const child of node.children){
        const part=dnf(child,negated);if(!part)return null;
        if(union)result.push(...part);
        else{if(result.length*part.length>128)return null;result=result.flatMap(left=>part.map(right=>[...left,...right]));}
        if(result.length>128 || result.some(clause=>clause.length>128))return null;
      }
      return result;
    }
    const result=dnf({type:'and',children:text});
    return result?result.map(clause=>clause.join(' ')).join(' OR '):'';
  }
  function toRedditQuery(parsed){
    if(parsed==null || parsed==='')return '';
    parsed=queryObject(parsed);if(parsed.invalid)return '';
    const fields={title:'title',body:'selftext',author:'author',subreddit:'subreddit',site:'site',url:'url',flair:'flair',self:'self',nsfw:'nsfw'};
    function serialize(node){
      if(node.type==='term' || node.type==='phrase')return node.type==='term' && node.text.includes(':')?quotedValue(node.text):queryAtom(node);
      if(node.type==='field'){
        if(!fields[node.field])return null;
        const value=node.value,text=node.quoted || /[\s()"\\]/.test(value) || /^(AND|OR|NOT)$/.test(value) || value.startsWith('-')?quotedValue(value):value;
        return fields[node.field]+':'+text;
      }
      if(node.type==='not'){const child=serialize(node.child);return child==null?null:'NOT '+child;}
      const children=node.children.map(serialize);if(children.includes(null))return null;
      return children.length>1?'('+children.join(node.type==='or'?' OR ':' AND ')+')':children[0] || '';
    }
    // Unsupported atoms fail closed as a translation; splitQuery can first
    // produce a safe superset and indicate that local filtering is required.
    const result=serialize(exprFor(parsed));return result ?? '';
  }
  function splitQuery(parsed,supported=[]){
    parsed=parsed==null?emptyQuery():queryObject(parsed);
    // Accept a flat list of node/field names, or {nodes:[...],fields:[...]}.
    // Field names (or field:title) enable individual fields; 'field' alone does
    // not promise support for every field. Aliases are canonicalized.
    const list=Array.isArray(supported) || typeof supported?.[Symbol.iterator]==='function'?[...supported]:[...supported.nodes || supported.types || [],...supported.fields || []];
    const allowed=new Set(list.map(value=>canonicalField(String(value).replace(/^field:/,''))));
    const truth={node:null,exact:false};
    function project(node){
      if(node.type==='term' || node.type==='phrase' || node.type==='field')return allowed.has(node.type==='field'?node.field:node.type)?{node:{...node},exact:true}:truth;
      if(node.type==='not'){
        const child=project(node.child);
        return allowed.has('not') && child.exact?{node:{type:'not',child:child.node},exact:true}:truth;
      }
      const children=node.children.map(project);
      if(children.length===1)return children[0];
      if(!children.length)return {node:null,exact:true};
      if(!allowed.has(node.type))return truth;
      // Superset rule: server must never reject a full match. AND may drop
      // unsupported conjuncts; OR containing ANY unsupported atom is dropped
      // in full. NOT may only keep an exact child (negation reverses inclusion).
      if(node.type==='or' && children.some(child=>!child.exact))return truth;
      const kept=children.map(child=>child.node).filter(Boolean);
      return {node:kept.length?joinExpr(node.type,kept):null,exact:children.every(child=>child.exact)};
    }
    if(parsed.invalid){const server=emptyQuery();server.invalid=true;server.errors=[...parsed.errors];return {server,residual:true};}
    const projected=project(exprFor(parsed)),server=emptyQuery();
    server.expr=projected.node?.type==='and'?projected.node:{type:'and',children:projected.node?[projected.node]:[]};
    server.hasOperators=parsed.hasOperators;server.explicitBoolean=parsed.explicitBoolean;
    if(parsed.authors)server.authors=[];if(parsed.subreddits)server.subreddits=[];
    function collect(node,negated=false){
      if(node.type==='not'){collect(node.child,!negated);return;}
      if(node.type==='term' || node.type==='phrase')server[negated?'excluded':node.type==='term'?'terms':'phrases'].push(node.text);
      else for(const child of node.children || [])collect(child,negated);
    }
    collect(server.expr);
    // Only unconditional positive fields belong in the legacy side-channel
    // arrays. Copying fields out of OR/NOT could accidentally narrow a request.
    for(const node of server.expr.children){
      if(node.type!=='field')continue;
      const {field,value}=node;
      if(field==='author')server.authors=[...server.authors || [],value];
      else if(field==='subreddit')server.subreddits=[...server.subreddits || [],value];
      else if(['from','after','before'].includes(field))server[field].push(field==='from'?normalize(value):value);
      else if(field==='has'){const kind=normalize(value).replace(/s$/,'');server['has'+kind[0].toUpperCase()+kind.slice(1)]=true;}
    }
    // Invalid input remains invalid, even when projection produces no filter.
    server.invalid=parsed.invalid;server.errors=[...parsed.errors];
    return {server,residual:!projected.exact};
  }
  const requiresBoundary=(term,{wholeWord=false,shortTermsWholeWord=true}={})=>wholeWord || shortTermsWholeWord && [...term].length<3;
  function queryRanges(text,needles,options={}){
    if(!needles.length)return {ranges:[],complete:true,matchedTerms:0};
    const mapped=foldedText(text),found=[];let complete=true,matchedTerms=0;
    for(const term of needles){const bounded=requiresBoundary(term,options);let offset=0,matched=false;
      while((offset=mapped.value.indexOf(term,offset))!==-1){const end=offset+term.length;
        if(!bounded || wordBoundary(mapped.value,offset,end)){found.push([mapped.starts?mapped.starts[offset]:offset,mapped.ends?mapped.ends[end-1]:end]);matched=true;}
        offset=end;
      }
      if(!matched)complete=false;else matchedTerms++;
    }
    found.sort((a,b)=>a[0]-b[0]);
    const ranges=found.reduce((all,next)=>{const last=all.at(-1);if(last && next[0]<=last[1])last[1]=Math.max(last[1],next[1]);else all.push(next);return all;},[]);
    return {ranges,complete,matchedTerms};
  }
  const mediaKinds=Object.freeze({image:1,gif:2,link:4,video:8,audio:16,file:32});
  const mediaEntries=Object.entries(mediaKinds);
  const mediaQueryFlags=parsed=>mediaEntries.reduce((mask,[type,flag])=>mask | (parsed['has'+type[0].toUpperCase()+type.slice(1)]?flag:0),0);
  function mediaFlags(record){const type=record.attachmentType;let flags=(type==='image' || type==='video' || type==='audio' || type==='file')?mediaKinds[type]:0;if(record.attachmentType==='image' && record.attachmentMime==='image/gif')flags|=mediaKinds.gif;if(/\b(?:https?:\/\/|www\.)\S+/i.test(record.text || ''))flags|=mediaKinds.link;return flags;}
  function countMediaTypes(records,query='',options={},conversation={}){
    const counts=Object.fromEntries(Object.keys(mediaKinds).map(type=>[type,0])),match=prepareQuery(query,{...options,ignoreMedia:true},conversation);
    for(const record of records)if(record.text && match(record)){const flags=mediaFlags(record);for(const [type,flag]of mediaEntries)if(flags & flag)counts[type]++;}
    return counts;
  }
  function prepareQuery(query='',{from='all',wholeWord=false,shortTermsWholeWord=true,dates={},ignoreMedia=false}={},conversation={}){
    const parsed=typeof query==='object'?query:parseQuery(query),bounds=dateBounds(dates);
    if(parsed.invalid || bounds.invalid)return ()=>false;
    const matcher=textMatcher(parsed,{wholeWord,shortTermsWholeWord}),hasText=Boolean(compileExpr(exprFor(parsed),{}));
    const hasField=node=>node.type==='field' || node.type==='not' && hasField(node.child) || (node.children || []).some(hasField);
    const fieldBoolean=node=>node.type==='not' && hasField(node.child) || node.type==='field' && !node.legacy || (node.children || []).some(fieldBoolean);
    const structured=parsed.explicitBoolean || fieldBoolean(exprFor(parsed));
    const local=structured && ignoreMedia?splitQuery(parsed,['and','or','not','term','phrase',...queryFields,'from','after','before']).server:parsed;
    const wantedMedia=ignoreMedia?0:mediaQueryFlags(parsed);
    const start=Math.max(bounds.start,...parsed.after.map(date=>dateBounds({from:date}).start)),end=Math.min(bounds.end,...parsed.before.map(date=>dateBounds({from:date}).start));
    const dated=bounds.active || parsed.after.length>0 || parsed.before.length>0;
    return record=>{
      const self=typeof record.authorSelf==='boolean'?record.authorSelf:record.sender==='me' || Boolean(conversation.owner && record.sender===conversation.owner) || normalize(record.author)==='you';
      if(from==='me' && !self || from==='them' && self)return false;
      if(structured){
        const time=typeof record.timestamp==='number'?record.timestamp:new Date(record.timestamp ?? record.at).getTime();
        if(bounds.active && !(Number.isFinite(time) && time>=bounds.start && time<bounds.end))return false;
        return matchRecord(local,{...record,body:record.text ?? record.body,author:record.author || record.sender || conversation.name,authorSelf:self,created:record.created ?? (Number.isFinite(time)?new Date(time).toISOString():undefined)},{wholeWord,shortTermsWholeWord});
      }
      // Multiple sender selections are alternatives; text and other filters
      // still narrow those senders together.
      if(parsed.from.length && !parsed.from.some(sender=>sender==='me'?self:sender==='them'?!self:!self && (matches(record.author || record.sender,sender) || !record.author && matches(conversation.name,sender))))return false;
      if(dated){const time=typeof record.timestamp==='number'?record.timestamp:new Date(record.timestamp ?? record.at).getTime();if(!(Number.isFinite(time) && time>=start && time<end))return false;}
      const text=String(record.text || '');
      if(wantedMedia && (mediaFlags(record)&wantedMedia)!==wantedMedia)return false;
      // Keep normalization identical to highlighting. Sender normalization
      // strips u/ and whitespace, but message bodies must retain them.
      return !hasText || matcher(text);
    };
  }
  function matchesQuery(record,query='',options={},conversation={}){return prepareQuery(query,options,conversation)(record);}
  function highlightRanges(text,query='',options={}){const parsed=typeof query==='object'?query:parseQuery(query);return queryRanges(text,needlesFor(parsed),options).ranges;}
  function relevanceScore(text,query='',options={}){
    const parsed=typeof query==='object'?query:parseQuery(query),found=queryRanges(text,needlesFor(parsed),options);
    // AND matches all required terms. Coverage is primary; occurrences and
    // an early match break ties without admitting partial/OR results.
    return found.matchedTerms*1000000+Math.min(999999,found.ranges.reduce((score,[start,end])=>score+end-start+(start===0?20:0),0));
  }
  function messageSender(record,conversation={}){
    const self=typeof record.authorSelf==='boolean'?record.authorSelf:normalize(record.author)==='you' || Boolean(conversation.owner && record.sender===conversation.owner);
    const group=conversation.type?!['direct','reddit_titled_direct'].includes(conversation.type):(conversation.participantIds?.length || conversation.participants?.length || 0)>1;
    const label=self?'You':record.author && !record.author.startsWith('@')?record.author:'Sender unavailable';
    return {self,group,label,prefix:self || group?label+': ':''};
  }
  function excerpt(text,query='',{wholeWord=false,shortTermsWholeWord=true,max=160}={}){
    text=String(text ?? '');const found=highlightRanges(text,query,{wholeWord,shortTermsWholeWord}),first=found[0] || [0,0];
    max=Number.isFinite(max)?Math.max(20,max):160;
    let start=Math.max(0,first[0]-Math.floor(max/3)),end=Math.min(text.length,Math.max(start+max,first[1]));
    if(end===text.length)start=Math.max(0,Math.min(first[0],end-max));
    if(start && start<first[0]){const space=text.indexOf(' ',start);if(space!==-1 && space<first[0])start=space+1;}
    const prefix=start?'…':'',suffix=end<text.length?'…':'';
    return {text:prefix+text.slice(start,end)+suffix,ranges:found.filter(([a,b])=>b>start && a<end).map(([a,b])=>[Math.max(a,start)-start+prefix.length,Math.min(b,end)-start+prefix.length])};
  }
  function compactTime(timestamp,now=Date.now()){
    const date=new Date(timestamp),today=new Date(now);if(!Number.isFinite(date.getTime()))return '';
    const midnight=value=>new Date(value.getFullYear(),value.getMonth(),value.getDate()).getTime(),age=Math.round((midnight(today)-midnight(date))/86400000);
    if(age===0)return date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
    if(age===1)return 'Yesterday';if(age>1 && age<7)return date.toLocaleDateString(undefined,{weekday:'short'});
    return date.toLocaleDateString(undefined,{month:'short',day:'numeric',...(date.getFullYear()!==today.getFullYear()?{year:'numeric'}:{})});
  }
  function dayKey(timestamp){
    const date=new Date(timestamp);if(!Number.isFinite(date.getTime()))return '';
    return `${date.getFullYear()}-${date.getMonth()+1}-${date.getDate()}`;
  }
  function dayLabel(timestamp,now=Date.now()){
    const date=new Date(timestamp),today=new Date(now);if(!Number.isFinite(date.getTime()))return 'Date unavailable';
    const midnight=value=>Date.UTC(value.getFullYear(),value.getMonth(),value.getDate()),age=(midnight(today)-midnight(date))/86400000;
    if(age===0)return 'Today';if(age===1)return 'Yesterday';
    if(age>1 && age<7 && date.getFullYear()===today.getFullYear())return date.toLocaleDateString(undefined,{weekday:'long'});
    return date.toLocaleDateString(undefined,{month:'short',day:'numeric',...(date.getFullYear()!==today.getFullYear()?{year:'numeric'}:{})});
  }
  function messageTime(timestamp,{sort='newest',now=Date.now()}={}){
    const date=new Date(timestamp);if(!Number.isFinite(date.getTime()))return '';
    const time=date.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
    return sort==='relevant'?`${dayLabel(timestamp,now)}, ${time}`:time;
  }
  function fullTimestamp(timestamp){
    const date=new Date(timestamp);return Number.isFinite(date.getTime())?date.toLocaleString(undefined,{weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'Date unavailable';
  }
  class MessageIndex {
    constructor(limit = 5000,onEvict=()=>{}) { this.limit = limit; this.rooms = new Map();this.redacted=new Map();this.onEvict=onEvict; }
    upsert(room, messages,{dom=false,authoritative=false,redacted=[]}={}) {
      messages=messages.filter(message=>!message.id?.startsWith('~'));
      if(dom)messages=messages.filter(message=>!message.provisional);
      // Re-insert on every upsert so Map order is least-recently-used: the room on screen is never the one evicted.
      const index = this.rooms.get(room) || new Map();this.rooms.delete(room);this.rooms.set(room,index);
      if(!this.redacted.has(room))this.redacted.set(room,new Set());
      const removed=this.redacted.get(room);
      for(const id of redacted){removed.add(id);index.delete(id);}
      const named=author=>typeof author==='string' && author.trim() && !author.startsWith('@') && !['[deleted]','Someone','Unknown sender','Message'].includes(author);
      const speakers=new Map();
      for(const message of [...index.values(),...messages])if(message.sender) {
        const previous=speakers.get(message.sender) || {};
        speakers.set(message.sender,{...previous,...(named(message.author)?{author:message.author,authorHistorical:message.authorHistorical,authorUnavailable:message.authorUnavailable}:{}),authorSelf:message.authorSelf ?? previous.authorSelf,avatar:message.avatar || previous.avatar || ''});
      }
      for (const message of messages) if (message.id && message.text) {
        if(removed.has(message.id))continue;
        const previous=index.get(message.id);
        const sameSender=!message.sender || !previous?.sender || message.sender===previous.sender;
        const preserveHistorical=sameSender && previous?.authorHistorical && (!message.author || ['[deleted]','Someone'].includes(message.author));
        const preserveNamed=sameSender && named(previous?.author) && !named(message.author);
        const speaker=speakers.get(message.sender || previous?.sender),identity=preserveHistorical || preserveNamed ? previous : !named(message.author) && named(speaker?.author) ? speaker : message;
        const authorSelf=message.authorSelf ?? (sameSender ? previous?.authorSelf : undefined) ?? speaker?.authorSelf;
        const preserveBody=dom && previous?.authoritative;
        index.set(message.id,{...previous,...message,text:preserveBody ? previous.text : message.text,
          author:authorSelf ? 'You' : identity.author || message.author || (sameSender ? previous?.author : '') || '',authorSelf,
          authorHistorical:identity.authorHistorical ?? message.authorHistorical ?? (sameSender ? previous?.authorHistorical : undefined),
          authorUnavailable:message.authorUnavailable ?? identity.authorUnavailable ?? (sameSender ? previous?.authorUnavailable : undefined),
          sender:message.sender || previous?.sender,thread:message.thread ?? previous?.thread,
          avatar:message.avatar || (sameSender ? previous?.avatar : '') || speaker?.avatar || '',
          timestamp:preserveBody ? previous.timestamp : message.timestamp || previous?.timestamp || '',
          authoritative:authoritative || Boolean(previous?.authoritative)});
      }
      while (index.size > this.limit) index.delete(index.keys().next().value);
      // Keep no more than 20 conversations in memory.
      while (this.rooms.size > 20) {
        const oldest=this.rooms.keys().next().value;this.rooms.delete(oldest);this.redacted.delete(oldest);this.onEvict(oldest);
      }
    }
    search(room, query,dates={},options={}) {
      const match=prepareQuery(query,{...options,dates});
      return [...(this.rooms.get(room)?.values() ?? [])].filter(match);
    }
    replace(room,messages,metadata={}) {
      const previous=this.rooms.get(room);this.rooms.delete(room);if(previous)this.rooms.set(room,previous);
      this.upsert(room,messages,{authoritative:true,redacted:metadata.redacted || []});
      const ids=new Set(messages.filter(message=>message.id && message.text).map(message=>message.id));
      for(const id of this.rooms.get(room).keys())if(!ids.has(id))this.rooms.get(room).delete(id);
    }
    clear() { this.rooms.clear();this.redacted.clear(); }
  }
  // One list of search tips for every search box, cut down to the fields that box supports.
  // Each tip: the syntax, what it does and an example that can be put into the box.
  function searchTips({fields=[]}={}){
    const has=new Set(fields.map(canonicalField));
    const tips=[
      {syntax:'words',meaning:'All words must match',example:'battery laptop'},
      {syntax:'"exact phrase"',meaning:'Match the exact phrase',example:'"battery health"'},
      {syntax:'OR',meaning:'Either side matches (uppercase)',example:'laptop OR notebook'},
      {syntax:'-word, NOT',meaning:'Leave out matches (uppercase NOT)',example:'laptop -gaming'},
      {syntax:'( )',meaning:'Group alternatives',example:'(rog OR legion) -used'},
      {field:'title',syntax:'title:',meaning:'Words in the title',example:'title:review'},
      {field:'body',syntax:'body:',meaning:'Words in the text',example:'body:warranty'},
      {field:'author',syntax:'author:, u/',meaning:'By one person',example:'u/spez'},
      {field:'subreddit',syntax:'subreddit:, r/',meaning:'In one community',example:'r/termux'},
      {field:'site',syntax:'site:',meaning:'Links to a website',example:'site:github.com'},
      {field:'flair',syntax:'flair:',meaning:'Posts with a flair',example:'flair:Help'},
      {field:'type',syntax:'type:',meaning:'Post type (text, image, video, link, gallery…)',example:'type:image'},
      {field:'nsfw',syntax:'nsfw:, spoiler:',meaning:'Only or no NSFW or spoiler posts',example:'nsfw:no'}
    ];
    return {tips:tips.filter(tip=>!tip.field || has.has(tip.field)),note:'Words use AND. NOT binds first, then OR, then AND, so a b OR c means a AND (b OR c). Only uppercase AND, OR and NOT are operators.'};
  }
  globalThis.RCSCore = Object.freeze({searchTips,normalize, matches, ranges, dateBounds, parseQuery, matchesText, matchRecord, toArchiveQuery, toRedditQuery, splitQuery, prepareQuery, mediaKinds, mediaFlags, mediaQueryFlags, countMediaTypes, matchesQuery, highlightRanges, relevanceScore, messageSender, excerpt, compactTime, dayKey, dayLabel, messageTime, fullTimestamp, MessageIndex});
})();
