/* Shared cache schema. Persist identities once; assemble UI records on read. */
(() => {
  const string = value => typeof value === 'string' ? value.slice(0,1000) : '';
  const strings = values => [...new Set((Array.isArray(values) ? values : []).map(string).filter(Boolean))];
  const number = value => Number.isFinite(value) && value >= 0 ? value : 0;
  const image = value => /^https:\/\//.test(value || '') ? string(value) : '';
  // Reddit's chat profile only says isDeleted; the public hover card tells a deleted account from a suspended one.
  const accountStates=['deleted','banned'];
  const accountState=value => accountStates.includes(value) ? value : '';
  // One place for the wording and glyphs, shared by the search UI and the native chat list.
  const markerPaths={
    deleted:'<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l.8 12.2a1.3 1.3 0 0 0 1.3 1.3h6.8a1.3 1.3 0 0 0 1.3-1.3L17.5 7M10 11v6M14 11v6"/>',
    banned:'<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
    unavailable:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 12-7m1 3 5 5m0-5-5 5"/>'
  };
  function accountMarker(state,historical=false) {
    const kind=accountState(state) || 'unavailable',label={deleted:'Deleted account',banned:'Banned account',unavailable:'Unavailable account'}[kind];
    return {kind,label,path:markerPaths[kind],title:label+(historical ? ' · Retained username' : ''),
      detail:label+' · '+(kind==='deleted' ? 'The account was deleted.' : kind==='banned' ? 'Reddit suspended this account.' : 'Deleted or suspended. Does not mean blocked.')+(historical ? ' · Retained username' : '')};
  }
  function identity(value) {
    if (!value || typeof value.id !== 'string' || !/^@[^:\s]+:[^\s]+$/.test(value.id)) return null;
    return {
      id:string(value.id), name:string(value.name), avatar:image(value.avatar), aliases:strings(value.aliases),
      historicalName:Boolean(value.historicalName), accountUnavailable:Boolean(value.accountUnavailable),
      availabilityKnown:Boolean(value.availabilityKnown || value.accountUnavailable),
      verifiedAt:number(value.verifiedAt), observedAt:number(value.observedAt),
      recoveryCheckedAt:number(value.recoveryCheckedAt), recoveryStatus:string(value.recoveryStatus),
      profileRetryAt:number(value.profileRetryAt), pending:Boolean(value.pending),
      accountState:accountState(value.accountState), accountStateCheckedAt:number(value.accountStateCheckedAt),
      provenance:string(value.provenance)
    };
  }
  function mergeIdentity(before, after) {
    const incoming = identity(after); if (!incoming) return before;
    if (!before) return incoming;
    const older = Math.max(incoming.verifiedAt,incoming.observedAt) < Math.max(before.verifiedAt,before.observedAt);
    const winner = older ? before : incoming;
    const other = older ? incoming : before;
    const name = winner.name && !['[deleted]','Someone','Username unavailable'].includes(winner.name) ? winner.name : other.name || winner.name;
    // A deleted account's profile carries Reddit's default avatar. It never replaces a retained image,
    // but a newer record with its own real name (a retained member event) keeps its own avatar.
    const placeholderWinner=!winner.name || ['[deleted]','Someone','Username unavailable'].includes(winner.name);
    const avatar=winner.accountUnavailable && placeholderWinner ? other.avatar || winner.avatar : winner.avatar || other.avatar;
    const unavailable=winner.availabilityKnown ? winner.accountUnavailable : other.accountUnavailable;
    // The classification is a property of the account, not of one scan: a newer record that did not ask keeps it.
    // A live account never carries one.
    return {...other,...winner,name,avatar,accountState:unavailable ? winner.accountState || other.accountState : '',
      accountStateCheckedAt:Math.max(before.accountStateCheckedAt,incoming.accountStateCheckedAt),
      aliases:strings([...before.aliases,...incoming.aliases,before.name,incoming.name]),
      historicalName:winner.accountUnavailable ? Boolean(name && name !== '[deleted]') : winner.historicalName,
      availabilityKnown:winner.availabilityKnown || other.availabilityKnown,
      accountUnavailable:unavailable,
      verifiedAt:Math.max(before.verifiedAt,incoming.verifiedAt), observedAt:Math.max(before.observedAt,incoming.observedAt),
      recoveryCheckedAt:Math.max(before.recoveryCheckedAt,incoming.recoveryCheckedAt)
    };
  }
  function normalise(value, owner) {
    const identities = Object.create(null);
    const supplied = Array.isArray(value?.identities) ? value.identities : Object.values(value?.identities || {});
    for (const item of supplied) {const clean=identity(item);if(clean && clean.id!==owner)identities[clean.id]=mergeIdentity(identities[clean.id],clean);}
    const source = value?.conversations || value?.records;
    if (!Array.isArray(source)) throw Error('Invalid directory');
    const records = new Map();
    for (const item of source) {
      if (!item || typeof item.id !== 'string') continue;
      const participantIds = strings(item.participantIds).filter(id=>id!==owner && /^@[^:\s]+:[^\s]+$/.test(id));
      const type = string(item.type) || (participantIds.length===1 ? 'direct' : 'group');
      const direct = type==='direct';
      for (const person of item.identities || []) {const clean=identity(person);if(clean && clean.id!==owner)identities[clean.id]=mergeIdentity(identities[clean.id],clean);}
      // Migrate v1 names and retained aliases without fetching them again.
      if (direct && participantIds.length===1 && !identities[participantIds[0]]) {
        const id=participantIds[0]; identities[id]=identity({id,name:item.name,avatar:item.avatar,aliases:item.aliases,
          historicalName:item.historicalName,accountUnavailable:item.accountUnavailable,
          verifiedAt:item.identityVerifiedAt || value.fetchedAt,provenance:'saved-directory'});
      }
      records.set(item.id,{
        id:string(item.id),type,participantIds,name:direct && participantIds.length ? '' : string(item.name),
        avatar:direct && participantIds.length ? '' : image(item.avatar),aliases:direct && participantIds.length ? [] : strings(item.aliases),
        timestamp:number(item.timestamp),...(Number.isFinite(item.unreadCount)&&item.unreadCount>=0 ? {unreadCount:item.unreadCount} : {}),membership:string(item.membership),hidden:Boolean(item.hidden),
        status:string(item.status),lastSeq:string(item.lastSeq),identityPending:Boolean(item.identityPending)
      });
    }
    // Deleted/banned answers live in their own map: directory refreshes re-merge
    // identities once per conversation, and must never be able to drop them.
    const states=Object.create(null);
    const keep=(id,state,checked)=>{const kind=accountState(state);if(typeof id!=='string' || !/^@[^:\s]+:[^\s]+$/.test(id) || id===owner || !kind)return;const at=number(checked);if(!states[id] || at>=states[id].checkedAt)states[id]={state:kind,checkedAt:at};};
    for(const [id,item] of Object.entries(value?.accountStates || {}))keep(id,item?.state,item?.checkedAt);
    for(const person of Object.values(identities))if(person.accountState)keep(person.id,person.accountState,person.accountStateCheckedAt);
    return {schema:2,owner,conversations:[...records.values()],identities,accountStates:states,
      directoryComplete:Boolean(value.directoryComplete),
      activityComplete:Boolean(value.activityComplete),
      directoryCursor:typeof value.directoryCursor==='string' ? value.directoryCursor.slice(0,1000) : null,
      activityCursor:typeof value.activityCursor==='string' ? value.activityCursor.slice(0,1000) : null,
      revision:typeof value.revision==='string' ? value.revision.slice(0,1000000) : '',directoryVerifiedAt:number(value.directoryVerifiedAt ?? value.fetchedAt),
      nativeRevision:typeof value.nativeRevision==='string' ? value.nativeRevision : '',
      fetchedAt:number(value.directoryVerifiedAt ?? value.fetchedAt)};
  }
  function view(entry) {
    if (!entry) return null;
    const states=entry.accountStates || {},identities=Object.create(null);
    for(const [id,person] of Object.entries(entry.identities || {})){const known=person.accountUnavailable && states[id];identities[id]=known?{...person,accountState:known.state,accountStateCheckedAt:Math.max(person.accountStateCheckedAt || 0,known.checkedAt || 0)}:person;}
    const records=entry.conversations.map(record=>{
      const people=record.participantIds.map(id=>identities[id]).filter(Boolean);
      const direct=['direct','reddit_titled_direct'].includes(record.type);
      const person=direct && people[0];
      return {...record,name:record.name || person?.name || (direct ? 'Username unavailable' : 'Group chat'),
        avatar:record.avatar || person?.avatar || '',participants:people.map(p=>p.name).filter(Boolean),
        aliases:strings([...record.aliases,...people.flatMap(p=>p.aliases)]),identities:people,
        historicalName:Boolean(person?.historicalName),accountUnavailable:Boolean(person?.accountUnavailable),
        accountState:person?.accountUnavailable ? accountState(person.accountState) : ''};
    }).sort((a,b)=>b.timestamp-a.timestamp);
    return {...entry,identities,records};
  }
  globalThis.RCSDirectoryModel=Object.freeze({identity,mergeIdentity,normalise,view,accountMarker,accountState});
})();
