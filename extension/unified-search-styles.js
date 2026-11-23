/* Styles for the native chat-list unified search shadow root. */
(() => {
  globalThis.RCSUnifiedStyles = `
    :host {
      display:block; position:relative; z-index:1; isolation:isolate; min-width:0;
      color:var(--color-neutral-content-strong,#172328);
      font:var(--rcs-row-title-font);
      --rcs-bg:var(--color-neutral-background,#fff);
      --rcs-soft:var(--color-neutral-background-weak,#f6f8f9);
      --rcs-hover:var(--color-neutral-background-hover,#eff3f5);
      --rcs-text:var(--color-neutral-content-strong,#172328);
      --rcs-muted:var(--color-neutral-content-weak,#52656c);
      --rcs-line:var(--color-neutral-border-weak,#dfe6e9);
      --rcs-border:var(--color-neutral-border-medium,#aabcc4);
      --rcs-selected:var(--color-primary-background-weak,#e9f3f8);
      --rcs-link:var(--color-primary,#126f9e);
      --rcs-focus:var(--color-primary,#167cb0);
      --rcs-accent:#ff4500;
      --rcs-row-title-font:var(--font-12,12px/1.5 var(--font-sans,Arial,sans-serif));
      --rcs-row-preview-font:var(--font-12,12px/1.5 var(--font-sans,Arial,sans-serif));
      --rcs-row-time-font:var(--font-10,10px/1.5 var(--font-sans,Arial,sans-serif));
      --rcs-row-title-color:var(--color-tone-1,var(--rcs-text));
      --rcs-row-preview-color:var(--color-tone-2,var(--rcs-muted));
      --rcs-row-time-color:var(--color-tone-2,var(--rcs-muted));
    }
    :host([hidden]) { display:none !important; }
    * { box-sizing:border-box; }
    [hidden] { display:none !important; }
    button,input { font:inherit; }
    button { color:inherit; cursor:pointer; border:0; background:transparent; }
    button:disabled { cursor:default; opacity:.5; }
    button:focus-visible,a:focus-visible { outline:2px solid var(--rcs-focus); outline-offset:2px; }
    svg { width:16px; height:16px; flex-shrink:0; display:block; }
    .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0; }
    .unified-search { position:relative; padding:0; background:var(--rcs-bg); }
    .bar { display:flex; align-items:center; padding:7px 12px 8px; gap:6px; }
    .field { display:flex; flex:1; min-width:0; height:40px; align-items:center; gap:8px; padding:0 11px; border:1px solid transparent; border-radius:22px; background:var(--rcs-soft); }
    .field:focus-within { border-color:var(--rcs-muted); }
    .field input { width:100%; flex:1; min-width:0; height:38px; margin:0; padding:0; color:var(--rcs-text); background:transparent; border:0; outline:0;font:var(--rcs-row-title-font); }
    .field input::placeholder { color:var(--rcs-muted); opacity:1; }
    .field input::-webkit-search-cancel-button { appearance:none; }
    .field > svg { color:var(--rcs-muted); width:18px; height:18px; }
    .icon,.refresh { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; flex-shrink:0; padding:0; border-radius:50%; color:var(--rcs-muted); }
    .icon:hover,.refresh:hover { background:var(--rcs-hover); color:var(--rcs-text); }
    .field .icon { width:24px; height:24px; }
    .field .icon svg { width:14px; height:14px; }
    .shortcut,kbd { padding:1px 4px; border:1px solid var(--rcs-border); border-radius:4px; color:var(--rcs-muted); font-size:10px; line-height:1.5; }
    .scope { display:flex; gap:4px; margin:0 12px; border-bottom:1px solid var(--rcs-line); }
    .scope-button { display:inline-flex; flex:1; gap:5px; align-items:center; justify-content:center; min-height:36px; padding:7px 6px 9px; border-bottom:2px solid transparent; border-radius:5px 5px 0 0; color:var(--rcs-muted); font-size:12px; font-weight:600; white-space:nowrap; }
    .scope-button:hover { background:var(--rcs-soft); }
    .scope-button.active,.scope-button[aria-selected=true],.scope-button[aria-pressed=true] { color:var(--rcs-text); border-bottom-color:var(--rcs-accent); }
    .scope-button .count { padding:1px 5px; background:var(--rcs-hover); border-radius:9px; font-size:10px; line-height:1.5; font-weight:500; }
    .scope-button.active .count { background:var(--rcs-selected); }
    .tools { display:flex; align-items:center; flex-wrap:wrap; gap:5px; padding:9px 12px 8px; }
    .pill { display:inline-flex; align-items:center; gap:4px; min-height:27px; padding:4px 8px; border:1px solid var(--rcs-line); border-radius:15px; color:var(--rcs-muted); font-size:11px; font-weight:600; white-space:nowrap; }
    .pill svg { width:12px; height:12px; }
    .pill:hover { background:var(--rcs-soft); border-color:var(--rcs-border); }
    .pill.active,.pill[aria-pressed=true],.pill[aria-expanded=true] { background:var(--rcs-selected); border-color:var(--rcs-border); color:var(--rcs-text); }
    .chips { display:flex; flex-wrap:wrap; gap:5px; padding:0 12px 8px; }
    .chips:empty { display:none; }
    .chip { display:inline-flex; align-items:center; gap:5px; min-height:24px; padding:3px 8px; border-radius:14px; color:var(--rcs-text); background:var(--rcs-selected); font-size:10px; }
    .chip button { padding:0; display:flex; }
    .chip svg { width:12px; height:12px; }
    .panel { position:absolute; top:100%; left:0; right:0; height:var(--rcs-list-height,320px); display:flex; flex-direction:column; overflow:hidden; background:var(--rcs-bg); border-bottom:1px solid var(--rcs-line); box-shadow:0 8px 14px #0000000d; }
    .meta { display:flex; align-items:center; justify-content:space-between; gap:8px; min-height:34px; padding:0 15px; color:var(--rcs-muted); font-size:11px; flex-shrink:0; }
    .status { flex:1; min-width:0; }
    .meta strong { color:var(--rcs-text); font-weight:600; }
    .refresh { width:25px; height:25px; }
    .refresh svg { width:14px; height:14px; }
    .results { position:relative; overflow-y:auto; overflow-x:hidden; flex:1; min-height:0; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:var(--rcs-border) transparent; }
    .virtual-spacer { width:100%; pointer-events:none; }
    .row { position:relative; display:flex; align-items:center; gap:11px; width:100%; min-height:78px; padding:12px 15px; text-align:left; background:var(--rcs-bg); border-bottom:1px solid var(--rcs-line); cursor:pointer; }
    .row:hover,.message-row:hover,.recent-row:hover { background:var(--rcs-hover); }
    .row.selected,.message-row.selected,.recent-row.selected { background:var(--rcs-selected); }
    .row.selected::before,.message-row.selected::before { content:''; position:absolute; top:12px; bottom:12px; left:0; width:3px; border-radius:0 3px 3px 0; background:var(--rcs-accent); }
    .row.keyboard-focus,.message-row.keyboard-focus,.recent-row.keyboard-focus { outline:0; box-shadow:none; }
    .avatar { display:flex; align-items:center; justify-content:center; width:36px; height:36px; flex:0 0 36px; overflow:hidden; border-radius:50%; color:var(--rcs-text); background:var(--rcs-hover); font-size:12px; font-weight:600; object-fit:cover; object-position:center; aspect-ratio:1/1; }
    img.avatar { display:block; object-fit:cover; object-position:center; }
    .avatar img { width:100%; height:100%; object-fit:cover; object-position:center; }
    .copy { flex:1; min-width:0; }
    .heading { display:flex; gap:7px; align-items:center; justify-content:space-between; }
    .name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; font-weight:600; color:var(--rcs-text); }
    .time { color:var(--rcs-muted); font-size:10px; white-space:nowrap; font-weight:400; }
    .preview { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:3px; font-size:12px; color:var(--rcs-muted); }
    .caption { display:flex; align-items:center; gap:6px; margin-top:3px; color:var(--rcs-muted); font-size:10px; }
    .unread-dot { width:7px; height:7px; flex-shrink:0; border-radius:50%; background:var(--rcs-accent); }
    mark { padding:0; border-radius:2px; background:#ffcc804d; color:inherit; font-weight:400; }
    .group { padding-bottom:7px; border-bottom:1px solid var(--rcs-line); }
    .group-header { display:flex; align-items:center; gap:9px; padding:12px 15px 6px; }
    .group-header .avatar { width:27px; height:27px; flex-basis:27px; font-size:10px; }
    .group-header .name { font-size:12px; }
    .group-header .time { margin-left:auto; }
    .message-row { display:block; width:100%; position:relative; padding:9px 15px 9px 51px; text-align:left; cursor:pointer; }
    .snippet { font-size:12px; line-height:1.55; color:var(--rcs-text); overflow-wrap:anywhere; font-weight:400; }
    .you-prefix,.sender-prefix { color:var(--rcs-muted); font-weight:400; }
    .message-row .time { float:right; margin:3px 0 0 9px; }
    .message-row::after { content:''; display:block; clear:both; }
    .load-more:hover { text-decoration:underline; }
    .day { position:sticky; top:0; z-index:2; padding:7px 15px; border-bottom:1px solid var(--rcs-line); color:var(--rcs-muted); background:var(--rcs-soft); font-size:10px; font-weight:600; }
    .recent { padding:12px 15px 6px; color:var(--rcs-muted); font-size:11px; font-weight:600; }
    .recent-row { position:relative; display:flex; align-items:center; gap:11px; width:100%; min-height:66px; padding:10px 15px; text-align:left; }
    .empty { padding:35px 22px; text-align:center; color:var(--rcs-muted); font-size:12px; }
    .empty > svg { width:28px; height:28px; margin:0 auto 12px; }
    .empty h3 { color:var(--rcs-text); font-size:14px; margin:0 0 7px; }
    .empty p { margin:0 auto 12px; max-width:270px; line-height:1.55; }
    .empty button { border:1px solid var(--rcs-border); border-radius:17px; font-size:12px; padding:6px 12px; }
    .skeleton { display:flex; gap:11px; padding:17px 15px; min-height:78px; }
    .skeleton::before { content:''; width:36px; height:36px; border-radius:50%; background:var(--rcs-hover); }
    .skeleton::after { content:''; flex:1; height:32px; border-radius:4px; background:linear-gradient(var(--rcs-hover) 0 11px,transparent 11px 20px,var(--rcs-hover) 20px); animation:rcs-pulse 1.4s ease-in-out infinite alternate; }
    @keyframes rcs-pulse { to { opacity:.4; } }
    .menu-item { display:flex; align-items:center; gap:8px; width:100%; padding:9px 8px; border-radius:6px; text-align:left; font-size:12px; }
    .menu-item:hover { background:var(--rcs-hover); }
    .menu-item.active,.menu-item[aria-checked=true] { background:var(--rcs-selected); font-weight:600; }
    .menu-item svg { width:14px; height:14px; }
    .date-popover { z-index:12; right:12px; left:auto; max-width:calc(100% - 24px); }
    :host([data-rcs-compact]) .bar { padding:5px 8px 7px; }
    :host([data-rcs-compact]) .field { height:40px; padding:0 10px; }
    :host([data-rcs-compact]) .scope { margin:0 8px; }
    :host([data-rcs-compact]) .scope-button { font-size:11px; gap:4px; padding:7px 4px 9px; }
    :host([data-rcs-compact]) .tools { padding:8px; gap:4px; }
    :host([data-rcs-compact]) .pill { padding:4px 6px; font-size:10px; }
    :host([data-rcs-compact]) .chips { padding:0 8px 7px; }
    :host([data-rcs-compact]) .row { gap:9px; padding-left:12px; padding-right:12px; }
    :host([data-rcs-compact]) .meta { padding:0 12px; }
    @media (prefers-color-scheme:dark) {
      :host { --rcs-bg:var(--color-neutral-background,#141c20); --rcs-soft:var(--color-neutral-background-weak,#1c282e); --rcs-hover:var(--color-neutral-background-hover,#27363d); --rcs-text:var(--color-neutral-content-strong,#eef3f5); --rcs-muted:var(--color-neutral-content-weak,#b2c0c7); --rcs-line:var(--color-neutral-border-weak,#33434b); --rcs-border:var(--color-neutral-border-medium,#596e79); --rcs-selected:var(--color-primary-background-weak,#233e4a); --rcs-link:var(--color-primary,#76c5ee); --rcs-focus:var(--color-primary,#76c5ee); --rcs-accent:#ff4500; }
    }
    @media (prefers-reduced-motion:reduce) { *,*::before,*::after { animation:none !important; scroll-behavior:auto !important; } }
  `;
})();

