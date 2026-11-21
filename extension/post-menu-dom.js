/* Reddit's inline post menu and its phone portal mutate independently of the feed. */
(() => {
  'use strict';
  const inline='shreddit-post-overflow-menu',sheet='#post-overflow-menu-bottom-sheet';
  const surface=inline+','+sheet;
  function isMenuMutation(record) {
    if (record.target.closest?.(surface)) return true;
    // Mounting a new inline menu can make a post ready for its extension actions.
    // Mounting or removing just the phone portal does not change any post.
    const {addedNodes,removedNodes}=record;
    return (addedNodes.length>0 || removedNodes.length>0) &&
      Array.prototype.every.call(addedNodes,node=>node.matches?.(sheet)) &&
      Array.prototype.every.call(removedNodes,node=>node.matches?.(sheet));
  }
  globalThis.RTPostMenuDOM=Object.freeze({inline,sheet,isMenuMutation,
    onlyMenuChanges:records=>records.length>0 && records.every(isMenuMutation)});
})();
