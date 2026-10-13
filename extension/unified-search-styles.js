/* Styles for the native chat-list unified search shadow root. */
(() => {
  globalThis.RCSUnifiedStyles = `
    :host {
      display:block; position:relative; z-index:1; isolation:isolate; min-width:0;
      color:var(--color-neutral-content-strong,#172328);
      font:13px/1.45 var(--font-sans,-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif);
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
      --rcs-accent:var(--color-brand-background,#d93900);
    }
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
    .field input { width:100%; flex:1; min-width:0; height:38px; margin:0; padding:0; color:var(--rcs-text); background:transparent; border:0; outline:0; font-size:13px; }
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
    .common-hint { padding:5px 15px 9px; color:var(--rcs-muted); font-size:10px; line-height:1.5; flex-shrink:0; }
    .results { position:relative; overflow-y:auto; overflow-x:hidden; flex:1; min-height:0; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:var(--rcs-border) transparent; }
    .virtual-spacer { width:100%; pointer-events:none; }
    .row { position:relative; display:flex; align-items:center; gap:11px; width:100%; min-height:78px; padding:12px 15px; text-align:left; background:var(--rcs-bg); border-bottom:1px solid var(--rcs-line); cursor:pointer; }
    .row:hover,.message-row:hover,.recent-row:hover { background:var(--rcs-hover); }
    .row.selected,.message-row.selected,.recent-row.selected { background:var(--rcs-selected); }
    .row.selected::before,.message-row.selected::before { content:''; position:absolute; top:12px; bottom:12px; left:0; width:3px; border-radius:0 3px 3px 0; background:var(--rcs-accent); }
    .row.keyboard-focus,.message-row.keyboard-focus,.recent-row.keyboard-focus { outline:0; box-shadow:inset 0 0 0 2px var(--rcs-accent); }
    .avatar { display:flex; align-items:center; justify-content:center; width:36px; height:36px; flex:0 0 36px; overflow:hidden; border-radius:50%; color:var(--rcs-text); background:var(--rcs-hover); font-size:12px; font-weight:600; }
    .avatar img { width:100%; height:100%; object-fit:cover; }
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
    .you-prefix { color:var(--rcs-muted); font-weight:400; }
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
      :host { --rcs-bg:var(--color-neutral-background,#141c20); --rcs-soft:var(--color-neutral-background-weak,#1c282e); --rcs-hover:var(--color-neutral-background-hover,#27363d); --rcs-text:var(--color-neutral-content-strong,#eef3f5); --rcs-muted:var(--color-neutral-content-weak,#b2c0c7); --rcs-line:var(--color-neutral-border-weak,#33434b); --rcs-border:var(--color-neutral-border-medium,#596e79); --rcs-selected:var(--color-primary-background-weak,#233e4a); --rcs-link:var(--color-primary,#76c5ee); --rcs-focus:var(--color-primary,#76c5ee); --rcs-accent:var(--color-brand-background,#ff7545); }
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
    .menu-popover { left:50%;right:auto;transform:translateX(-50%);width:min(240px,calc(100% - 24px));padding:7px; }
    .menu-title { font-size:11px;color:var(--rcs-text);margin:3px 7px 6px; }
    .menu-section-title { margin:4px 7px; font-size:10px; color:var(--rcs-muted,#52656c); font-weight:600; letter-spacing:.2px; }
    .menu-section-title:not(:first-child) { padding-top:6px; border-top:1px solid var(--rcs-line,#dfe6e9); }
    .menu-option { display:flex; align-items:center; gap:8px; width:100%; min-height:32px; padding:6px 7px; color:var(--rcs-text,#172328); text-align:left; border:0; border-radius:6px; background:transparent; font-size:12px; cursor:pointer; }
    .menu-option:hover { background:var(--rcs-hover,#eff3f5); }
    .menu-option[aria-checked=true],.menu-option.active { background:var(--rcs-soft,#f6f8f9); font-weight:600; }
    .menu-option[aria-checked=true]::after { content:'✓'; margin-left:auto; color:var(--rcs-accent,#d93900); }
    .menu-option:focus-visible,.suggestion-option:focus-visible { outline:2px solid var(--rcs-focus,#167cb0); outline-offset:-2px; }
    .control-pill.filter-icon,.control-pill.date-icon,.query-tools-overlay .filter-icon { display:inline-flex; align-items:center; justify-content:center; width:28px; height:28px; padding:0; border:0; border-radius:50%; color:var(--rcs-muted,#52656c); background:transparent; }
    .control-pill.filter-icon:hover,.control-pill.date-icon:hover { background:var(--rcs-hover,#eff3f5); }
    .control-pill.filter-icon.active,.control-pill.date-icon.active,.filter-icon.active,.filter-icon[aria-pressed=true] { color:var(--rcs-accent,#d93900); background:var(--rcs-soft,#f6f8f9); }
    .control-pill.filter-icon svg,.control-pill.date-icon svg { width:17px; height:17px; }
    .control-pill.date-icon:disabled { opacity:.35;cursor:default;pointer-events:none;background:transparent;color:var(--rcs-muted,#52656c); }
    .operator-suggestions { top:51px; left:8px; right:8px; width:auto; max-height:none; overflow:visible; }
    .query-tools-overlay .operator-suggestions { top:4px; left:8px; right:8px; width:auto; }
    .suggestion-option { display:flex; flex-direction:row; align-items:center; gap:9px; padding:7px 9px; line-height:1.4; }
    .suggestion-option[aria-selected=true] { background:var(--rcs-soft,#f6f8f9); box-shadow:inset 0 0 0 1px var(--rcs-accent,#ff4500); }
    .query-filter { color:var(--rcs-muted,#52656c); }
    .query-filter.active { color:var(--rcs-accent,#d93900); background:var(--rcs-soft,#f6f8f9); }
    .operator-option { display:flex;flex-direction:row;align-items:center;gap:8px; }
    .operator-label { flex:1;min-width:0;white-space:nowrap; }
    .operator-option svg { width:15px;height:15px;flex:0 0 15px; }
    .operator-token { display:inline-flex;align-items:center;flex-shrink:0;padding:3px 7px;border:1px solid var(--rcs-line,#dfe6e9);border-radius:6px;color:var(--rcs-accent,#d93900);background:color-mix(in srgb,var(--rcs-accent,#d93900) 8%,var(--rcs-bg,#fff));font:inherit;font-size:11px;font-weight:500; }
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
    .sender-chip { display:inline-flex;align-items:center;gap:5px;min-width:0;max-width:100%;min-height:27px;padding:3px 6px 3px 8px;border:1px solid color-mix(in srgb,var(--rcs-accent,#d93900) 25%,var(--rcs-line,#dfe6e9));border-radius:999px;background:color-mix(in srgb,var(--rcs-accent,#d93900) 8%,var(--rcs-bg,#fff));color:var(--rcs-text,#172328);font-size:11px;line-height:1.4; }
    .sender-chip-label { color:var(--rcs-accent,#d93900);flex-shrink:0;font-weight:500; }
    .sender-chip-value { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .sender-chip-avatar { display:grid;place-items:center;flex:0 0 18px;width:18px;height:18px;overflow:hidden;object-fit:cover;border-radius:50%;background:var(--rcs-hover,#eff3f5);font-size:9px; }
    .sender-chip-avatar img { width:100%;height:100%;object-fit:cover; }
    .sender-chip button { display:inline-flex;align-items:center;justify-content:center;flex:0 0 20px;width:20px;height:20px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--rcs-muted,#52656c);cursor:pointer; }
    .sender-chip button:hover { color:var(--rcs-text,#172328);background:var(--rcs-hover,#eff3f5); }
    .sender-chip button svg { width:12px;height:12px; }
    .sender-chip button:focus-visible { outline:2px solid var(--rcs-focus,#167cb0);outline-offset:1px; }
    mark { background:#ffcc804d;color:inherit;border-radius:2px;font-weight:400; }
    .link-snippet { line-break:anywhere; }
    .menu-choice-row { display:flex;gap:2px;padding:0 3px 4px; }
    .menu-choice { flex:1;min-width:0;border:0;border-radius:5px;padding:5px 2px;color:var(--rcs-muted);background:transparent;font:inherit;font-size:11px;cursor:pointer; }
    .menu-choice:hover { background:var(--rcs-hover); }
    .menu-choice[aria-checked=true] { background:var(--rcs-soft);color:var(--rcs-text);font-weight:600; }
    .sender-result { display:flex;align-items:center;gap:11px;width:100%;height:64px;padding:10px 14px;color:var(--rcs-text);background:var(--rcs-bg);border:0;text-align:left;cursor:pointer; }
    .sender-result:hover { background:var(--rcs-hover); }
    .sender-result.keyboard-focus { box-shadow:inset 0 0 0 2px var(--rcs-accent); }
    .sender-result .avatar { display:grid;place-items:center;object-fit:cover;flex:0 0 36px;width:36px;height:36px;border-radius:50%;background:var(--rcs-soft);color:var(--rcs-muted);font-size:12px; }
    .sender-result .row-main { flex:1;min-width:0; }
    .sender-result .row-title { display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:400; }
    .sender-result .row-meta { display:block;margin-top:2px;font-size:10px;color:var(--rcs-muted); }
    .query-tools-overlay [hidden] { display:none !important; }
  `;
  globalThis.RCSUnifiedStyles += `
    :host { z-index:1; isolation:isolate; }
    .bar.unified-search { display:block; padding:7px 12px 0; }
    .bar.unified-search .field { width:100%; height:40px; }
    .field .search-controls { display:flex;flex-wrap:nowrap;gap:1px;padding:0;margin:0;flex-shrink:0; }
    .field .control-pill { padding:0;border:0;border-radius:50%;width:26px;height:26px;min-height:26px; }
    .field .control-pill svg { width:16px;height:16px; }
    .field .control-pill.active { color:var(--rcs-accent);background:color-mix(in srgb,var(--rcs-accent) 12%,var(--rcs-bg)); }
    .field .control-pill:hover { background:var(--rcs-hover); }
    .field input { font-size:12px; }
    .date-mode[aria-pressed=true],.calendar-option[aria-pressed=true] { color:color-mix(in srgb,var(--rcs-accent) 72%,var(--rcs-text)); }
    .search-icon { display:flex;align-items:center;justify-content:center;flex:0 0 24px;width:24px;height:28px;padding:0;border:0;border-radius:50%;color:var(--rcs-muted);background:transparent; }
    .search-icon:hover { background:var(--rcs-hover); }
    .search-icon svg { width:18px; height:18px; }
    .scope.scope-tabs { display:flex;align-items:center;gap:4px;margin:5px 0 0;padding:0;border-bottom:1px solid var(--rcs-line); }
    .scope-tab { position:relative;isolation:isolate;display:flex;align-items:center;justify-content:center;flex:1 1 auto;min-width:0;max-width:100%;overflow:hidden;padding:8px 4px;min-height:34px;border:0;border-bottom:2px solid transparent;border-radius:0;color:var(--rcs-muted);font-size:12px;font-weight:500;white-space:nowrap;background-clip:padding-box; }
    .scope-tab:hover { background:transparent;border-bottom-color:color-mix(in srgb,var(--rcs-accent) 35%,transparent); }
    .scope-tab.active,.scope-tab[aria-selected=true] { background:transparent;color:var(--rcs-text);border-bottom-color:var(--rcs-accent);font-weight:600; }
    .bar.unified-search .global-filter-rail { display:flex;align-items:center;flex-wrap:nowrap;gap:6px;width:100%;height:32px;min-height:32px;overflow-x:auto;overflow-y:hidden;padding:3px 12px;overscroll-behavior-inline:contain;scrollbar-width:none;-ms-overflow-style:none; }
    .bar.unified-search .global-filter-rail::-webkit-scrollbar { display:none;width:0;height:0; }
    .bar.unified-search .global-filter-rail:empty,.bar.unified-search .global-filter-rail[hidden] { display:none; }
    .bar.unified-search .global-filter-rail > .sender-chip { display:inline-flex;align-items:center;flex:0 0 auto;gap:5px;min-width:0;max-width:min(260px,75vw);min-height:25px;padding:2px 4px 2px 8px;border:1px solid color-mix(in srgb,var(--rcs-accent) 22%,var(--rcs-line));border-radius:999px;background:color-mix(in srgb,var(--rcs-accent) 6%,var(--rcs-bg));color:var(--rcs-text);font-size:10px;line-height:1.35; }
    .bar.unified-search .global-filter-rail > .filter-chip { display:inline-flex;align-items:center;flex:0 0 auto;gap:5px;min-width:0;max-width:min(260px,75vw);min-height:25px;padding:2px 4px 2px 8px;border:1px solid color-mix(in srgb,var(--rcs-accent) 22%,var(--rcs-line));border-radius:999px;background:color-mix(in srgb,var(--rcs-accent) 6%,var(--rcs-bg));color:var(--rcs-text);font-size:10px;line-height:1.35; }
    .bar.unified-search .global-filter-rail > .filter-chip > span { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
    .bar.unified-search .global-filter-rail > .filter-chip > button { order:10;display:inline-flex;align-items:center;justify-content:center;flex:0 0 18px;width:18px;height:18px;margin-left:1px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--rcs-muted); }
    .bar.unified-search .global-filter-rail > .filter-chip > button:hover { background:var(--rcs-hover);color:var(--rcs-text); }
    .bar.unified-search .global-filter-rail > .filter-chip > button svg { width:11px;height:11px; }
    .bar.unified-search .global-filter-rail .sender-chip-label { flex:0 0 auto;color:var(--rcs-muted);font-weight:500; }
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
    .bar.unified-search .operator-suggestions .suggestion-option { min-height:32px;gap:7px;padding:5px 7px;border-radius:6px;font-size:11px; }
    .bar.unified-search .operator-suggestions .operator-token { padding:2px 6px;font-size:10px; }
    :host([data-rcs-ui="list"]) .global-sender-result { position:relative;display:flex;align-items:center;gap:9px;width:100%;height:52px;min-height:52px;padding:6px 12px;border:0;background:var(--rcs-bg);color:var(--rcs-text);text-align:left; }
    :host([data-rcs-ui="list"]) .global-sender-result.with-preview,:host([data-rcs-ui="list"]) .global-sender-result:has(.row-snippet,.row-meta) { height:64px;min-height:64px; }
    :host([data-rcs-ui="list"]) .global-sender-result:hover { background:var(--rcs-hover); }
    :host([data-rcs-ui="list"]) .global-sender-result[aria-selected=true],:host([data-rcs-ui="list"]) .global-sender-result.selected { background:var(--rcs-selected); }
    :host([data-rcs-ui="list"]) .global-sender-result[aria-selected=true]::before,:host([data-rcs-ui="list"]) .global-sender-result.selected::before { content:'';position:absolute;inset-block:8px;left:0;width:4px;border-radius:0 3px 3px 0;background:var(--rcs-accent); }
    :host([data-rcs-ui="list"]) .global-sender-result.keyboard-focus { outline:0;box-shadow:inset 0 0 0 2px var(--rcs-accent); }
    :host([data-rcs-ui="list"]) .global-sender-result .avatar { display:grid;place-items:center;flex:0 0 36px;width:36px;height:36px;overflow:hidden;object-fit:cover;border-radius:50%;background:var(--rcs-soft);color:var(--rcs-muted);font-size:12px; }
    :host([data-rcs-ui="list"]) .global-sender-result .row-main { flex:1;min-width:0; }
    :host([data-rcs-ui="list"]) .global-sender-result .row-title { display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--rcs-text);font-size:12px;font-weight:400; }
    :host([data-rcs-ui="list"]) .global-sender-result .row-meta { display:block;margin-top:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--rcs-muted);font-size:10px; }
    .bar.unified-search .date-popover { --calendar-cell:25px;top:calc(100% + 4px);right:8px;width:244px;max-width:calc(100% - 16px);max-height:min(350px,65vh);overflow:auto;padding:8px;border-radius:10px;font-size:11px; }
    .bar.unified-search .date-popover .date-modes { gap:2px;margin-bottom:6px;padding:2px; }
    .bar.unified-search .date-popover .date-mode { padding:4px 2px;font-size:10px; }
    .bar.unified-search .date-popover .calendar-nav { gap:3px;margin-bottom:5px; }
    .bar.unified-search .date-popover .calendar-nav-button { width:23px;height:24px;font-size:19px; }
    .bar.unified-search .date-popover .calendar-month,.bar.unified-search .date-popover .calendar-year { height:25px;padding-inline:7px; }
    .bar.unified-search .date-popover .calendar-year { width:64px; }
    .bar.unified-search .date-popover .calendar-weekdays { margin-bottom:3px;font-size:9px; }
    .bar.unified-search .date-popover .calendar-day { font-size:11px; }
    .bar.unified-search .date-popover .calendar-summary { min-height:24px;padding:5px 0;font-size:9px; }
    .bar.unified-search .date-popover .calendar-actions { gap:6px;padding-top:6px; }
    .bar.unified-search .date-popover .calendar-clear,.bar.unified-search .date-popover .calendar-apply { min-height:26px;padding:4px 11px;font-size:10px; }
    .results { overflow-anchor:none;scrollbar-gutter:stable; }
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
    .results-status { display:flex; align-items:center; justify-content:space-between; gap:6px; min-height:28px; padding:0 10px; color:var(--rcs-muted); font-size:10px; flex-shrink:0; }
    .results-status .icon-button { width:22px;height:22px; }
    .results-status .icon-button svg { width:13px;height:13px; }
    .result-row { position:relative; display:flex; align-items:center; gap:11px; width:100%; height:64px; padding:10px 14px; text-align:left; background:var(--rcs-bg); border:0; }
    .chat-result { height:100%; }
    .result-row:hover,.message-result:hover,.recent-row:hover { background:var(--rcs-hover); }
    .result-row.selected,.message-result.selected { background:var(--rcs-soft); }
    .result-row.selected::before,.message-result.selected::before { content:'';position:absolute;inset-block:10px;left:0;width:3px;border-radius:0 3px 3px 0;background:var(--rcs-accent); }
    .result-row.keyboard-focus,.message-result.keyboard-focus { box-shadow:inset 0 0 0 2px var(--rcs-accent); outline:0; }
    .message-result.keyboard-focus > .message-open:focus-visible { outline:0; }
    .row-main { display:block; flex:1; min-width:0; }
    .row-top { display:flex; align-items:center; gap:6px; }
    .row-title { display:block; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--rcs-text); font-size:13px; font-weight:400; text-align:left; }
    .result-row.unread .row-title { font-weight:600; }
    .row-time { display:block; flex-shrink:0; color:var(--rcs-muted); font-size:10px; white-space:nowrap; font-weight:400; }
    .row-snippet { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-top:4px; color:var(--rcs-muted); font-size:11px; }
    .row-meta { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--rcs-muted); font-size:10px; margin-top:3px; }
    .message-result { position:relative; height:82px; padding:5px 14px; border:0; }
    .message-open { display:flex; align-items:center; gap:10px; width:100%; height:100%; padding:4px 0; text-align:left; }
    .message-open .avatar { flex:0 0 34px; width:34px; height:34px; }
    .message-copy { display:flex; flex:1; flex-direction:column; justify-content:center; gap:3px; min-width:0; }
    .message-heading { display:flex; align-items:center; gap:7px; min-width:0; }
    .message-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--rcs-text); font-size:13px; font-weight:600; }
    .message-open .row-time { flex:0 0 auto; font-size:10px; }
    .message-open .snippet { white-space:normal; overflow-wrap:anywhere; word-break:normal; font-weight:400; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; font-size:13px; line-height:1.4; max-height:37px; }
    .day-heading { position:sticky; top:0; z-index:2; display:flex; align-items:center; gap:12px; margin:0; padding:0 14px; color:var(--rcs-muted); background:var(--rcs-bg); border:0; font-size:10px; font-weight:600; }
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
    .skeleton-row { display:flex; gap:11px; padding:20px 14px; height:86px; }
    .skeleton-avatar { width:36px; height:36px; border-radius:50%; background:var(--rcs-hover); }
    .skeleton-text { flex:1; height:32px; margin-top:2px; border-radius:4px; background:linear-gradient(var(--rcs-hover) 0 11px,transparent 11px 20px,var(--rcs-hover) 20px); animation:rcs-pulse 1.4s ease-in-out infinite alternate; }
    :host([data-rcs-compact]) .bar.unified-search { display:block; padding:5px 14px 0; }
    :host([data-rcs-compact]) .scope.scope-tabs { gap:4px;margin:5px 0 0;padding:0;border-bottom:1px solid var(--rcs-line); }
  ` + globalThis.RCSUnifiedToolStyles;
})();
