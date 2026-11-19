/* Runs in allowlisted player frames' own page context (Direct embed controls): while the Reddit page asks to block
   embed links (html[data-rt-block-links], set by embed-player.js), the player cannot open its own site in a new tab. */
(() => {
  'use strict';
  if(window.parent===window)return;
  const open=window.open;
  window.open=function(...args){
    if(document.documentElement.hasAttribute('data-rt-block-links'))return null;
    return open.apply(this,args);
  };
})();