/* Shared filter and operator overlays also used by individual-room search. */
(() => {
  globalThis.RCSUnifiedToolStyles = `
    .query-tools-overlay { position:absolute; inset-inline:0; top:100%; width:auto; z-index:20; pointer-events:none; }
    .query-tools-overlay:empty { display:none; }
    .popover { position:absolute; top:calc(100% + 4px); right:8px; width:min(248px,calc(100% - 16px)); max-height:none; overflow:visible; padding:5px; color:var(--rcs-text,#172328); background:var(--rcs-bg,#fff); border:1px solid var(--rcs-line,#dfe6e9); border-radius:12px; box-shadow:0 8px 24px #00000024; z-index:20; }
    .query-tools-overlay .popover { top:4px; pointer-events:auto; }
    .menu-popover { left:auto;right:8px;transform:none;width:min(260px,calc(100% - 16px));max-height:min(520px,75vh);overflow:auto;padding:6px;scrollbar-width:thin;scrollbar-color:var(--rcs-border,#aabcc4) transparent; }
    .menu-popover.menu-popover-tips { display:flex;flex-direction:column;width:min(320px,calc(100% - 16px));padding:0;overflow:hidden; }
    .menu-popover-tips .filter-menu-header { flex:none;margin:0;padding:8px 8px 7px;border-bottom:1px solid var(--rcs-line,#dfe6e9);background:var(--rcs-bg,#fff); }
    .search-tips-body { flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:4px 8px 8px;scrollbar-width:thin;scrollbar-color:var(--rcs-border,#aabcc4) transparent; }
    .search-tips-group-title { margin:6px 2px 3px;font-size:10px;font-weight:700;letter-spacing:.3px;text-transform:uppercase;color:var(--rcs-muted,#52656c); }
    .search-tips-group-title:first-child { margin-top:2px; }
    .menu-title { font-size:11px;color:var(--rcs-text);margin:3px 7px 6px; }
    .menu-section-title { margin:4px 7px; font-size:10px; color:var(--rcs-muted,#52656c); font-weight:600; letter-spacing:.2px; }
    .menu-section-title:not(:first-child) { padding-top:3px; border:0; }
    .menu-option,.menu-choice { box-sizing:border-box; display:flex; align-items:center; gap:8px; width:100%; min-height:32px; padding:6px 7px; color:var(--rcs-text,#172328); text-align:left; border:0; border-radius:6px; background:transparent; font-family:inherit; font-size:12px; line-height:normal; font-weight:400; cursor:pointer; }
    .menu-option:hover { background:var(--rcs-hover,#eff3f5); }
    .menu-option[aria-checked=true],.menu-option.active { background:var(--rcs-soft,#f6f8f9); font-weight:600; }
    .menu-option:focus-visible,.suggestion-option:focus-visible { outline:2px solid var(--rcs-focus,#167cb0); outline-offset:-2px; }
    .control-pill.filter-icon,.control-pill.date-icon,.query-tools-overlay .filter-icon { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; padding:0; border:0; border-radius:50%; color:var(--rcs-muted,#52656c); background:transparent; }
    .control-pill.filter-icon:hover,.control-pill.date-icon:hover { background:var(--rcs-hover,#eff3f5); }
    .control-pill.filter-icon.active,.control-pill.date-icon.active,.filter-icon.active,.filter-icon[aria-pressed=true] { color:var(--rcs-accent,#ff4500); background:var(--rcs-soft,#f6f8f9); }
    .control-pill.filter-icon svg,.control-pill.date-icon svg { width:17px; height:17px; }
    .control-pill.date-icon:disabled { opacity:.35;cursor:default;pointer-events:none;background:transparent;color:var(--rcs-muted,#52656c); }
    .operator-suggestions { top:51px; left:8px; right:8px; width:auto; max-height:min(360px,55vh); overflow:auto; }
    .query-tools-overlay .operator-suggestions { top:4px; left:8px; right:8px; width:auto; }
    .suggestion-option { display:flex; flex-direction:row; align-items:center; gap:9px; padding:7px 9px; line-height:1.4; }
    .suggestion-option[aria-selected=true] { background:var(--rcs-soft,#f6f8f9);box-shadow:none; }
    .query-filter { color:var(--rcs-muted,#52656c); }
    .query-filter.active { color:var(--rcs-accent,#ff4500); background:var(--rcs-soft,#f6f8f9); }
    .operator-option { display:flex;flex-direction:row;align-items:center;gap:8px; }
    .operator-label { flex:1;min-width:0;white-space:nowrap; }
    .operator-option svg { width:15px;height:15px;flex:0 0 15px; }
    .operator-token { display:inline-flex;align-items:center;flex-shrink:0;padding:3px 7px;border:1px solid var(--rcs-line,#dfe6e9);border-radius:6px;color:var(--rcs-accent,#ff4500);background:color-mix(in srgb,var(--rcs-accent,#ff4500) 8%,var(--rcs-bg,#fff));font:inherit;font-size:11px;font-weight:500; }
    .search-tip { display:grid;grid-template-columns:76px minmax(0,1fr);align-items:start;gap:4px 8px;min-height:0;padding:6px 4px;border-radius:0;border-bottom:1px solid color-mix(in srgb,var(--rcs-line,#dfe6e9) 55%,transparent);cursor:default;font-size:12px;line-height:1.35; }
    .search-tip:last-of-type { border-bottom:0; }
    .search-tip:hover { background:transparent; }
    .search-tip .operator-token { justify-self:start;padding:2px 6px;font-size:10.5px;line-height:1.3;white-space:nowrap; }
    .search-tip-copy { display:flex;min-width:0;flex-direction:column;gap:2px; }
    .search-tip-label { color:var(--rcs-text,#172328);font-size:11.5px;font-weight:500;line-height:1.3; }
    .search-tip-copy small,.search-tip-example { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:10.5px;line-height:1.3;color:var(--rcs-muted,#52656c);overflow-wrap:anywhere; }
    .search-tip-note { margin:8px 0 2px;padding:7px 9px;border-radius:8px;background:var(--rcs-soft,#f6f8f9);font-size:11px;line-height:1.45;color:var(--rcs-muted,#52656c); }
    :host([data-rcs-compact]) .menu-popover.menu-popover-tips { width:min(300px,calc(100% - 16px)); }
    :host([data-rcs-compact]) .search-tip { grid-template-columns:68px minmax(0,1fr);gap:2px 6px;padding:5px 2px; }
    :host([data-rcs-compact]) .search-tip .operator-token { font-size:10px;padding:2px 5px; }
    :host([data-rcs-compact]) .search-tip-label { font-size:11px; }
    :host([data-rcs-compact]) .search-tip-example { font-size:10px; }
    :host([data-rcs-compact]) .search-tip-note { font-size:10.5px;padding:6px 8px; }
    .operator-suggestions .operator-label { overflow:hidden;text-overflow:ellipsis; }
    .sender-chips { display:flex;align-items:center;flex-wrap:wrap;gap:5px;min-width:0;max-width:100%;padding:6px 12px 8px; }
    .sender-chips:empty { display:none; }
    .field.has-senders { height:auto;min-height:40px;flex-wrap:wrap;row-gap:4px;padding-top:5px;padding-bottom:5px;border-radius:18px; }
    .field.has-senders input { height:28px; }
    .field .sender-chips { flex-basis:100%;width:100%;padding:0;gap:4px; }
    .sender-result.result-row { height:100%; }
    .sender-result .row-top { display:flex;align-items:center;gap:6px; }
    .sender-result .row-title { flex:1;min-width:0; }
    .sender-result .row-time { flex-shrink:0;white-space:nowrap;color:var(--rcs-muted);font-size:10px; }
    .sender-result .row-snippet { display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--rcs-muted);margin-top:4px; }
    .sender-result .row-meta { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .sender-chip { display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:100%;min-height:27px;padding:3px 6px 3px 8px;border:1px solid color-mix(in srgb,var(--rcs-accent,#ff4500) 25%,var(--rcs-line,#dfe6e9));border-radius:999px;background:color-mix(in srgb,var(--rcs-accent,#ff4500) 8%,var(--rcs-bg,#fff));color:var(--rcs-text,#172328);font-size:11px;line-height:1.4; }
    .sender-chip-icon { flex:none;width:14px;height:14px;color:var(--rcs-muted,#52656c); }
    .sender-chip-value { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .sender-chip-avatar { display:grid;place-items:center;flex:0 0 18px;width:18px;height:18px;overflow:hidden;object-fit:cover;border-radius:50%;background:var(--rcs-hover,#eff3f5);font-size:9px; }
    .sender-chip-avatar img { width:100%;height:100%;object-fit:cover; }
    .sender-chip button { display:inline-flex;align-items:center;justify-content:center;flex:0 0 20px;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--rcs-muted,#52656c);cursor:pointer; }
    .sender-chip button:hover { color:var(--rcs-text,#172328);background:var(--rcs-hover,#eff3f5); }
    .sender-chip button svg { width:12px;height:12px; }
    .sender-chip button:focus-visible { outline:2px solid var(--rcs-focus,#167cb0);outline-offset:1px; }
    mark { background:#ffcc804d;color:inherit;border-radius:2px;font-weight:400; }
    .link-snippet { line-break:anywhere; }
    .menu-choice-row { display:grid;grid-template-columns:minmax(0,1fr);gap:0;padding:0; }
    .menu-choice { min-width:0; }
    .menu-choice:hover { background:var(--rcs-hover); }
    .menu-choice[aria-checked=true],.menu-option[aria-checked=true] { background:color-mix(in srgb,var(--rcs-accent,#ff4500) 7%,var(--rcs-bg,#fff));color:var(--rcs-text);font-weight:600; }
    .menu-choice[aria-checked=true]:hover,.menu-option[aria-checked=true]:hover { background:color-mix(in srgb,var(--rcs-accent,#ff4500) 11%,var(--rcs-bg,#fff)); }
    .menu-choice:disabled{color:var(--rcs-muted);border-color:transparent;background:transparent;cursor:default}
    .filter-menu-header{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:3px}
    .filter-menu-header .menu-title{margin-bottom:3px;flex:1}
    .menu-back{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;min-height:22px;padding:0;flex:none;border:0;border-radius:50%;background:transparent;box-shadow:none;color:var(--rcs-muted,#52656c);cursor:pointer}
    .menu-back:hover{background:var(--rcs-hover,#eff3f5)}
    .menu-back:focus-visible{outline:2px solid color-mix(in srgb,var(--rcs-accent,#ff4500) 60%,transparent);outline-offset:1px}
    .menu-back svg{width:13px;height:13px;transform:rotate(90deg)}
    .menu-selection{font-size:10px;color:var(--rcs-muted);white-space:nowrap}
    .operator-option>svg:last-child{width:12px;height:12px;transform:rotate(-90deg)}
    .menu-reset{display:inline-flex;align-items:center;justify-content:center;min-width:0;width:auto;height:auto;min-height:0;font:inherit;font-size:11px;line-height:1.4;color:var(--rcs-accent,#ff4500);padding:4px 6px;border:0;border-radius:5px;background:transparent;box-shadow:none;cursor:pointer}
    .menu-reset:hover{background:var(--rcs-hover)}
    .menu-reset:disabled{color:var(--rcs-muted,#52656c);opacity:.55;cursor:default;background:transparent}
    .menu-choice>svg{width:15px;height:15px;flex:none}
    .menu-choice-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:inherit}
    .menu-option-count{flex:none;font-size:9px;font-variant-numeric:tabular-nums;color:var(--rcs-muted)}
    .row-snippet,.row-title,.menu-choice-label{ text-overflow:ellipsis; }
    .row-title mark,.row-snippet mark,.menu-choice-label mark{color:inherit}
    .row-meta.unavailable-marker{overflow:visible;display:inline-flex;align-items:center;flex:none;width:14px;max-width:14px}
    .row-meta.unavailable-marker svg{width:12px;height:12px}
    .sender-result { display:flex;align-items:center;gap:11px;width:100%;height:64px;padding:10px 14px;color:var(--rcs-text);background:var(--rcs-bg);border:0;text-align:left;cursor:pointer; }
    .sender-result:hover { background:var(--rcs-hover); }
    .sender-result.keyboard-focus { box-shadow:none; }
    .sender-result .avatar { display:grid;place-items:center;object-fit:cover;flex:0 0 36px;width:36px;height:36px;border-radius:50%;background:var(--rcs-soft);color:var(--rcs-muted);font-size:12px; }
    .sender-result .row-main { flex:1;min-width:0; }
    .sender-result .row-title { display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:400; }
    .sender-result .row-meta { display:block;margin-top:2px;font-size:10px;color:var(--rcs-muted); }
    .query-tools-overlay [hidden] { display:none !important; }
  `;
  globalThis.RCSUnifiedStyles += `
    :host { z-index:1; isolation:isolate; }
    .bar.unified-search { display:block; padding:0 12px; container:rcs-search / inline-size; }
    .bar.unified-search .search-toolbar { display:flex;align-items:center;height:var(--rcs-native-header-height,52px); }
    .bar.unified-search .field { width:100%; height:clamp(28px,calc(var(--rcs-native-header-height,52px) - 12px),40px); }
    .bar.unified-search .field input { height:100%;max-height:100%; }
    .field .search-controls { display:flex;flex-wrap:nowrap;gap:1px;padding:0;margin:0;flex-shrink:0; }
    .field .control-pill { padding:0;border:0;border-radius:50%;width:26px;height:26px;min-height:26px; }
    .field .control-pill svg { width:16px;height:16px; }
    .field .control-pill.active { color:var(--rcs-accent);background:color-mix(in srgb,var(--rcs-accent) 12%,var(--rcs-bg)); }
    .field .control-pill:hover { background:var(--rcs-hover); }
    .field input { font:var(--rcs-row-title-font); }
    .search-icon { display:flex;align-items:center;justify-content:center;flex:0 0 24px;width:24px;height:28px;padding:0;border:0;border-radius:50%;color:var(--rcs-muted);background:transparent; }
    .search-icon:hover { background:var(--rcs-hover); }
    .search-icon svg { width:18px; height:18px; }
    .scope.scope-tabs { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:stretch;gap:4px;margin:5px 0 0;padding:0;border-bottom:1px solid var(--rcs-line); }
    /* Keep a compact count slot so counts do not shift or clip centered labels. */
    .scope-tab { position:relative;isolation:isolate;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:minmax(1.2em,auto) .65em;align-items:start;justify-items:center;gap:0;min-width:0;width:100%;max-width:100%;padding:3px 2px;min-height:28px;border:0;border-bottom:2px solid transparent;border-radius:0;color:var(--rcs-muted);font-weight:500;background-clip:padding-box;font-size:var(--rcs-row-title-size,12px); }
    .scope-count { display:block;grid-column:1;grid-row:2;width:5ch;max-width:100%;white-space:nowrap;overflow-wrap:normal;word-break:normal;text-align:center;font-size:calc(var(--rcs-row-title-size,12px) * .65);line-height:1;font-weight:400;font-variant-numeric:tabular-nums; }
    .scope-label { grid-column:1;grid-row:1;max-width:100%;line-height:1.2;text-align:center;white-space:normal;overflow-wrap:anywhere; }
    /* Wider chat lists have room for a count beside a separately centered label. */
    @container rcs-search (min-width:36em) {
      .scope-tab { grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);grid-template-rows:auto;align-items:center; }
      .scope-label { grid-column:2; }
      .scope-count { grid-column:3;grid-row:1;justify-self:start;margin-inline-start:3px; }
    }
    .scope-tab:hover { background:transparent;border-bottom-color:color-mix(in srgb,var(--rcs-accent) 35%,transparent); }
    .scope-tab.active,.scope-tab[aria-selected=true] { background:transparent;color:var(--rcs-text);border-bottom-color:var(--rcs-accent);font-weight:600; }
    .bar.unified-search .global-filter-rail { display:flex;align-items:center;flex-wrap:nowrap;gap:6px;width:100%;height:32px;min-height:32px;min-width:0;overflow:hidden;padding:3px 0;justify-content:flex-start; }
    .bar.unified-search .global-filter-rail:empty,.bar.unified-search .global-filter-rail[hidden] { display:none; }
    .bar.unified-search .global-filter-rail > .sender-chip { display:inline-flex;align-items:center;flex:0 0 auto;gap:5px;min-width:0;max-width:min(260px,75vw);min-height:25px;padding:2px 4px 2px 8px;border:1px solid color-mix(in srgb,var(--rcs-accent) 22%,var(--rcs-line));border-radius:999px;background:color-mix(in srgb,var(--rcs-accent) 6%,var(--rcs-bg));color:var(--rcs-text);font-size:var(--rcs-row-time-size,10px);line-height:1.35; }
    .bar.unified-search .global-filter-rail > .filter-chip { display:inline-flex;align-items:center;flex:0 0 auto;gap:5px;min-width:0;max-width:min(260px,75vw);min-height:25px;padding:2px 4px 2px 8px;border:1px solid color-mix(in srgb,var(--rcs-accent) 22%,var(--rcs-line));border-radius:999px;background:color-mix(in srgb,var(--rcs-accent) 6%,var(--rcs-bg));color:var(--rcs-text);font-size:var(--rcs-row-time-size,10px);line-height:1.35; }
    .bar.unified-search .global-filter-rail > .filter-chip > span { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .bar.unified-search .global-filter-rail > .filter-chip > button { order:10;display:inline-flex;align-items:center;justify-content:center;flex:0 0 18px;width:18px;height:18px;margin-left:1px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--rcs-muted); }
    .bar.unified-search .global-filter-rail > .filter-chip > button:hover { background:var(--rcs-hover);color:var(--rcs-text); }
    .bar.unified-search .global-filter-rail > .filter-chip > button svg { width:11px;height:11px; }
    .bar.unified-search .global-filter-rail .sender-chip-value { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .bar.unified-search .global-filter-rail .sender-chip-avatar { display:grid;place-items:center;flex:0 0 17px;width:17px;height:17px;overflow:hidden;object-fit:cover;border-radius:50%;background:var(--rcs-hover);font-size:9px; }
    .bar.unified-search .global-filter-rail .sender-chip-avatar img { width:100%;height:100%;object-fit:cover; }
    .bar.unified-search .global-filter-rail .sender-chip > button { order:10;display:inline-flex;align-items:center;justify-content:center;flex:0 0 18px;width:18px;height:18px;margin-left:1px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--rcs-muted); }
    .bar.unified-search .global-filter-rail .sender-chip > button:hover { background:var(--rcs-hover);color:var(--rcs-text); }
    .bar.unified-search .global-filter-rail .sender-chip > button svg { width:11px;height:11px; }
    .bar.unified-search .global-filter-rail > .global-filter-add { display:inline-flex;align-items:center;justify-content:center;flex:0 0 24px;width:24px;height:24px;padding:0;border:1px solid var(--rcs-line);border-radius:50%;background:var(--rcs-bg);color:var(--rcs-muted); }
    .bar.unified-search .global-filter-rail > .global-filter-add:hover { background:var(--rcs-hover);color:var(--rcs-text); }
    .bar.unified-search .global-filter-rail > .global-filter-add svg { width:13px;height:13px; }
    .bar.unified-search .operator-suggestions { top:47px;left:8px;right:8px;width:auto;max-height:min(280px,55vh);overflow:auto;padding:4px;border-radius:10px; }
    .bar.unified-search .operator-suggestions .suggestion-option { min-height:32px;gap:7px;padding:5px 7px;border-radius:6px;font-size:12px; }
    .bar.unified-search .operator-suggestions .operator-token { padding:2px 6px;font-size:10px; }
    :host([data-rcs-ui="list"]) .global-sender-result { position:relative;display:flex;align-items:center;gap:9px;width:100%;height:52px;min-height:52px;padding:6px 12px;border:0;background:var(--rcs-bg);color:var(--rcs-text);text-align:left; }
    :host([data-rcs-ui="list"]) .global-sender-result.with-preview,:host([data-rcs-ui="list"]) .global-sender-result:has(.row-snippet,.row-meta) { height:64px;min-height:64px; }
    :host([data-rcs-ui="list"]) .global-sender-result:hover { background:var(--rcs-hover); }
    :host([data-rcs-ui="list"]) .global-sender-result[aria-selected=true],:host([data-rcs-ui="list"]) .global-sender-result.selected { background:var(--rcs-selected); }
    :host([data-rcs-ui="list"]) .global-sender-result[aria-selected=true]::before,:host([data-rcs-ui="list"]) .global-sender-result.selected::before { content:'';position:absolute;inset-block:8px;left:0;width:4px;border-radius:0 3px 3px 0;background:var(--rcs-accent); }
    :host([data-rcs-ui="list"]) .global-sender-result.keyboard-focus { outline:0;box-shadow:none; }
    :host([data-rcs-ui="list"]) .global-sender-result .avatar { display:grid;place-items:center;flex:0 0 36px;width:36px;height:36px;overflow:hidden;object-fit:cover;border-radius:50%;background:var(--rcs-soft);color:var(--rcs-muted);font-size:12px; }
    :host([data-rcs-ui="list"]) .global-sender-result .row-main { flex:1;min-width:0; }
    :host([data-rcs-ui="list"]) .global-sender-result .row-title { display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--rcs-text);font-size:12px;font-weight:400; }
    :host([data-rcs-ui="list"]) .global-sender-result .row-meta { display:block;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--rcs-muted);font-size:10px; }
    .results { overflow-anchor:none;scrollbar-gutter:stable;outline:0; }
    .virtual-spacer,.virtual-item { overflow-anchor:none; }
    .panel { box-shadow:none; }
    .search-controls { display:flex; align-items:center; flex-wrap:wrap; gap:5px; padding:5px 0; min-height:38px; }
    .control-pill { display:inline-flex; align-items:center; gap:5px; padding:4px 8px; min-height:27px; color:var(--rcs-muted); border:1px solid var(--rcs-line); border-radius:15px; font-size:11px; }
    .control-pill:hover { background:var(--rcs-soft); }
    .control-pill.active { background:var(--rcs-selected); color:var(--rcs-text); }
    .active-filters:empty { display:none; }
    .active-filters { display:flex; flex-wrap:wrap; gap:5px; padding:0 0 8px; }
    .filter-chip { display:inline-flex; align-items:center; gap:5px; padding:3px 7px; color:var(--rcs-text); background:var(--rcs-selected); border-radius:14px; font-size:10px; }
    .filter-chip button { display:flex; padding:0; }
    .filter-chip svg { width:12px; height:12px; }
    .icon-button { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; flex-shrink:0; padding:0; border-radius:50%; color:var(--rcs-muted); }
    .icon-button:hover { background:var(--rcs-hover); color:var(--rcs-text); }
    .field .icon-button { width:24px; height:24px; }
    .field .icon-button svg { width:14px; height:14px; }
    .results-status { display:flex; align-items:center; justify-content:space-between; gap:6px; min-height:24px;padding:0 8px;color:var(--rcs-muted);font:var(--rcs-row-time-font);flex-shrink:0; }
    .results-status .status { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .results-status .coverage-note { flex:none;opacity:.85;font-style:italic;white-space:nowrap; }
    .results-status .coverage-note[hidden] { display:none; }
    .results-status .backfill-action { flex:none;height:20px;padding:0 7px;border:1px solid var(--rcs-line);border-radius:999px;background:var(--rcs-bg);color:var(--rcs-text);font:inherit;font-weight:600;white-space:nowrap;cursor:pointer;line-height:18px; }
    .results-status .backfill-action:hover { background:var(--rcs-hover); }
    .results-status .backfill-action[hidden] { display:none; }
    .results-status .icon-button { width:20px;height:20px;flex:none; }
    .results-status .icon-button svg { width:12px;height:12px; }
    .result-row { position:relative; display:flex; align-items:center; gap:var(--rcs-row-gap,var(--spacer-xs,8px)); width:100%; height:var(--rcs-row-min-height,64px);padding:var(--rcs-row-padding-block,var(--spacer-xs,8px)) var(--rcs-row-padding-inline,var(--spacer-sm,12px));text-align:left; background:var(--rcs-bg); border:0; }
    .chat-result { height:100%; }
    .result-row:hover,.message-result:hover,.recent-row:hover { background:var(--rcs-hover); }
    .result-row.selected,.message-result.selected { background:var(--rcs-soft); }
    .result-row.selected::before,.message-result.selected::before { content:'';position:absolute;inset-block:10px;left:0;width:3px;border-radius:0 3px 3px 0;background:var(--rcs-accent); }
    .result-row.keyboard-focus,.message-result.keyboard-focus { box-shadow:none; outline:0; }
    .message-result.keyboard-focus > .message-open:focus-visible { outline:0; }
    .row-main { display:block; flex:1; min-width:0; }
    .row-top { display:flex; align-items:center; gap:6px; }
    .row-title { display:block; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--rcs-row-title-color);font:var(--rcs-row-title-font);text-align:left; }
    .result-row.unread .row-title,.result-row.unread .row-snippet { font-weight:700;color:var(--rcs-row-title-color); }
    .row-time { display:block;flex-shrink:0;color:var(--rcs-row-time-color);font:var(--rcs-row-time-font);white-space:nowrap; }
    .row-snippet { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:var(--rcs-row-body-gap,var(--spacer-4xs,2px));color:var(--rcs-row-preview-color);font:var(--rcs-row-preview-font); }
    .row-snippet.row-snippet-stale { opacity:.62; }
    .row-meta { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--rcs-muted); font-size:10px; margin-top:3px; }
    .message-result { position:relative;display:flex;align-items:flex-start;height:auto;min-height:var(--rcs-row-min-height,64px);padding:var(--rcs-row-padding-block,var(--spacer-xs,8px)) var(--rcs-row-padding-inline,var(--spacer-sm,12px));border:0; }
    .message-open { display:flex;align-items:flex-start;gap:var(--rcs-row-gap,var(--spacer-xs,8px));width:100%;height:auto;padding:0; text-align:left; }
    .row-image-preview { margin-top:4px; }
    .chat-result .avatar,.message-open .avatar { flex:0 0 var(--rcs-row-avatar-size,var(--size-xl,32px));width:var(--rcs-row-avatar-size,var(--size-xl,32px));height:var(--rcs-row-avatar-size,var(--size-xl,32px)); }
    .message-copy { display:flex; flex:1; flex-direction:column; justify-content:flex-start;gap:var(--rcs-row-body-gap,var(--spacer-4xs,2px));min-width:0; }
    .message-heading { display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:baseline;column-gap:var(--rcs-row-gap,var(--spacer-xs,8px));min-width:0; }
    .message-name { min-width:0;overflow:hidden;display:block;white-space:nowrap;text-overflow:ellipsis; }
    .message-identity { display:flex; align-items:center; gap:4px; min-width:0; }
    .unavailable-marker { display:inline-flex; flex:none; color:var(--rcs-row-time-color,var(--rcs-muted)); }
    .unavailable-marker svg { width:12px; height:12px; }
    .message-open .row-time { flex:0 0 auto;margin-left:auto; }
    .message-open .snippet { white-space:normal; overflow-wrap:anywhere; word-break:normal; font-weight:400; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:3; overflow:hidden;color:var(--rcs-row-preview-color);font:var(--rcs-row-preview-font);max-height:calc(3 * var(--rcs-row-preview-line-height,1.5em)); }
    .day-heading { position:sticky; top:0; z-index:2; display:flex; align-items:center; gap:12px; margin:0; padding:0 14px; color:var(--rcs-muted); background:var(--rcs-bg); border:0;font:var(--rcs-row-time-font);font-weight:600; }
    .day-heading::before,.day-heading::after { content:""; flex:1; height:1px; background:var(--rcs-line); }
    .recent-heading { margin:0; height:32px; padding:9px 14px 5px; color:var(--rcs-muted); font-size:11px; font-weight:600; }
    .recent-hint { margin:0; padding:7px 14px; color:var(--rcs-muted); font-size:11px; line-height:1.5; }
    .recent-row { height:42px; min-height:42px; padding:6px 14px; justify-content:space-between; }
    .recent-row > button:first-child { display:flex; align-items:center; gap:8px; flex:1; min-width:0; padding:0; text-align:left; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .recent-row svg { width:14px; height:14px; }
    .empty-state { padding:30px 20px; text-align:center; color:var(--rcs-muted); font-size:12px; }
    .empty-state > svg { margin:0 auto 12px; width:28px; height:28px; }
    .empty-state h2 { margin:0 0 6px; color:var(--rcs-text); font-size:14px; }
    .empty-state p { margin:0 0 12px; font-size:11px; line-height:1.55; }
    :host([data-rcs-compact]) .bar.unified-search { display:block; padding:0 14px; }
    :host([data-rcs-compact]) .scope.scope-tabs { gap:4px;margin:5px 0 0;padding:0;border-bottom:1px solid var(--rcs-line); }
  ` + globalThis.RCSUnifiedToolStyles + (globalThis.RCSMediaPreview?.styles || "");
})();

