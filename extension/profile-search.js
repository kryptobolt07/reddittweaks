/* Profile history search (isolated world). On Reddit's own "Search in u/name" results page
   (/user/<name>/search/?q=...), adds a section of archive matches that Reddit did not return,
   plus a Subreddit filter in Reddit's filter row. Reddit's results are never altered except
   for hiding units with data-rt-filter-hidden. Every hook fails closed. */
(() => {
  'use strict';
  if(globalThis.RTProfileSearch)return;
  const settingsKey='rt-settings-v1',tabs=['posts','comments','media'],sorts=['relevance','hot','top','new','comments'];
  const ranges={hour:3600,day:86400,week:604800,month:2592000,year:31536000};
  const firstCount=3,initialPages=3,olderPages=10,mediaTypes=['image','video','gallery'];
  const unitSelector='search-telemetry-tracker[data-testid="search-sdui-post"],[data-testid="search-sdui-comment-unit"]';
  const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;};
  const F=()=>globalThis.RTFeedFilters,Q=()=>globalThis.RTArchiveQuery,C=()=>globalThis.RCSCore;

  // The scoped search results page only, and only with a query.
  function routeOf(path=location.pathname,search=location.search){
    const m=String(path).match(/^\/user\/([\w-]{1,20})\/search\/?$/i);if(!m)return null;
    const p=new URLSearchParams(search),q=(p.get('q')||'').trim();if(!q)return null;
    const type=tabs.includes(p.get('type'))?p.get('type'):'posts',sort=sorts.includes(p.get('sort'))?p.get('sort'):'relevance',t=ranges[p.get('t')]?p.get('t'):'all';
    return {username:m[1],q,type,sort,t,key:['u',m[1].toLowerCase(),q,type,sort,t].join('|')};
  }

  function glyph(kind){
    const shared=globalThis.RTPostDiscovery?.glyph;if(shared)return shared(kind);
    const s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('viewBox','0 0 20 20');s.setAttribute('aria-hidden','true');s.dataset.icon=kind;s.classList.add('rt-activity-icon');return s;
  }

  // Which ids and subreddit a Reddit result unit stands for (data-thingid and tracking JSON).
  function unitInfo(unit){
    let id=(unit.getAttribute('data-thingid')||'').toLowerCase(),comment='',post='',subreddit='';
    for(const el of [unit,...unit.querySelectorAll('[data-faceplate-tracking-context]')]){
      let data;try{data=JSON.parse(el.getAttribute('data-faceplate-tracking-context')||'null');}catch{data=null;}
      if(!data)continue;
      if(!comment && data.comment?.id)comment=String(data.comment.id).toLowerCase();
      if(!post && data.post?.id)post=String(data.post.id).toLowerCase();
      if(!subreddit && data.subreddit?.name)subreddit=String(data.subreddit.name);
    }
    if(!subreddit)subreddit=(unit.querySelector('a[href^="/r/"]')?.getAttribute('href')||'').split('/')[2]||'';
    const own=comment||id||post;
    return {id:own,subreddit};
  }

  // Positive terms only: the core's ranges never include excluded words.
  function highlighted(text,parsed,offset=0,max=Infinity){
    text=String(text||'');const frag=document.createDocumentFragment();
    let ranges=[];try{ranges=(C()?.highlightRanges?.(text,parsed)||[]).filter(r=>r[1]>r[0]).sort((a,b)=>a[0]-b[0]);}catch{}
    let start=0,end=text.length,lead='',tail='';
    if(text.length>max){start=ranges.length?Math.max(0,ranges[0][0]-Math.floor(max/4)):0;end=Math.min(text.length,start+max);if(start){const sp=text.indexOf(' ',start);if(sp>-1&&(!ranges.length||sp<ranges[0][0]))start=sp+1;lead='…';}if(end<text.length)tail='…';}
    let at=start;if(lead)frag.append(lead);
    for(const [a,b] of ranges){const s=Math.max(a,at),e=Math.min(b,end);if(e<=s)continue;if(s>at)frag.append(text.slice(at,s));frag.append(make('strong','font-semibold',text.slice(s,e)));at=e;}
    if(at<end)frag.append(text.slice(at,end));if(tail)frag.append(tail);return frag;
  }

  // Deleted/Removed only with evidence in the snapshot; otherwise a neutral archive cue.
  function statusOf(item){
    const body=String(item.body||'').trim();
    const marks=[item.archiveStatus,item.status].filter(v=>v==='deleted'||v==='removed');
    if(marks.length)return marks[0];
    if(body==='[deleted]')return 'deleted';if(body==='[removed]')return 'removed';
    return 'archive';
  }
  const cueLabel={deleted:'Deleted',removed:'Removed',archive:'From the archive'};
  const cueTitle={deleted:'Deleted · Arctic Shift snapshot',removed:'Removed · Arctic Shift snapshot',archive:'From the archive · Arctic Shift snapshot · Current Reddit status unknown'};

  function relative(created,now=Date.now()/1000){
    const s=Math.max(0,now-created);
    for(const [n,u] of [[31536000,'y'],[2592000,'mo'],[86400,'d'],[3600,'hr'],[60,'min']])if(s>=n)return Math.floor(s/n)+' '+u+'. ago';
    return 'now';
  }
  const dateText=sec=>new Date(sec*1000).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});

  function readSettings(){
    return Promise.resolve(chrome.runtime.sendMessage({scope:'rt-posts',action:'get-settings',pageUrl:location.href})).then(r=>{if(!r?.ok)throw Error('settings');return r.settings;});
  }

  class ProfileSearch{
    constructor({read=readSettings,observe=true,delay=120,now=()=>Date.now()/1000}={}){
      this.read=read;this.delay=delay;this.clock=now;this.settings=null;this.gen=0;this.current=null;this.timer=null;this.dead=false;this.hidden=new Set();
      this.onRoute=()=>this.schedule();
      this.onSettingsMessage=(m,sender)=>{if(m?.scope==='rt-posts'&&m.action==='settings-changed'&&sender?.id===globalThis.chrome?.runtime?.id)this.applySettings(m.settings);};
      this.onStorage=(changes)=>{if(changes?.[settingsKey])this.applySettings(changes[settingsKey].newValue);};
      this.onOutside=event=>{const c=this.current;if(c?.menuOpen && !c.control?.contains(event.target))this.closeMenu();};
      this.onKey=event=>{if(event.key==='Escape' && this.current?.menuOpen){this.closeMenu();this.current.button?.focus?.();}};
      if(observe)this.observe();
    }
    observe(){
      window.addEventListener('popstate',this.onRoute);document.addEventListener('reddit:route',this.onRoute);
      document.addEventListener('click',this.onOutside,true);document.addEventListener('keydown',this.onKey);
      this.observer=new MutationObserver(records=>{if(records.every(r=>this.ours(r.target)))return;this.schedule();});
      this.observer.observe(document.documentElement,{childList:true,subtree:true});
      try{chrome.runtime.onMessage.addListener(this.onSettingsMessage);chrome.storage?.onChanged?.addListener(this.onStorage);}catch{}
      this.load();
    }
    ours(node){const el=node?.nodeType===1?node:node?.parentElement;return Boolean(el?.closest?.('[data-rt-profile-search],[data-rt-profile-search-filter],[data-rt-profile-search-chips]'));}
    async load(){
      try{const raw=await this.read();this.applySettings(raw);}catch{this.settings={archiveDiscovery:false};}
      this.tick();
    }
    applySettings(raw){
      const next=globalThis.RTPostModel?.normalizeSettings?.(raw)||{archiveDiscovery:raw?.archiveDiscovery===true};
      const changed=!this.settings||this.settings.archiveDiscovery!==next.archiveDiscovery;this.settings=next;if(changed)this.schedule();
    }
    schedule(){if(this.dead)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.tick(),this.delay);}

    tick(){
      if(this.dead||!this.settings)return;
      const route=this.settings.archiveDiscovery&&F()&&Q()?.search&&C()?.parseQuery?routeOf():null;
      if(!route){this.teardown();return;}
      if(this.current?.route.key!==route.key)this.mount(route);
      else this.maintain();
    }

    // ---------- lifecycle ----------
    mount(route){
      this.teardown();
      const f=F(),cur=this.current={route,gen:++this.gen,abort:new AbortController(),now:this.clock(),filters:f.parse(location.search),
        parsed:C().parseQuery(route.q,{scopes:['subreddit']}),
        state:{items:[],hasMore:false,cursor:null,searchedBackTo:null,loading:false,error:null,expanded:false,stalled:false,ran:false},
        counts:null,countsFallback:false,menuOpen:false,sig:''};
      cur.kind=route.type==='comments'?'comment':'post';cur.hasText=Boolean(cur.parsed.terms.length||cur.parsed.phrases.length);
      cur.section=make('section','rt-profile-search flex flex-col mb-md');cur.section.dataset.rtProfileSearch='true';cur.section.setAttribute('aria-label','Archive matches');
      if(!cur.hasText){cur.section.hidden=true;}
      this.maintain();
      if(cur.hasText){cur.searchKey=this.searchKey(cur);this.run(cur,false);}
    }
    teardown(){
      const cur=this.current;if(!cur){return;}
      cur.abort.abort();cur.section?.remove();cur.control?.remove();cur.chips?.remove();
      for(const el of this.hidden)el.removeAttribute('data-rt-filter-hidden');this.hidden.clear();
      this.current=null;
    }
    stop(){
      this.dead=true;clearTimeout(this.timer);this.teardown();this.observer?.disconnect();
      window.removeEventListener('popstate',this.onRoute);document.removeEventListener('reddit:route',this.onRoute);
      document.removeEventListener('click',this.onOutside,true);document.removeEventListener('keydown',this.onKey);
      try{chrome.runtime.onMessage.removeListener(this.onSettingsMessage);chrome.storage?.onChanged?.removeListener(this.onStorage);}catch{}
    }

    // ---------- query mapping ----------
    params(cur){
      const f=F(),state=cur.filters,{route}=cur,range=f.dateRange(state,cur.now);
      const subs=[];for(const n of (state.subreddits.length?state.subreddits:(cur.parsed.subreddits||[]))){const s=f.subName(n);if(s&&!subs.some(x=>x.toLowerCase()===s.toLowerCase()))subs.push(s);}
      let after=ranges[route.t]?Math.floor(cur.now-ranges[route.t]):null,before=null;
      if(range){if(range.after!=null)after=after==null?range.after:Math.max(after,range.after);before=range.before;}
      let postTypes;
      if(cur.kind==='post'){
        postTypes=route.type==='media'?[...mediaTypes]:undefined;
        if(state.types.length)postTypes=postTypes?postTypes.filter(t=>state.types.includes(t)):[...state.types];
        if(postTypes&&!postTypes.length)postTypes=['none'];
      }
      return {kind:cur.kind,author:route.username,subreddit:subs.length===1?subs[0]:undefined,parsed:cur.parsed,after:after??undefined,before:before??undefined,sort:state.sort==='old'?'asc':'desc',postTypes,subs};
    }
    searchKey(cur){const p=this.params(cur);return JSON.stringify([p.kind,cur.route.q,p.subreddit,p.after,p.before,p.sort,p.postTypes]);}

    // ---------- searching ----------
    async run(cur,older){
      const st=cur.state,signal=cur.abort.signal,stale=()=>this.current!==cur||signal.aborted;
      st.loading=true;st.error=null;st.ran=true;this.render(cur);
      const p=this.params(cur);
      try{
        for await(const page of Q().search({kind:p.kind,author:p.author,subreddit:p.subreddit,parsed:p.parsed,after:p.after,before:p.before,sort:p.sort,postTypes:p.postTypes,cursor:older?st.cursor??undefined:undefined,maxPages:older?olderPages:initialPages,signal})){
          if(stale())return;
          const known=new Set(st.items.map(i=>i.fullname||i.id));
          for(const item of page.items||[])if(!known.has(item.fullname||item.id))st.items.push(item);
          st.hasMore=Boolean(page.hasMore);st.cursor=page.cursor??null;st.stalled=Boolean(page.stalled);
          if(page.searchedBackTo!=null)st.searchedBackTo=page.searchedBackTo;
          this.render(cur);
        }
      }catch(error){
        if(stale())return;
        st.error={message:error?.code==='rate-limited'||error?.retryAt?'The archive is busy right now.':(error?.message||'The archive could not be searched right now.'),retryAt:error?.retryAt||null,older:older||st.cursor!=null};
      }finally{
        if(!stale()){st.loading=false;this.render(cur);if(!cur.countsRequested){cur.countsRequested=true;this.loadCounts(cur);}}
      }
    }
    restart(cur){
      cur.abort.abort();cur.abort=new AbortController();
      cur.state={items:[],hasMore:false,cursor:null,searchedBackTo:null,loading:false,error:null,expanded:false,stalled:false,ran:false};
      cur.searchKey=this.searchKey(cur);cur.countsRequested=false;
      if(cur.hasText)this.run(cur,false);else this.render(cur);
    }
    async loadCounts(cur){
      const A=Q();if(!A.aggregate||!cur.hasText)return;
      const p=this.params(cur),signal=cur.abort.signal;
      try{
        const r=await A.aggregate({kind:p.kind,author:p.author,by:'subreddit',after:p.after,before:p.before});
        if(this.current!==cur||signal.aborted)return;cur.buckets=r?.buckets||[];cur.countsFallback=false;
      }catch{if(this.current!==cur||signal.aborted)return;cur.buckets=null;cur.countsFallback=true;}
      if(cur.menuOpen)this.buildMenu(cur);
    }

    // ---------- Reddit page ----------
    units(){return [...document.querySelectorAll(unitSelector)].filter(u=>!u.closest('[data-rt-profile-search]'));}
    visible(){
      const ids=new Set(),loaded=[];
      for(const unit of this.units()){const info=unitInfo(unit);if(info.id)ids.add(info.id);if(info.subreddit)loaded.push({subreddit:info.subreddit});}
      return {ids,loaded};
    }
    maintain(){
      const cur=this.current;if(!cur)return;
      this.place(cur);this.controls(cur);this.applyFilter(cur);
      const sig=this.signature(cur);if(sig!==cur.sig)this.render(cur);
    }
    place(cur){
      if(cur.section.hidden)return;
      const first=this.units()[0];
      if(first){const parent=first.parentElement;if(cur.section.parentNode!==parent||cur.section.nextSibling!==first)parent.insertBefore(cur.section,first);return;}
      if(cur.section.isConnected&&cur.section.parentElement.closest('main'))return;
      const host=document.querySelector('main div.bg-neutral-background')||document.querySelector('main');
      if(host&&cur.section.parentNode!==host)host.prepend(cur.section);
    }
    // The Subreddit dropdown goes after Reddit's Time control, in the same row, borrowing its button classes.
    controls(cur){
      if(!cur.chips){cur.chips=make('div','rt-filter-chips');cur.chips.dataset.rtProfileSearchChips='true';cur.chips.hidden=true;}
      if(!cur.control){
        const wrap=make('div','relative inline-flex');wrap.dataset.rtProfileSearchFilter='true';
        const button=make('button','');button.type='button';button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-expanded','false');button.dataset.rtSubredditFilter='true';
        const label=make('span','',cur.filters.subreddits.length?'Subreddit · '+cur.filters.subreddits.length:'Subreddit');label.dataset.rtFilterLabel='true';
        const caret=glyph('chevron-right');caret.classList.add('rt-profile-search-caret');button.append(label,caret);
        button.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();cur.menuOpen?this.closeMenu():this.openMenu(cur);});
        const menu=make('div','rt-profile-search-menu bg-neutral-background border-sm border-solid border-neutral-border rounded-4 py-xs');menu.setAttribute('role','menu');menu.hidden=true;
        wrap.append(button,menu);Object.assign(cur,{control:wrap,button,menu,label});
      }
      const hostOf=a=>a?.closest('faceplate-dropdown-menu,rpl-dropdown,faceplate-menu,[data-testid*="filter"]')||null;
      const timeAnchor=document.querySelector('a[href*="/search"][href*="t="]'),sortAnchor=document.querySelector('a[href*="/search"][href*="sort="]');
      const host=hostOf(timeAnchor)||hostOf(sortAnchor);
      const spacer=document.querySelector('[data-testid="search-results-filter-spacer-desktop"]');
      if(host&&host.parentElement){
        if(cur.control.previousElementSibling!==host)host.after(cur.control);
        const trigger=host.querySelector('button');
        const cls=(trigger?.className||'button button-secondary button-small inline-flex items-center')+' rt-profile-search-trigger';
        if(cur.button.className!==cls)cur.button.className=cls;
        const row=host.parentElement;if(cur.chips.previousElementSibling!==row)row.after(cur.chips);
      }else if(spacer){
        if(cur.control.parentNode!==spacer){cur.button.className='button button-secondary button-small inline-flex items-center rt-profile-search-trigger';spacer.append(cur.control);}
        if(cur.chips.parentNode!==spacer.parentNode)spacer.after(cur.chips);
      }else if(!cur.chips.isConnected&&cur.section.parentNode){cur.section.before(cur.chips);}
      this.renderChips(cur);
    }
    renderChips(cur){
      const f=F();
      f.renderChips(cur.chips,{...f.empty(),subreddits:cur.filters.subreddits},{make,glyph,onChange:next=>this.setFilters(cur,{...cur.filters,subreddits:next.subreddits})});
      if(cur.label)cur.label.textContent=cur.filters.subreddits.length?'Subreddit · '+cur.filters.subreddits.length:'Subreddit';
    }
    setFilters(cur,next){
      if(this.current!==cur)return;
      const f=F();cur.filters=next;f.write(next);
      this.renderChips(cur);this.applyFilter(cur);
      if(cur.menuOpen)this.buildMenu(cur);
      if(this.searchKey(cur)!==cur.searchKey)this.restart(cur);else this.render(cur);
    }
    applyFilter(cur){
      const subs=new Set(this.effectiveSubs(cur).map(s=>s.toLowerCase()));
      for(const unit of this.units()){
        const sub=unitInfo(unit).subreddit.toLowerCase(),hide=Boolean(subs.size&&sub&&!subs.has(sub));
        if(hide){if(!unit.hasAttribute('data-rt-filter-hidden'))unit.setAttribute('data-rt-filter-hidden','true');this.hidden.add(unit);}
        else if(this.hidden.has(unit)){unit.removeAttribute('data-rt-filter-hidden');this.hidden.delete(unit);}
      }
    }
    // Only the dropdown narrows Reddit's own units; an r/name in the query already narrowed Reddit's search.
    effectiveSubs(cur){return cur.filters.subreddits;}

    // ---------- dropdown ----------
    openMenu(cur){cur.menuOpen=true;cur.button.setAttribute('aria-expanded','true');cur.menu.hidden=false;this.buildMenu(cur);}
    closeMenu(){const cur=this.current;if(!cur)return;cur.menuOpen=false;cur.button.setAttribute('aria-expanded','false');cur.menu.hidden=true;}
    buildMenu(cur){
      const f=F(),loaded=this.visible().loaded;
      const counts=cur.buckets?f.mergeCounts(cur.buckets,loaded):f.mergeCounts([],loaded);
      for(const s of cur.filters.subreddits)if(!counts.some(c=>c.key.toLowerCase()===s.toLowerCase()))counts.push({key:s,count:0});
      cur.menu.replaceChildren();
      const picked=new Set(cur.filters.subreddits.map(s=>s.toLowerCase())),full=picked.size>=f.maxSubreddits;
      for(const {key,count} of counts.slice(0,40)){
        const on=picked.has(key.toLowerCase()),row=make('button','rt-profile-search-option flex items-center justify-between w-full px-md py-xs text-14 text-neutral-content-strong cursor-pointer hover:bg-neutral-background-hover');
        row.type='button';row.setAttribute('role','menuitemcheckbox');row.setAttribute('aria-checked',String(on));row.dataset.rtSubOption=key;
        const name=make('span','flex items-center gap-xs'),text=make('span','','r/'+key);name.append(text);if(on){const check=glyph('checkmark');check.dataset.rtCheck='true';name.append(check);}
        row.append(name,make('span','text-12 text-neutral-content-weak ms-md',count?String(count):''));
        if(full&&!on)row.disabled=true;
        row.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();
          const subs=on?cur.filters.subreddits.filter(s=>s.toLowerCase()!==key.toLowerCase()):[...cur.filters.subreddits,key].slice(0,f.maxSubreddits);
          this.setFilters(cur,{...cur.filters,subreddits:subs});});
        cur.menu.append(row);
      }
      if(!counts.length)cur.menu.append(make('p','px-md py-xs text-12 text-neutral-content-weak','No subreddits yet'));
      if(cur.countsFallback||!cur.buckets){const note=make('p','px-md py-xs text-12 text-neutral-content-weak',cur.countsFallback?'Counts from loaded items':'Counting in the archive…');note.dataset.rtCountsNote='true';cur.menu.append(note);}
      if(full)cur.menu.append(make('p','px-md py-xs text-12 text-neutral-content-weak','Up to '+f.maxSubreddits+' subreddits'));
    }

    // ---------- section ----------
    shownItems(cur){
      const f=F(),{ids}=this.visible(),state={...f.empty(),...cur.filters,types:cur.kind==='post'?cur.filters.types:[],subreddits:this.params(cur).subs},ok=f.predicate(state,cur.now);
      return cur.state.items.filter(i=>!ids.has((i.fullname||i.id||'').toLowerCase())&&!ids.has(String(i.id||'').toLowerCase())&&ok(i));
    }
    signature(cur){
      const st=cur.state;return JSON.stringify([this.shownItems(cur).map(i=>i.fullname||i.id),st.expanded,st.loading,st.hasMore,st.searchedBackTo,st.error&&st.error.message,st.items.length]);
    }
    render(cur){
      if(this.current!==cur||!cur.hasText)return;
      const st=cur.state,items=this.shownItems(cur),root=cur.section;cur.sig=this.signature(cur);
      this.place(cur);
      root.replaceChildren();
      const head=make('h2','rt-profile-search-heading text-12 font-semibold text-neutral-content-weak px-md pt-xs','Not in these results · from the archive');root.append(head);
      const list=make('div','rt-profile-search-list');root.append(list);
      const shown=st.expanded?items:items.slice(0,firstCount);
      for(const item of shown)list.append(this.unit(item,cur));
      if(st.loading){const sk=globalThis.RTArchiveView?.skeleton?.({lines:shown.length?1:3});if(sk){const wrap=make('div','px-md');wrap.dataset.rtProfileSearchLoading='true';wrap.append(sk);root.append(wrap);}else root.append(make('p','px-md py-xs text-12 text-neutral-content-weak','Searching the archive…'));}
      if(!st.loading&&!st.error&&!items.length&&st.ran)root.append(make('p','px-md py-xs text-12 text-neutral-content-weak',st.hasMore?'No other matches found yet.':'No other matches in the part of the archive that was searched.'));
      const bar=make('div','flex items-center gap-md px-md py-xs flex-wrap');
      if(!st.expanded&&items.length>firstCount){const b=make('button','rt-profile-search-link text-12 font-semibold text-neutral-content-strong cursor-pointer','Show all ('+items.length+')');b.type='button';b.dataset.rtShowAll='true';b.addEventListener('click',()=>{st.expanded=true;this.render(cur);});bar.append(b);}
      if(st.hasMore&&!st.loading&&!st.error){const b=make('button','rt-profile-search-link text-12 font-semibold text-neutral-content-strong cursor-pointer','Search older');b.type='button';b.dataset.rtSearchOlder='true';b.addEventListener('click',()=>{st.expanded=true;this.run(cur,true);});bar.append(b);}
      if(bar.childElementCount)root.append(bar);
      if(st.error){
        const note=make('p','rt-profile-search-note px-md py-xs text-12 text-neutral-content-weak flex items-center gap-xs',st.error.message+' ');note.dataset.rtProfileSearchError='true';
        const retry=make('button','rt-profile-search-link font-semibold text-neutral-content-strong cursor-pointer','Retry');retry.type='button';retry.dataset.rtRetry='true';retry.addEventListener('click',()=>this.run(cur,st.error.older&&st.cursor!=null));
        note.append(retry);root.append(note);
      }
      if(st.searchedBackTo!=null){const asc=this.params(cur).sort==='asc';const line=make('p','rt-profile-search-back px-md pb-xs text-12 text-neutral-content-weak',(asc?'Searched forward to ':'Searched back to ')+dateText(st.searchedBackTo)+(st.stalled?' · The archive stopped advancing here':''));line.dataset.rtSearchedBack='true';root.append(line);}
    }
    unit(item,cur){
      const comment=item.kind==='comment',status=statusOf(item);
      const unit=make('div','rt-profile-search-unit flex justify-between items-center p-md hover:bg-neutral-background-hover xs:rounded-4 my-2xs relative');
      unit.dataset.testid=comment?'search-sdui-comment-unit':'search-post-unit';unit.dataset.rtArchiveResult=item.fullname||item.id;unit.dataset.rtStatus=status;
      let href=item.permalink||'';try{const u=new URL(href,location.origin);if(/(^|\.)reddit\.com$/i.test(u.hostname))href=u.pathname+u.search;}catch{}
      const link=make('a','absolute inset-0 a hover:underline cursor-pointer');link.href=href;link.rel='noopener nofollow ugc';link.setAttribute('aria-label',item.title||(comment?'Comment by u/'+item.author:'Post'));
      const inner=make('div','w-full flex justify-center flex-col items-start');
      const meta=make('div','text-neutral-content-weak text-12 flex items-center mb-xs relative gap-xs');
      if(item.subreddit){const s=make('span','font-semibold','r/'+item.subreddit);s.dataset.rtSubreddit=item.subreddit;meta.append(s,make('span','','·'));}
      meta.append(make('span','','u/'+item.author),make('span','','·'));
      const ago=make('faceplate-timeago',''),ts=new Date(item.created*1000);ago.setAttribute('ts',ts.toISOString());ago.setAttribute('format','narrow');ago.textContent=relative(item.created,this.clock());meta.append(ago);
      const cue=make('span','rt-profile-search-cue inline-flex items-center gap-2xs ms-xs');cue.dataset.rtStatusCue=status;cue.title=cueTitle[status];cue.setAttribute('role','img');cue.setAttribute('aria-label',cueTitle[status]);
      cue.append(glyph(status),make('span','',cueLabel[status]));meta.append(cue);
      inner.append(meta);
      if(item.title){const t=make('div','text-16 font-semibold text-neutral-content-strong break-words');t.dataset.testid='post-title-text';t.append(highlighted(item.title,cur.parsed));inner.append(t);}
      if(item.body&&!['[deleted]','[removed]'].includes(String(item.body).trim())||comment&&item.body){const body=make('div','text-14 text-neutral-content line-clamp-3 break-words mt-2xs');body.dataset.testid=comment?'search-comment-content':'search-post-snippet';body.append(highlighted(item.body,cur.parsed,0,320));inner.append(body);}
      const counter=make('div','text-12 text-neutral-content-weak flex items-center gap-xs mt-xs');counter.dataset.testid='search-counter-row';
      const votes=make('span','',''),n1=make('faceplate-number','');n1.setAttribute('number',String(item.score||0));n1.textContent=String(item.score||0);votes.append(n1,' votes');counter.append(votes);
      if(!comment){const c=make('span',''),n2=make('faceplate-number','');n2.setAttribute('number',String(item.comments||0));n2.textContent=String(item.comments||0);c.append(n2,' comments');counter.append(make('span','','·'),c);}
      inner.append(counter);unit.append(link,inner);return unit;
    }
  }

  globalThis.RTProfileSearch=Object.freeze({ProfileSearch,routeOf,unitInfo,statusOf});
  if(globalThis.chrome?.runtime?.id&&!globalThis.__rtProfileSearchManual)globalThis.__rtProfileSearch=new ProfileSearch();
})();
