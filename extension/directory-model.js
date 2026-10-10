/* Shared cache schema. Persist identities once; assemble UI records on read. */
(() => {
  const string = value => typeof value === 'string' ? value.slice(0,1000) : '';
  const strings = values => [...new Set((Array.isArray(values) ? values : []).map(string).filter(Boolean))];
  const number = value => Number.isFinite(value) && value >= 0 ? value : 0;
  const image = value => /^https:\/\//.test(value || '') ? string(value) : '';
  function identity(value) {
    if (!value || typeof value.id !== 'string' || !/^@[^:\s]+:[^\s]+$/.test(value.id)) return null;
    return {
      id:string(value.id), name:string(value.name), avatar:image(value.avatar), aliases:strings(value.aliases),
      historicalName:Boolean(value.historicalName), accountUnavailable:Boolean(value.accountUnavailable),
      availabilityKnown:Boolean(value.availabilityKnown || value.accountUnavailable),
      verifiedAt:number(value.verifiedAt), observedAt:number(value.observedAt),
      recoveryCheckedAt:number(value.recoveryCheckedAt), recoveryStatus:string(value.recoveryStatus),
      profileRetryAt:number(value.profileRetryAt), pending:Boolean(value.pending),
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
    return {...other,...winner,name,avatar:winner.avatar || other.avatar,
      aliases:strings([...before.aliases,...incoming.aliases,before.name,incoming.name]),
      historicalName:winner.accountUnavailable ? Boolean(name && name !== '[deleted]') : winner.historicalName,
      availabilityKnown:winner.availabilityKnown || other.availabilityKnown,
      accountUnavailable:winner.availabilityKnown ? winner.accountUnavailable : other.accountUnavailable,
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
        timestamp:number(item.timestamp),membership:string(item.membership),hidden:Boolean(item.hidden),
        status:string(item.status),lastSeq:string(item.lastSeq),identityPending:Boolean(item.identityPending)
      });
    }
    return {schema:2,owner,conversations:[...records.values()],identities,
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
    const identities=entry.identities || {};
    const records=entry.conversations.map(record=>{
      const people=record.participantIds.map(id=>identities[id]).filter(Boolean);
      const direct=['direct','reddit_titled_direct'].includes(record.type);
      const person=direct && people[0];
      return {...record,name:record.name || person?.name || (direct ? 'Username unavailable' : 'Group chat'),
        avatar:record.avatar || person?.avatar || '',participants:people.map(p=>p.name).filter(Boolean),
        aliases:strings([...record.aliases,...people.flatMap(p=>p.aliases)]),identities:people,
        historicalName:Boolean(person?.historicalName),accountUnavailable:Boolean(person?.accountUnavailable)};
    }).sort((a,b)=>b.timestamp-a.timestamp);
    return {...entry,records};
  }
  globalThis.RCSDirectoryModel=Object.freeze({identity,mergeIdentity,normalise,view});
})();