(() => {
  const rail=`
    .scope-tab:focus-visible{outline:2px solid var(--rcs-focus,#167cb0);outline-offset:-2px;box-shadow:none}
    .result-row:focus-visible,.message-open:focus-visible,.sender-result:focus-visible,.recent-row:focus-visible,.recent-row button:focus-visible{outline:0;box-shadow:none}
    .row.keyboard-focus,.message-row.keyboard-focus,.recent-row.keyboard-focus,.result-row.keyboard-focus,.message-result.keyboard-focus,.sender-result.keyboard-focus,.suggestion-option[aria-selected=true]{position:relative;outline:0;box-shadow:none}
    .result-row.selected:not(.selection-rail),.message-result.selected:not(.selection-rail){background:var(--rcs-bg)}
    .result-row.selected:not(.selection-rail):hover,.message-result.selected:not(.selection-rail):hover{background:var(--rcs-hover)}
    .result-row.selection-rail,.message-result.selection-rail{background:var(--rcs-soft)}
    .row.selected::before,.message-row.selected::before,.result-row.selected::before,.message-result.selected::before,:host([data-rcs-ui="list"]) .global-sender-result.selected::before{content:none}
    .selection-rail::before,.sender-result.keyboard-focus::before,.recent-row.keyboard-focus::before,.suggestion-option[aria-selected=true]::before{content:'';position:absolute;top:8px;bottom:8px;left:0;width:3px;height:auto;transform:none;border-radius:0 3px 3px 0;background:color-mix(in srgb,var(--rcs-accent,#ff4500) 35%,transparent)}
    .result-row.selection-rail::before,.message-result.selection-rail::before,:host([data-rcs-ui="list"]) .global-sender-result.selection-rail::before{content:'';top:8px;bottom:8px;height:auto;background:color-mix(in srgb,var(--rcs-accent,#ff4500) 35%,transparent)}
    .result-row.selection-rail.selected:not(.keyboard-preview)::before,.message-result.selection-rail.selected:not(.keyboard-preview)::before{background:var(--rcs-accent,#ff4500)}
    :host([data-rcs-ui="list"]) .global-sender-result .row-title{font:var(--rcs-row-title-font);color:var(--rcs-row-title-color)}
    :host([data-rcs-ui="list"]) .global-sender-result .row-snippet{font:var(--rcs-row-preview-font);color:var(--rcs-row-preview-color)}
    :host([data-rcs-ui="list"]) .global-sender-result .row-time{font:var(--rcs-row-time-font);color:var(--rcs-row-time-color)}
    :host([data-rcs-ui="list"]) .global-sender-result .avatar{flex-basis:var(--rcs-row-avatar-size,var(--size-xl,32px));width:var(--rcs-row-avatar-size,var(--size-xl,32px));height:var(--rcs-row-avatar-size,var(--size-xl,32px))}
    :host([data-rcs-ui="list"]) .global-sender-result,:host([data-rcs-ui="list"]) .global-sender-result.with-preview,:host([data-rcs-ui="list"]) .global-sender-result:has(.row-snippet,.row-meta){height:100%;min-height:0;padding:var(--rcs-row-padding-block,var(--spacer-xs,8px)) var(--rcs-row-padding-inline,var(--spacer-sm,12px));gap:var(--rcs-row-gap,var(--spacer-xs,8px))}
    .row-secondary{display:flex;align-items:center;gap:var(--rcs-row-gap,var(--spacer-xs,8px));min-width:0;margin-top:var(--rcs-row-body-gap,var(--spacer-4xs,2px))}
    .row-secondary .row-snippet,.row-secondary .row-image-preview{flex:1;min-width:0;margin-top:0}
    .row-secondary .row-meta{flex:none;max-width:45%;margin-top:0;font-size:var(--rcs-row-time-size,10px)}

  `;
  globalThis.RCSLoadingStyles=`
    .skeleton-row { display:flex; align-items:flex-start; gap:var(--rcs-row-gap,var(--spacer-xs,8px)); padding:var(--rcs-row-padding-block,var(--spacer-xs,8px)) var(--rcs-row-padding-inline,var(--spacer-sm,12px)); min-height:var(--rcs-row-min-height,64px); box-sizing:border-box; }
    .skeleton-shimmer { position:relative; display:block; overflow:hidden; background:var(--color-shimmer-background,var(--rcs-hover)); border-radius:4px; }
    .skeleton-avatar { flex:none; width:var(--rcs-row-avatar-size,var(--size-xl,32px)); height:var(--rcs-row-avatar-size,var(--size-xl,32px)); border-radius:50%; }
    .skeleton-copy { display:flex; flex:1; min-width:0; flex-direction:column; gap:9px; padding-top:3px; }
    .skeleton-title { width:55%; height:12px; }
    .skeleton-preview { width:86%; height:11px; }
    .skeleton-fallback::after { content:""; position:absolute; inset:0; transform:translateX(-100%); background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--color-neutral-background,#fff) 55%,transparent),transparent); animation:rcs-result-shimmer 1.5s ease-in-out infinite; }
    @keyframes rcs-result-shimmer { to { transform:translateX(100%); } }
    @media(prefers-reduced-motion:reduce) { .skeleton-fallback::after { display:none; } }
  `;
  globalThis.RCSRefreshStyles=`
    .rcs-refresh{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;min-height:20px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--rcs-muted);cursor:pointer}
    .rcs-refresh:hover{background:var(--rcs-hover);color:var(--rcs-text)}
    .rcs-refresh .refresh-motion > svg{display:block;width:12px;height:12px}
    .rcs-refresh .refresh-motion{display:grid;place-items:center;width:12px;height:12px;flex:none;transform-origin:50% 50%;backface-visibility:hidden}
    .rcs-refresh.busy .refresh-motion{will-change:transform;animation:rcs-refresh-busy 1.2s linear infinite}
    @keyframes rcs-refresh-busy{from{transform:translate3d(0,0,0) rotate(0deg)}to{transform:translate3d(0,0,0) rotate(360deg)}}
    @media(prefers-reduced-motion:reduce){.rcs-refresh.busy .refresh-motion{animation:none}}
  `;
  globalThis.RCSUnifiedStyles+=globalThis.RCSRefreshStyles+globalThis.RCSLoadingStyles;
  globalThis.RCSUnifiedStyles+=rail;
  globalThis.RCSUnifiedToolStyles+=rail;
  // Apply the same control geometry after each host's layout rules. In
  // particular, room .icon rules must not shrink its filter/date glyphs.
  const searchSizing=`
    :host([data-rcs-ui]) .bar.unified-search { padding-inline:8px; }
    :host([data-rcs-ui]) .field { height:clamp(28px,calc(var(--rcs-native-header-height,52px) - 12px),40px);padding:0 10px;gap:8px;border-radius:22px;font:var(--rcs-row-title-font,var(--font-12,12px/1.5 var(--font-sans,Arial,sans-serif))); }
    :host([data-rcs-ui]) .field input { flex:1;min-width:0;width:0;height:100%;max-height:100%;padding:0;margin:0;font:inherit; }
    :host([data-rcs-ui]) .field .search-controls { min-height:0; }
    :host([data-rcs-ui]) .field :is(.icon,.icon-button) { width:24px;height:24px; }
    :host([data-rcs-ui]) .field :is(.icon,.icon-button) svg { width:14px;height:14px; }
    :host([data-rcs-ui]) .field :is(.search-icon,[aria-label="Search"]) { width:24px;height:28px; }
    :host([data-rcs-ui]) .field :is(.search-icon,[aria-label="Search"]) svg { width:18px;height:18px; }
    :host([data-rcs-ui]) .field :is(.filter-icon,.date-icon,.room-filter-toggle,.room-date-toggle) { display:inline-flex;align-items:center;justify-content:center;flex:0 0 26px;width:26px;height:26px;min-height:26px;padding:0;font:inherit; }
    :host([data-rcs-ui]) .field :is(.filter-icon,.date-icon,.room-filter-toggle,.room-date-toggle) svg { width:16px;height:16px; }
    :host([data-rcs-ui]) .menu-popover { width:min(260px,calc(100% - 16px));max-height:min(520px,75vh);padding:6px;font:var(--rcs-row-title-font,var(--font-12,12px/1.5 var(--font-sans,Arial,sans-serif))); }
    .room-menu-choice { display:flex;align-items:center;gap:8px; }
    .room-menu-choice>svg,.room-menu-choice>.avatar { width:22px;height:22px;flex:0 0 22px; }
    .room-menu-choice>.avatar,img.avatar { display:block;border-radius:50%;object-fit:cover;object-position:center;aspect-ratio:1/1; }
    .room-menu-choice>span { flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis; }
    :host([data-rcs-ui]) :is(.global-filter-rail,.room-applied-filters) > .sender-chip { min-height:25px;padding:2px 4px 2px 8px;font-size:var(--rcs-row-time-size,10px);line-height:1.35; }
    :host([data-rcs-ui]) .sender-chip-avatar { flex:0 0 17px;width:17px;height:17px; }
    :host([data-rcs-ui]) :is(.global-filter-rail,.room-applied-filters) .sender-chip > button { flex:0 0 18px;width:18px;height:18px; }
    :host([data-rcs-ui]) :is(.global-filter-rail,.room-applied-filters) .sender-chip > button svg { width:11px;height:11px; }
  `;
  globalThis.RCSUnifiedStyles+=searchSizing;
  globalThis.RCSUnifiedToolStyles+=searchSizing;
})();

