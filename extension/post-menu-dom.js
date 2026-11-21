/* Reddit's inline post menu and its phone portal mutate independently of the feed. */
(() => {
  'use strict';
  const inline='shreddit-post-overflow-menu',sheet='#post-overflow-menu-bottom-sheet';
  const overlay=sheet+',dialog[data-rt-raffle="dialog"],[data-rt-download="panel"]';
  const surface=inline+','+overlay;
  function isMenuMutation(record) {
    if (record.target.closest?.(surface)) return true;
    // Mounting a new inline menu can make a post ready for its extension actions.
    // Mounting or removing an overlay does not change any post.
    const {addedNodes,removedNodes}=record;
    return (addedNodes.length>0 || removedNodes.length>0) &&
      Array.prototype.every.call(addedNodes,node=>node.matches?.(overlay)) &&
      Array.prototype.every.call(removedNodes,node=>node.matches?.(overlay));
  }
  function retainAction(portal,selector) {
    const slots=[...portal.querySelectorAll('[slot="devvit-context-actions"]')];
    const keep=slots.find(slot=>slot.querySelector('shreddit-async-loader,hr,li:not([data-rt-raffle],[data-rt-download])')) || slots[0];
    if(!keep)return;
    const items=[...new Set(slots.flatMap(slot=>[...slot.querySelectorAll(selector)]))];
    const survivor=keep.querySelector(selector) || items[0];
    if(!survivor)return;
    // Reddit can add its own loader after projecting the extension-only slot.
    // Move the live row before removing duplicates so a late native slot cannot erase it.
    if(!keep.contains(survivor)){
      if(keep.moveBefore)keep.moveBefore(survivor,null);
      else keep.append(survivor);
    }
    for(const item of items)if(item!==survivor)item.remove();
  }
  globalThis.RTPostMenuDOM=Object.freeze({inline,sheet,isMenuMutation,retainAction,
    onlyMenuChanges:records=>records.length>0 && records.every(isMenuMutation)});
})();