(() => {
  // Account markers (deleted / banned / unavailable) sit at the row's right edge, with or without a preview line.
  const markers=`
    .row-secondary .row-meta.unavailable-marker { margin-inline-start:auto;margin-inline-end:-2px;justify-content:flex-end;width:14px;max-width:14px; }
    .row-meta.unavailable-marker svg,.unavailable-marker svg { width:14px;height:14px; }
  `;
  // Reddit's phone layout (below its tablet breakpoint) uses 40 px controls with 12 px side padding; the desktop and
  // floating looks are unchanged. The floating chat is already 40 px through data-rcs-compact.
  const phone=`
    @media (max-width:767.98px) {
      :host([data-rcs-ui="list"]:not([data-rcs-compact])) .bar.unified-search { padding-inline:12px; }
      :host([data-rcs-ui="list"]:not([data-rcs-compact])) .bar.unified-search .search-toolbar { height:max(var(--rcs-native-header-height,52px),56px); }
      :host([data-rcs-ui="list"]:not([data-rcs-compact])) .field { height:40px;min-height:40px;padding:0 12px;gap:10px; }
      :host([data-rcs-ui="list"]:not([data-rcs-compact])) .field input { height:100%; }
    }
  `;
  globalThis.RCSUnifiedStyles+=markers+phone;
  globalThis.RCSUnifiedToolStyles+=markers+phone;
})();

(() => {
  // Applied filters in chat use Reddit's input-chip look, the same pill as the header and feed filters (measured
  // from rpl-input-chip appearance="bordered": 32 px, 3/5/3/11 padding, 1 px 20% border, 8 px radius, 600 12/16,
  // 16 px leading icon, 16 px remove button 4 px after the label). Reddit's element isn't defined on every chat page,
  // so the look is reproduced here.
  const chips=`
    :host { --rcs-chip-border:color-mix(in srgb,var(--rcs-text,#172328) 20%,transparent); }
    :host([data-rcs-ui]) :is(.global-filter-rail,.room-applied-filters),.bar.unified-search .global-filter-rail { height:auto;min-height:32px;padding-top:0;padding-bottom:0;gap:6px;align-items:center; }
    :host([data-rcs-ui]) :is(.global-filter-rail > .global-filter-add,.room-applied-filters .room-add-sender) { box-sizing:border-box;flex:0 0 32px;width:32px;height:32px;border:1px solid var(--rcs-chip-border);border-radius:50%;background:transparent;color:var(--rcs-text,#172328); }
    :host([data-rcs-ui]) :is(.global-filter-rail > .global-filter-add,.room-applied-filters .room-add-sender) svg { width:16px;height:16px; }
    :host([data-rcs-ui=messages]) .room-applied-filters { padding:0 8px 6px; }
    :host([data-rcs-ui]) :is(.global-filter-rail,.room-applied-filters) > :is(.sender-chip,.filter-chip,.room-type-chip),.bar.unified-search .global-filter-rail > :is(.sender-chip,.filter-chip) {
      box-sizing:border-box;flex:0 0 auto;display:inline-flex;align-items:center;gap:0;height:32px;min-height:32px;max-width:min(260px,75vw);padding:3px 5px 3px 11px;
      border:1px solid var(--rcs-chip-border);border-radius:8px;background:transparent;color:var(--rcs-text,#172328);font-size:12px;font-weight:600;line-height:16px; }
    :host([data-rcs-ui]) :is(.global-filter-rail,.room-applied-filters) > :is(.sender-chip,.filter-chip,.room-type-chip):hover { background:var(--rcs-hover,#eff3f5); }
    :host([data-rcs-ui]) :is(.global-filter-rail,.room-applied-filters) :is(.sender-chip-icon,.applied-filter-icon,.sender-chip-avatar) { flex:0 0 16px;width:16px;height:16px;margin-inline-end:5px;color:var(--rcs-text,#172328); }
    :host([data-rcs-ui]) :is(.global-filter-rail,.room-applied-filters) :is(.sender-chip,.filter-chip,.room-type-chip) > span { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    :host([data-rcs-ui]) :is(.global-filter-rail,.room-applied-filters) :is(.sender-chip,.filter-chip,.room-type-chip) > button { order:10;flex:0 0 16px;width:16px;height:16px;margin:0 0 0 4px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--rcs-text,#172328); }
    :host([data-rcs-ui]) :is(.global-filter-rail,.room-applied-filters) :is(.sender-chip,.filter-chip,.room-type-chip) > button svg { width:12px;height:12px; }
    :is(.global-filter-rail,.room-applied-filters) > [data-rcs-fit-hidden] { display:none !important; }
    :is(.global-filter-rail,.room-applied-filters) > .rcs-rail-more { display:inline-flex;align-items:center;justify-content:center;flex:0 1 auto;min-width:0;max-width:100%;min-height:25px;padding:2px 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid color-mix(in srgb,var(--rcs-accent) 22%,var(--rcs-line));border-radius:999px;background:color-mix(in srgb,var(--rcs-accent) 6%,var(--rcs-bg));color:var(--rcs-text);font-size:var(--rcs-row-time-size,10px);font-weight:600;line-height:1.35;cursor:pointer; }
    :is(.global-filter-rail,.room-applied-filters) > .rcs-rail-more:hover,:is(.global-filter-rail,.room-applied-filters) > .rcs-rail-more[aria-expanded=true] { background:var(--rcs-hover); }
    .rcs-rail-list { right:auto;max-height:min(360px,70vh);overflow:auto;padding:4px 0 6px; }
    .rcs-rail-list-head { display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 4px 4px 12px;font-size:12px;font-weight:600;color:var(--rcs-text); }
    .rcs-rail-list-clear { height:28px;padding:0 10px;border:0;border-radius:999px;background:transparent;color:var(--rcs-link);font:600 12px/16px var(--font-sans,inherit);cursor:pointer; }
    .rcs-rail-list-clear:hover,.rcs-rail-list-remove:hover { background:var(--rcs-hover); }
    .rcs-rail-list-row { display:flex;align-items:center;gap:8px;min-height:36px;padding:0 4px 0 12px;font-size:12px;color:var(--rcs-text); }
    .rcs-rail-list-icon { flex:0 0 16px;width:16px;height:16px;border-radius:50%;overflow:hidden; }
    .rcs-rail-list-label { flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .rcs-rail-list-remove { display:inline-flex;align-items:center;justify-content:center;flex:0 0 28px;width:28px;height:28px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--rcs-muted);cursor:pointer; }
    :host([data-rcs-ui]) :is(.global-filter-rail,.room-applied-filters) > .rcs-rail-more { box-sizing:border-box;height:32px;min-height:32px;padding:3px 11px;border:1px solid var(--rcs-chip-border);border-radius:8px;background:transparent;font-size:12px;line-height:16px; }
  `;
  globalThis.RCSUnifiedStyles+=chips;
  globalThis.RCSUnifiedToolStyles+=chips;
})();
