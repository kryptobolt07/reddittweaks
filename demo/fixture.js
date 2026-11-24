/* Synthetic fixtures mirror Reddit's live rs-* chat markup and CSS tokens, using invented data and Reddit default avatars. */
(() => {
  const make = (tag, text, className) => { const e = document.createElement(tag); if (text) e.textContent = text; if (className) e.className = className; return e; };
  const AVATAR_BASE = 'https://www.redditstatic.com/avatars/defaults/v2/avatar_default_';
  const defaultAvatar = index => `${AVATAR_BASE}${((Number(index) || 0) % 8 + 8) % 8}.png`;
  const SELF_AVATAR = defaultAvatar(0);

  const ICONS = {
    snoo: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 216 216" class="snoo-logo"><defs><radialGradient id="sn-g1" cx="169.75" cy="92.19" fx="169.75" fy="92.19" r="50.98" gradientTransform="translate(0 11.64) scale(1 .87)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#feffff"/><stop offset=".4" stop-color="#feffff"/><stop offset=".62" stop-color="#edf3f5"/><stop offset=".8" stop-color="#c8d5dd"/><stop offset=".9" stop-color="#ffebef"/></radialGradient><radialGradient id="sn-g2" cx="47.31" cy="92.19" fx="47.31" fy="92.19" r="50.98" gradientTransform="translate(0 11.64) scale(1 .87)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#feffff"/><stop offset=".4" stop-color="#feffff"/><stop offset=".62" stop-color="#edf3f5"/><stop offset=".8" stop-color="#c8d5dd"/><stop offset=".9" stop-color="#ffebef"/></radialGradient><radialGradient id="sn-g3" cx="109.61" cy="85.59" fx="109.61" fy="85.59" r="153.78" gradientTransform="translate(0 25.56) scale(1 .7)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#feffff"/><stop offset=".4" stop-color="#feffff"/><stop offset=".62" stop-color="#edf3f5"/><stop offset=".8" stop-color="#c8d5dd"/><stop offset=".9" stop-color="#ffebef"/></radialGradient><radialGradient id="sn-g4" cx="-6.01" cy="64.68" fx="-6.01" fy="64.68" r="12.85" gradientTransform="translate(81.08 27.26) scale(1.07 1.55)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f60"/><stop offset=".5" stop-color="#ff4500"/><stop offset="1" stop-color="#d4301f"/></radialGradient><radialGradient id="sn-g5" cx="-73.55" cy="64.68" fx="-73.55" fy="64.68" r="12.85" gradientTransform="translate(62.87 27.26) rotate(-180) scale(1.07 -1.55)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f60"/><stop offset=".5" stop-color="#ff4500"/><stop offset="1" stop-color="#d4301f"/></radialGradient><radialGradient id="sn-g6" cx="107.93" cy="166.96" fx="107.93" fy="166.96" r="45.3" gradientTransform="translate(0 57.4) scale(1 .66)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#172e35"/><stop offset=".73" stop-color="#030708"/><stop offset="1" stop-color="#000"/></radialGradient><radialGradient id="sn-g7" cx="147.88" cy="32.94" fx="147.88" fy="32.94" r="39.77" gradientTransform="translate(0 .54) scale(1 .98)" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#feffff"/><stop offset=".62" stop-color="#edf3f5"/><stop offset=".9" stop-color="#ffebef"/></radialGradient></defs><path fill="#ff4500" d="m108,0h0C48.35,0,0,48.35,0,108h0c0,29.82,12.09,56.82,31.63,76.37l-20.57,20.57c-4.08,4.08-1.19,11.06,4.58,11.06h92.36c59.65,0,108-48.35,108-108h0C216,48.35,167.65,0,108,0Z"/><circle fill="url(#sn-g1)" cx="169.22" cy="106.98" r="25.22"/><circle fill="url(#sn-g2)" cx="46.78" cy="106.98" r="25.22"/><ellipse fill="url(#sn-g3)" cx="108.06" cy="128.64" rx="72" ry="54"/><path fill="url(#sn-g4)" d="m86.78,123.48c-.42,9.08-6.49,12.38-13.56,12.38s-12.46-4.93-12.04-14.01c.42-9.08,6.49-15.02,13.56-15.02s12.46,7.58,12.04,16.66Z"/><path fill="url(#sn-g5)" d="m129.35,123.48c.42,9.08,6.49,12.38,13.56,12.38s12.46-4.93,12.04-14.01c-.42-9.08-6.49-15.02-13.56-15.02s-12.46,7.58-12.04,16.66Z"/><ellipse fill="#ffc49c" cx="79.63" cy="116.37" rx="2.8" ry="3.05"/><ellipse fill="#ffc49c" cx="146.21" cy="116.37" rx="2.8" ry="3.05"/><path fill="url(#sn-g6)" d="m108.06,142.92c-8.76,0-17.16.43-24.92,1.22-1.33.13-2.17,1.51-1.65,2.74,4.35,10.39,14.61,17.69,26.57,17.69s22.23-7.3,26.57-17.69c.52-1.23-.33-2.61-1.65-2.74-7.77-.79-16.16-1.22-24.92-1.22Z"/><circle fill="url(#sn-g7)" cx="147.49" cy="49.43" r="17.87"/><path fill="#172e35" d="m107.8,76.92c-2.14,0-3.87-.89-3.87-2.27,0-16.01,13.03-29.04,29.04-29.04,2.14,0,3.87,1.73,3.87,3.87s-1.73,3.87-3.87,3.87c-11.74,0-21.29,9.55-21.29,21.29,0,1.38-1.73,2.27-3.87,2.27Z"/></svg>',
    markRead: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M15.7 18H4.3A3.305 3.305 0 011 14.699V8.374c0-.885.405-1.699 1.111-2.234l6.162-4.566a2.883 2.883 0 013.453 0l6.058 4.491A2.8 2.8 0 0119 8.375V14.7c0 1.82-1.48 3.3-3.3 3.3ZM10 2.803c-.229 0-.459.072-.654.217L3.19 7.582a.991.991 0 00-.39.793V14.7c0 .827.672 1.5 1.499 1.5h11.4c.827 0 1.499-.673 1.499-1.5V8.375c0-.333-.165-.643-.441-.831l-.031-.022-6.072-4.501A1.096 1.096 0 0010 2.803Zm-.278 10.771 4.959-4.959-1.273-1.272-4.718 4.718-2.097-2.097-1.273 1.272 2.339 2.339c.284.284.657.425 1.031.425.374 0 .747-.142 1.032-.426Z"/></svg>',
    newChat: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1a9 9 0 00-9 9c0 1.947.79 3.58 1.935 4.957L.231 17.661A.784.784 0 00.785 19H10a9 9 0 009-9 9 9 0 00-9-9Zm0 16.2H6.162c-.994.004-1.907.053-3.045.144l-.076-.188a36.981 36.981 0 002.328-2.087l-1.05-1.263C3.297 12.576 2.8 11.331 2.8 10c0-3.97 3.23-7.2 7.2-7.2s7.2 3.23 7.2 7.2-3.23 7.2-7.2 7.2Zm4.4-6.3h-3.5v3.5H9.1v-3.5H5.6V9.1h3.5V5.6h1.8v3.5h3.5v1.8Z"/></svg>',
    filter: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6.9h7.11A4 4 0 0014 10c2.21 0 4-1.79 4-4s-1.79-4-4-4a4 4 0 00-3.89 3.1H3c-.5 0-.9.4-.9.9s.4.9.9.9Zm11-3.1c1.21 0 2.2.99 2.2 2.2 0 1.21-.99 2.2-2.2 2.2-1.21 0-2.2-.99-2.2-2.2 0-1.21.99-2.2 2.2-2.2Zm3 9.3H9.89A4 4 0 006 10c-2.21 0-4 1.79-4 4s1.79 4 4 4a4 4 0 003.89-3.1H17c.5 0 .9-.4.9-.9s-.4-.9-.9-.9ZM6 16.2c-1.21 0-2.2-.99-2.2-2.2 0-1.21.99-2.2 2.2-2.2 1.21 0 2.2.99 2.2 2.2 0 1.21-.99 2.2-2.2 2.2Z"/></svg>',
    caretDown: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13.7a.897.897 0 01-.636-.264l-4.6-4.6a.9.9 0 111.272-1.273L10 11.526l3.964-3.963a.9.9 0 011.272 1.273l-4.6 4.6A.897.897 0 0110 13.7Z"/></svg>',
    reply: '<svg fill="currentColor" height="20" width="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M12.092 7.095H4.068l4.557-4.562a.898.898 0 00-1.27-1.27L1.26 7.355a.9.9 0 000 1.27l6.096 6.103c.18.18.41.26.64.26.229 0 .459-.09.639-.26a.9.9 0 000-1.27L4.078 8.896h8.024a5.108 5.108 0 015.097 5.102V18.1c0 .5.4.9.9.9.499 0 .899-.4.899-.9v-4.102c0-3.802-3.098-6.903-6.896-6.903h-.01Z"/></svg>',
    caretRight: '<svg fill="currentColor" height="20" width="20" viewBox="0 0 20 20" aria-hidden="true"><path d="M13.7 10c0 .23-.088.46-.264.636l-4.6 4.6a.9.9 0 11-1.273-1.272L11.526 10 7.563 6.036a.9.9 0 011.273-1.272l4.6 4.6A.897.897 0 0113.7 10Z"/></svg>',
    pinFill: '<svg fill="currentColor" height="12" width="12" viewBox="0 0 20 20" aria-hidden="true"><path d="M18.163 6.191a4.194 4.194 0 00-1.237-2.986l-.167-.167a4.197 4.197 0 00-2.986-1.236 4.194 4.194 0 00-2.986 1.237L8.835 4.99a6.267 6.267 0 00-2.708.116 6.276 6.276 0 00-2.798 1.611.902.902 0 00-.001 1.274l3.724 3.723-4.955 4.955a.898.898 0 00.636 1.536c.23 0 .46-.088.636-.264l4.955-4.955 3.644 3.644a.897.897 0 001.273-.001 6.25 6.25 0 001.727-5.499l1.958-1.953a4.197 4.197 0 001.236-2.986h.001Z"/></svg>',
    pin: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M18.17 6.19c0-1.13-.44-2.19-1.24-2.99l-.17-.17c-.8-.8-1.86-1.24-2.99-1.24-1.13 0-2.19.44-2.99 1.24L8.83 4.98a6.2 6.2 0 00-2.71.12c-1.06.28-2.02.84-2.8 1.61a.9.9 0 00-.26.64c0 .24.09.47.26.64l3.72 3.72-4.96 4.96a.9.9 0 000 1.27c.18.18.41.26.64.26.23 0 .46-.09.64-.26l4.96-4.96 3.64 3.64c.17.17.4.26.64.26s.47-.1.64-.26c.77-.77 1.33-1.74 1.61-2.79.24-.88.28-1.81.12-2.7l1.96-1.95c.8-.8 1.24-1.86 1.24-2.99ZM15.66 7.9l-2.7 2.69c.35.89.4 1.86.15 2.78-.12.46-.32.89-.58 1.29L5.3 7.43a4.42 4.42 0 014.07-.42l2.69-2.69c.94-.94 2.48-.94 3.42 0l.17.17c.46.46.71 1.07.71 1.71 0 .64-.25 1.26-.71 1.71l.01-.01Z"/></svg>',
    unpin: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M18.56 14.355 5.394 1.189a.898.898 0 00-1.272 0 .898.898 0 000 1.272L6.67 5.01c-.18.03-.362.053-.54.1a6.26 6.26 0 00-2.798 1.605.898.898 0 00-.002 1.275l3.724 3.723L2.1 16.668a.898.898 0 00.636 1.536c.23 0 .46-.088.636-.264l4.955-4.955 3.644 3.644a.897.897 0 001.273-.001 6.264 6.264 0 001.608-2.792c.048-.179.07-.362.102-.543l2.334 2.334a.897.897 0 001.272 0 .898.898 0 000-1.272Zm-5.446-.984a4.445 4.445 0 01-.575 1.284l-7.232-7.23c.395-.258.83-.452 1.287-.574a4.46 4.46 0 011.825-.092l4.79 4.791a4.458 4.458 0 01-.095 1.821ZM11.57 4.806l-1.273-1.273.49-.49a4.198 4.198 0 012.987-1.238c1.128 0 2.188.44 2.986 1.236l.167.167a4.194 4.194 0 011.237 2.986 4.197 4.197 0 01-1.236 2.986l-.492.491-1.273-1.273.492-.49a2.408 2.408 0 00.709-1.714c0-.647-.252-1.256-.71-1.714l-.167-.167c-.916-.915-2.512-.916-3.428 0l-.49.491v.002Z"/></svg>',
    settings: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M11.145 18.995h-2.29a1.56 1.56 0 01-1.501-1.134l-.051-.18a2.161 2.161 0 00-2.604-1.504l-.185.046a1.561 1.561 0 01-1.731-.734l-1.146-1.985a1.561 1.561 0 01.229-1.864l.132-.137a2.163 2.163 0 000-3.007l-.13-.135a1.561 1.561 0 01-.23-1.866L2.783 4.51a1.56 1.56 0 011.73-.734l.186.046a2.161 2.161 0 002.603-1.504l.05-.18a1.562 1.562 0 011.503-1.134h2.29c.697 0 1.31.463 1.5 1.133l.053.183a2.157 2.157 0 002.599 1.502l.189-.047a1.561 1.561 0 011.73.734l1.147 1.985a1.561 1.561 0 01-.23 1.864l-.133.14a2.162 2.162 0 000 3.004l.132.137c.485.5.578 1.262.23 1.866l-1.145 1.984a1.56 1.56 0 01-1.731.734l-.187-.047a2.16 2.16 0 00-2.601 1.503l-.052.182a1.562 1.562 0 01-1.502 1.134Zm-2.11-1.8 1.933-.01a3.947 3.947 0 014.77-2.754l.01.002.967-1.672-.008-.007a3.943 3.943 0 010-5.508l.007-.007-.966-1.672-.01.002a3.945 3.945 0 01-4.771-2.754l-.003-.01-1.933.009A3.946 3.946 0 014.26 5.569l-.01-.002-.966 1.672.008.007a3.943 3.943 0 010 5.508l-.007.007.966 1.672.01-.002a3.947 3.947 0 014.77 2.754l.004.01ZM10 13c-1.654 0-3-1.346-3-3s1.346-3 3-3 3 1.346 3 3-1.346 3-3 3Zm0-4.2c-.661 0-1.2.539-1.2 1.2 0 .66.539 1.2 1.2 1.2.66 0 1.199-.54 1.199-1.2 0-.661-.538-1.2-1.2-1.2Z"/></svg>',
    external: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M18 12v2.7a3.3 3.3 0 01-3.3 3.3H5.3A3.3 3.3 0 012 14.7V5.3A3.3 3.3 0 015.3 2H8v1.8H5.3c-.827 0-1.5.673-1.5 1.5v9.4c0 .827.673 1.5 1.5 1.5h9.4c.827 0 1.5-.673 1.5-1.5V12H18Zm-.9-10h-4.992a.9.9 0 000 1.8h2.82l-6.664 6.664a.9.9 0 101.273 1.272l6.662-6.662v2.818a.9.9 0 001.8 0V2.9A.9.9 0 0017.1 2Z"/></svg>',
    chevronDown: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M2.1 7.5a.898.898 0 011.536-.636L10 13.227l6.364-6.363a.898.898 0 011.272 0 .898.898 0 010 1.272l-7 7a.898.898 0 01-1.272 0l-7-7A.897.897 0 012.1 7.5Z"/></svg>',
    close: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="m11.273 10 5.363-5.364a.9.9 0 1 0-1.272-1.272L10 8.727 4.636 3.364a.9.9 0 1 0-1.272 1.272L8.727 10l-5.363 5.364a.9.9 0 1 0 1.272 1.272L10 11.273l5.364 5.363a.9.9 0 1 0 1.272-1.272L11.273 10Z"/></svg>',
    image: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M14.6 2H5.4A3.4 3.4 0 002 5.4v9.2A3.4 3.4 0 005.4 18h9.2a3.4 3.4 0 003.4-3.4V5.4A3.4 3.4 0 0014.6 2ZM5.4 3.8h9.2c.882 0 1.6.718 1.6 1.6v9.2c0 .484-.22.913-.561 1.207l-5.675-5.675a3.39 3.39 0 00-2.404-.996c-.87 0-1.74.332-2.404.996L3.8 11.488V5.4c0-.882.718-1.6 1.6-1.6ZM3.8 14.6v-.567l2.629-2.628a1.59 1.59 0 011.131-.469c.427 0 .829.166 1.131.469l4.795 4.795H5.4c-.882 0-1.6-.718-1.6-1.6Zm6.95-7.1a1.75 1.75 0 113.5 0 1.75 1.75 0 01-3.5 0Z"/></svg>',
    emoji: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M13.492 11a.51.51 0 01.502.588C13.707 13.519 12.028 15 10 15c-2.028 0-3.707-1.482-3.994-3.412A.51.51 0 016.508 11h6.984ZM19 8.666C19 3.723 15.804 1 10 1S1 3.723 1 8.666C1 13.643 3.816 19 10 19s9-5.357 9-10.334Zm-1.801 0c0 3.17-1.516 8.533-7.199 8.533s-7.199-5.363-7.199-8.533c0-3.893 2.422-5.865 7.199-5.865 4.777 0 7.199 1.973 7.199 5.865ZM14.3 8.2V6.8a1.3 1.3 0 10-2.6 0v1.4a1.3 1.3 0 102.6 0Zm-6 0V6.8a1.3 1.3 0 10-2.6 0v1.4a1.3 1.3 0 102.6 0Z"/></svg>',
    gif: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.711 12.664A2.8 2.8 0 013.6 11.583 3.108 3.108 0 013.2 10a3.052 3.052 0 01.411-1.583c.267-.46.659-.834 1.129-1.082a3.37 3.37 0 011.616-.385c.333 0 .664.043.986.128.309.081.605.205.879.369l-.5 1.169a1.314 1.314 0 00-.563-.357 2.3 2.3 0 00-.754-.124 1.733 1.733 0 00-1.863 1.848c-.006.344.073.684.232.99a1.7 1.7 0 001.542.925c.258.004.513-.051.746-.162a1.23 1.23 0 00.513-.443c.121-.185.185-.401.183-.622H6.124V9.619L9 9.6v.928a2.4 2.4 0 01-1.293 2.193 2.955 2.955 0 01-1.417.328 3.247 3.247 0 01-1.579-.385Zm5.471-5.648H11.5v5.968h-1.318V7.016Zm2.862 0H16.5v1.169h-2.138v1.392h1.79v1.169h-1.79v2.238h-1.318V7.016ZM10 20a18.04 18.04 0 01-6.369-1.162 4.226 4.226 0 01-2.469-2.47 18.033 18.033 0 010-12.737 4.228 4.228 0 012.469-2.469 18.116 18.116 0 0112.738 0 4.228 4.228 0 012.469 2.469 18.035 18.035 0 010 12.738 4.225 4.225 0 01-2.469 2.469A18.04 18.04 0 0110 20Zm0-18.75a16.8 16.8 0 00-5.929 1.082 2.978 2.978 0 00-1.739 1.739 16.783 16.783 0 000 11.857 2.98 2.98 0 001.739 1.74 16.858 16.858 0 0011.858 0 2.978 2.978 0 001.739-1.739 16.785 16.785 0 000-11.858 2.978 2.978 0 00-1.739-1.739A16.8 16.8 0 0010 1.25Z"/></svg>',
    send: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M18.1 9.1 4.54 1.6c-1.15-.63-2.48.44-2.1 1.7l1.44 4.77c.19.63.77 1.06 1.43 1.06H10v1.75H5.3c-.66 0-1.23.43-1.42 1.06l-1.45 4.77c-.38 1.25.95 2.33 2.1 1.7l13.57-7.48c.72-.4.72-1.43 0-1.83Z"/></svg>',
    checkboxFill: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M14.698 2h-9.4a3.304 3.304 0 00-3.3 3.3v9.4c0 1.82 1.48 3.301 3.3 3.301h9.4c1.82 0 3.3-1.48 3.3-3.301V5.3c0-1.82-1.48-3.3-3.3-3.3Zm-5.222 11.576a1.158 1.158 0 01-1.637 0L4.828 10.56l1.273-1.272 2.556 2.557 5.242-5.242 1.273 1.272-5.696 5.7Z"/></svg>',
    checkboxEmpty: '<svg fill="none" stroke="currentColor" stroke-width="1.6" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.8" y="2.8" width="14.4" height="14.4" rx="3"/></svg>',
    more: '<svg fill="currentColor" height="16" width="16" viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="10" r="1.5"/><circle cx="10" cy="10" r="1.5"/><circle cx="15.5" cy="10" r="1.5"/></svg>'
  };

  const conversations = [
    {id:'alex',name:'alex_morgan',initial:'A',color:'#ffe5c4',avatarIndex:1,pinned:true,timeLabel:'10:05 AM',accountAge:'3y',karma:'4.2k',preview:'You: Perfect. See you tomorrow!',messages:[['alex_morgan','Hey! How is the new project coming along?'],['You','Pretty well! I finally finished the chat search.'],['alex_morgan','Nice. Want to grab a coffee tomorrow?'],['You','Absolutely, same coffee place as last time?'],['alex_morgan','Yes! Let’s meet there at 10.'],['You','Perfect. See you tomorrow!']]},
    {id:'jules',name:'jules_designs',initial:'J',color:'#e4daf9',avatarIndex:2,unread:1,timeLabel:'9:42 AM',accountAge:'5y',karma:'12.8k',preview:'The new mockups look great.',messages:[['jules_designs','The new mockups look great.'],['You','Thanks! I kept the interface minimal.']]},
    {id:'sam',name:'sam_on_the_trail',initial:'S',color:'#ccead7',avatarIndex:3,timeLabel:'Yesterday',accountAge:'2y',karma:'1.9k',preview:'Did you see the route I sent?',messages:[['sam_on_the_trail','Did you see the route I sent?'],['You','Yes, Saturday looks perfect.']]},
    {id:'alex2',name:'alex_in_space',initial:'A',color:'#d5e9fa',avatarIndex:4,timeLabel:'Oct 12',accountAge:'4y',karma:'8.1k',preview:'That was a great recommendation.',messages:[['alex_in_space','That was a great recommendation.'],['You','Glad you liked it!']]},
    {id:'maya',name:'maya_reads',initial:'M',color:'#ffdbe3',avatarIndex:5,timeLabel:'Oct 10',accountAge:'1y',karma:'940',preview:'Just finished the last chapter.',messages:[['maya_reads','Just finished the last chapter.'],['You','Let’s talk about it over coffee.']]}
  ];
  const archived = {id:'river',name:'river_sketches',initial:'R',color:'#d5e9fa',avatarIndex:6,timeLabel:'Sep 28',accountAge:'3y',karma:'3.1k',preview:'An archived chat',messages:[['river_sketches','This conversation was never rendered in the list.']]};
  const legacy = {id:'oldfriend',name:'old_friend',initial:'O',color:'#d5e9fa',avatarIndex:7,timeLabel:'Aug 15',accountAge:'6y',karma:'15.4k',preview:'An older chat',messages:[['old_friend','This older chat is absent from the initial sync and native viewport.']]};

  function makeRoomIcon(avatarUrl, size = 32) {
    const icon = make('rs-room-icon');
    const r = icon.attachShadow({mode:'open'});
    r.innerHTML = `<style>:host{display:block;width:${size}px;height:${size}px;flex:none}.avatar{width:${size}px;height:${size}px;border-radius:50%;overflow:hidden;background:var(--color-neutral-background-weak,#f6f8f9);display:flex;align-items:center;justify-content:center}.avatar img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}</style><div class="avatar"><img src="${avatarUrl}" alt="" decoding="async"></div>`;
    return icon;
  }

  function build(parent, {compact = false, rich = false} = {}) {
    const app = make('rs-app');
    const root = app.attachShadow({mode:'open'});
    root.innerHTML = `<style>
      :host{--font-10:normal 400 10px/16px var(--font-sans,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif);--font-12:normal 400 12px/16px var(--font-sans,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif);--font-14:normal 400 14px/20px var(--font-sans,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif);--font-16:normal 400 16px/20px var(--font-sans,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif);--font-18:normal 400 18px/24px var(--font-sans,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif);display:grid;grid-template-rows:1fr;height:100%;background-color:var(--color-tone-7,#fff);color:var(--color-neutral-content,#333d42);font:var(--font-14);overflow:hidden;min-width:0;container-type:size}
      .rs-app-container{display:grid;grid-template-columns:${compact ? '256px' : '300px'} minmax(0,1fr);height:100%;overflow:hidden;position:relative;min-width:0}
      @container (max-width:767px){.rs-app-container{grid-template-columns:256px minmax(0,1fr)}}
      rs-rooms-nav{border-inline-end:1px solid var(--color-tone-5,#f2f2f2);min-width:0;height:100%}
      rs-room{min-width:0;min-height:0;height:100%}
    </style><div class="rs-app-container"></div>`;
    const appContainer = root.querySelector('.rs-app-container');

    const nav = make('rs-rooms-nav');
    const navRoot = nav.attachShadow({mode:'open'});
    navRoot.innerHTML = `<style>
      :host{display:flex;flex-direction:column;height:100%;overflow:visible;box-sizing:border-box;background:var(--color-tone-7,#fff);color:var(--color-neutral-content,#333d42);position:relative}
      *{box-sizing:border-box}
      .nav-head{height:56px;min-height:56px;display:flex;align-items:center;padding:12px 16px;flex-shrink:0;position:relative}
      .reddit-home{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-inline-end:8px;border-radius:50%;text-decoration:none;flex:none}
      .snoo-logo{display:block;width:20px;height:20px}
      .nav-title{font-weight:700;font-size:18px;line-height:24px;color:var(--color-neutral-content-strong,#181c1f);user-select:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
      .nav-actions{display:flex;align-items:center;margin-inline-start:auto;gap:2px}
      .icon-btn{display:inline-flex;align-items:center;justify-content:center;height:32px;min-width:32px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--color-secondary-plain,#181c1f);cursor:pointer;font:inherit;transition:background-color .12s ease}
      .icon-btn:hover{background:var(--color-button-plain-background-hover,var(--color-secondary-background-hover,#dbe4e9))}
      .icon-btn.filter-btn{padding:0 8px;gap:2px;position:relative}
      .filter-dot{position:absolute;top:5px;right:20px;width:7px;height:7px;border-radius:50%;background:#ff4500;display:none}
      .filter-btn.has-filter .filter-dot{display:block}
      .filter-menu{position:absolute;top:48px;right:12px;width:256px;background:var(--color-neutral-background-strong,var(--color-tone-7,#fff));border:1px solid var(--color-neutral-border-weak,#00000019);border-radius:12px;box-shadow:var(--boxshadow-tooltip,0 4px 16px rgba(0,0,0,.16));padding:8px 0;z-index:30;color:var(--color-tone-1,#131313)}
      .filter-menu[hidden]{display:none}
      .filter-item{display:flex;align-items:center;justify-content:space-between;width:100%;padding:10px 16px;border:0;background:transparent;color:var(--color-tone-1,#131313);font:var(--font-14);cursor:pointer;text-align:left}
      .filter-item:hover{background:var(--color-tone-6,#f8f8f8)}
      .filter-item svg{color:var(--color-primary-background,#000);flex:none}
      .switch-pill{width:32px;height:20px;border-radius:999px;background:var(--color-neutral-border,#00000033);position:relative;transition:background-color .15s}
      .switch-pill::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
      .filter-item[aria-checked="true"] .switch-pill{background:var(--color-primary,#115bca)}
      .filter-item[aria-checked="true"] .switch-pill::after{transform:translateX(12px)}
      .filter-footer{display:flex;justify-content:flex-end;padding:8px 12px 2px;border-top:1px solid var(--color-tone-5,#f2f2f2);margin-top:4px}
      .apply-btn{border:0;border-radius:999px;padding:6px 14px;background:var(--color-primary,#115bca);color:#fff;font-size:12px;font-weight:600;cursor:pointer}
      .apply-btn:hover{filter:brightness(1.06)}
      rs-rooms-nav-filter-chips{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px}
      rs-rooms-nav-filter-chips:empty{display:none}
      .filter-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;margin-bottom:8px;border-radius:999px;background:var(--color-secondary-background,#e5ebee);color:var(--color-secondary-plain,#181c1f);font-size:12px;font-weight:600;border:0;cursor:pointer}
      rs-virtual-scroll{overflow-y:auto;overflow-x:hidden;min-height:0;flex:1;overscroll-behavior-y:none}
      rs-virtual-scroll::-webkit-scrollbar{width:14px}
      rs-virtual-scroll::-webkit-scrollbar-thumb{background-clip:padding-box;background-color:var(--color-tone-4,#e4e4e4);border:3px solid transparent;border-radius:7px;min-height:50px}
      rs-virtual-scroll::-webkit-scrollbar-thumb:hover{background-color:var(--color-tone-3,#acacac)}
    </style>
    <div class="nav-head">
      <a class="reddit-home" href="#reddit" aria-label="Go to Reddit home" title="Go to Reddit home">${ICONS.snoo}</a>
      <span class="nav-title">Chats</span>
      <div class="nav-actions">
        <button type="button" class="icon-btn mark-read-btn" aria-label="Mark all messages as read" title="Mark all messages as read">${ICONS.markRead}</button>
        <button type="button" class="icon-btn new-chat-btn" aria-label="Create new chat" title="Create new chat">${ICONS.newChat}</button>
        <button type="button" class="icon-btn filter-btn" aria-label="Filter chat inbox" title="Filter chat inbox" aria-haspopup="menu" aria-expanded="false">${ICONS.filter}${ICONS.caretDown}<span class="filter-dot"></span></button>
      </div>
      <div class="filter-menu" role="menu" hidden>
        <button type="button" class="filter-item" data-filter="group" role="checkbox" aria-checked="true"><span>Group chats</span><span class="check-slot">${ICONS.checkboxFill}</span></button>
        <button type="button" class="filter-item" data-filter="direct" role="checkbox" aria-checked="true"><span>Direct chats</span><span class="check-slot">${ICONS.checkboxFill}</span></button>
        <button type="button" class="filter-item" data-filter="modmail" role="checkbox" aria-checked="true"><span>Mod mail</span><span class="check-slot">${ICONS.checkboxFill}</span></button>
        <button type="button" class="filter-item" data-filter="unread" role="switch" aria-checked="false"><span>Unread</span><span class="switch-pill"></span></button>
        <div class="filter-footer"><button type="button" class="apply-btn">Apply</button></div>
      </div>
    </div>
    <rs-rooms-nav-filter-chips></rs-rooms-nav-filter-chips>`;

    const chipsHost = navRoot.querySelector('rs-rooms-nav-filter-chips');
    const filterBtn = navRoot.querySelector('.filter-btn');
    const filterMenu = navRoot.querySelector('.filter-menu');
    const filterState = {group: true, direct: true, modmail: true, unread: false};

    const scroll = make('rs-virtual-scroll');
    const scrollRoot = scroll.attachShadow({mode:'open'});
    scrollRoot.innerHTML = `<style>
      :host{display:block}
      .threads-item{list-style:none;margin:0;padding:0}
      .threads-btn{display:flex;align-items:center;justify-content:space-between;padding:8px 16px;gap:8px;min-height:49px;color:var(--color-secondary-plain,#181c1f);cursor:pointer;user-select:none;box-sizing:border-box}
      .threads-btn:hover{background:var(--color-tone-6,#f8f8f8)}
      .threads-left{display:flex;align-items:center;gap:8px;min-width:0}
      .threads-icon{display:flex;align-items:center;justify-content:center;width:32px;height:32px;flex:none;color:var(--color-secondary-plain,#181c1f)}
      .threads-label{font-size:16px;line-height:20px;font-weight:400;color:var(--color-tone-1,#131313)}
      .threads-caret{display:flex;align-items:center;color:var(--color-secondary-plain,#181c1f)}
    </style>
    <li class="threads-item threads" data-testid="threads-button" role="presentation">
      <div class="threads-btn" role="button" tabindex="0">
        <span class="threads-left"><span class="threads-icon">${ICONS.reply}</span><span class="threads-label" data-testid="nav-item-threads">Threads</span></span>
        <span class="threads-caret">${ICONS.caretRight}</span>
      </div>
    </li>`;
    const rows = make('rs-roving-focus-native');
    scrollRoot.append(rows);
    navRoot.append(scroll);

    const room = make('rs-room');
    appContainer.append(nav, room);
    parent.append(app);
    const roomRoot = room.attachShadow({mode:'open'});

    const stateById = new Map(conversations.map(c => [c.id, {
      pinned: Boolean(c.pinned),
      unread: Number(c.unread || 0),
      preview: c.preview,
      timeLabel: c.timeLabel || '10:00 AM'
    }]));

    let active;
    const rowById = new Map();

    function syncRowUi(id) {
      const row = rowById.get(id);
      const st = stateById.get(id);
      if (!row || !st) return;
      const r = row.shadowRoot;
      const link = r.querySelector('a.container');
      link.classList.toggle('has-notifications', st.unread > 0);
      const pinIcon = r.querySelector('.pin-indicator');
      if (pinIcon) pinIcon.hidden = !st.pinned;
      const pinBtn = r.querySelector('.pin-btn');
      if (pinBtn) {
        pinBtn.innerHTML = st.pinned ? ICONS.unpin : ICONS.pin;
        pinBtn.setAttribute('aria-label', st.pinned ? 'Unpin chat' : 'Pin chat');
        pinBtn.title = st.pinned ? 'Unpin chat' : 'Pin chat';
      }
      const badge = r.querySelector('.unread-badge');
      if (badge) {
        badge.hidden = !(st.unread > 0);
        badge.textContent = st.unread > 0 ? String(st.unread) : '';
      }
      const previewEl = r.querySelector('.last-message');
      if (previewEl) previewEl.textContent = st.preview;
      const timeEl = r.querySelector('.last-message-time');
      if (timeEl) timeEl.textContent = st.timeLabel;
    }

    function applyFilterAndOrder() {
      const items = [...rows.children];
      items.sort((a, b) => {
        const sa = stateById.get(a.getAttribute('room'));
        const sb = stateById.get(b.getAttribute('room'));
        if (Boolean(sa?.pinned) !== Boolean(sb?.pinned)) return sa?.pinned ? -1 : 1;
        return Number(a.dataset.order || 0) - Number(b.dataset.order || 0);
      });
      for (const item of items) {
        const st = stateById.get(item.getAttribute('room'));
        const hiddenByUnread = filterState.unread && !(st?.unread > 0);
        const hiddenByDirect = !filterState.direct;
        item.hidden = hiddenByUnread || hiddenByDirect;
        rows.append(item);
      }
      const activeFilters = [];
      if (filterState.unread) activeFilters.push(['unread', 'Unread']);
      if (!filterState.direct) activeFilters.push(['direct', 'Direct hidden']);
      filterBtn.classList.toggle('has-filter', activeFilters.length > 0);
      chipsHost.replaceChildren();
      for (const [key, label] of activeFilters) {
        const chip = make('button', `${label} ×`, 'filter-chip');
        chip.type = 'button';
        chip.addEventListener('click', () => {
          if (key === 'unread') filterState.unread = false;
          if (key === 'direct') filterState.direct = true;
          syncFilterMenuUi();
          applyFilterAndOrder();
        });
        chipsHost.append(chip);
      }
    }

    function syncFilterMenuUi() {
      for (const item of filterMenu.querySelectorAll('.filter-item')) {
        const key = item.dataset.filter;
        const checked = Boolean(filterState[key]);
        item.setAttribute('aria-checked', String(checked));
        const slot = item.querySelector('.check-slot');
        if (slot) slot.innerHTML = checked ? ICONS.checkboxFill : ICONS.checkboxEmpty;
      }
    }

    navRoot.querySelector('.reddit-home').addEventListener('click', e => e.preventDefault());
    navRoot.querySelector('.mark-read-btn').addEventListener('click', () => {
      for (const [id, st] of stateById) { st.unread = 0; syncRowUi(id); }
      applyFilterAndOrder();
    });
    filterBtn.addEventListener('click', () => {
      const next = filterMenu.hidden;
      filterMenu.hidden = !next;
      filterBtn.setAttribute('aria-expanded', String(next));
    });
    for (const item of filterMenu.querySelectorAll('.filter-item')) {
      item.addEventListener('click', () => {
        const key = item.dataset.filter;
        filterState[key] = !filterState[key];
        syncFilterMenuUi();
      });
    }
    filterMenu.querySelector('.apply-btn').addEventListener('click', () => {
      filterMenu.hidden = true;
      filterBtn.setAttribute('aria-expanded', 'false');
      applyFilterAndOrder();
    });
    document.addEventListener('pointerdown', e => {
      if (!filterMenu.hidden && !e.composedPath().includes(filterMenu) && !e.composedPath().includes(filterBtn)) {
        filterMenu.hidden = true;
        filterBtn.setAttribute('aria-expanded', 'false');
      }
    });

    function select(conversation) {
      if (!conversation) return;
      active = conversation;
      const st = stateById.get(conversation.id);
      if (st && st.unread > 0) { st.unread = 0; syncRowUi(conversation.id); }
      room.setAttribute('room', conversation.id);
      roomRoot.replaceChildren();
      const roomAvatarUrl = defaultAvatar(conversation.avatarIndex ?? 1);

      const style = make('style');
      style.textContent = `
        :host{display:flex;height:100%;overflow:hidden;position:relative;background:var(--color-tone-7,#fff);color:var(--color-neutral-content,#333d42)}
        *{box-sizing:border-box}
        main{height:100%;display:flex;flex-direction:column;flex-grow:1;min-width:0;overflow:hidden}
        header{display:flex;align-items:center;gap:4px;height:44px;min-height:44px;width:100%;padding:0 4px 0 12px;border-bottom:1px solid var(--color-tone-5,#f2f2f2);background:var(--color-tone-7,#fff);flex-shrink:0}
        .header-identity{display:flex;align-items:center;gap:8px;min-width:0;margin-inline-end:auto;padding-inline-end:8px}
        header .name{font-size:14px;font-weight:600;line-height:20px;color:var(--color-neutral-content-strong,#181c1f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
        header .flex{display:flex;align-items:center;flex-wrap:nowrap;gap:2px;flex-shrink:0}
        header button{display:inline-flex;align-items:center;justify-content:center;background:transparent;color:var(--color-tone-2,#434343);border:0;border-radius:999px;cursor:pointer;width:32px;height:32px;padding:0;transition:background-color .12s ease}
        header button:hover{background:var(--color-button-plain-background-hover,var(--color-secondary-background-hover,#dbe4e9));color:var(--color-tone-1,#131313)}
        rs-room-banners{display:block;flex-shrink:0}
        rs-timeline{display:flex;flex-direction:column;flex:1 0 0;min-height:0;overflow:hidden;position:relative}
        .composer{display:block;padding:8px;flex-shrink:0;background:var(--color-tone-7,#fff)}
        .composer-form{display:flex;flex-direction:column;position:relative;padding:0 8px;background:var(--color-secondary-background,#e5ebee);border-radius:20px;cursor:text}
        .composer-input-row{padding:10px 0 2px}
        .composer input{box-sizing:border-box;background:transparent;border:0;outline:none;padding:0 8px;width:100%;min-height:20px;font:var(--font-14,14px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif);color:var(--color-input-text,var(--color-tone-1,#131313))}
        .composer input::placeholder{color:var(--color-neutral-content-weak,#5c6c74);opacity:1}
        .composer-actions{display:flex;align-items:center;gap:4px;padding:4px 0}
        .composer-btn{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--color-secondary-plain-weak,#5c6c74);cursor:pointer;transition:background-color .12s ease,color .12s ease}
        .composer-btn:hover:not(:disabled){background:var(--color-secondary-background-hover,#dbe4e9);color:var(--color-secondary-plain,#181c1f)}
        .composer-btn.send-btn{margin-inline-start:auto;color:var(--color-secondary-plain,#181c1f)}
        .composer-btn.send-btn:disabled{color:var(--color-button-primary-text-disabled,var(--color-tone-3,#acacac));cursor:default}
      `;
      roomRoot.append(style);

      const main = make('main');
      const header = make('header');
      const identity = make('div', null, 'header-identity');
      identity.append(makeRoomIcon(roomAvatarUrl, 32), make('span', conversation.name, 'name'));
      header.append(identity);

      const actions = make('div', null, 'flex flex-nowrap');
      const settings = make('button');
      settings.type = 'button';
      settings.innerHTML = ICONS.settings;
      settings.setAttribute('aria-label', 'Conversation settings');
      settings.title = 'Conversation settings';
      actions.append(settings);

      if (compact) {
        const popout = make('button');
        popout.type = 'button';
        popout.innerHTML = ICONS.external;
        popout.setAttribute('aria-label', 'Open chat in new tab');
        popout.title = 'Open chat in new tab';
        popout.addEventListener('click', () => api.expand?.());
        actions.append(popout);

        const minimize = make('button');
        minimize.type = 'button';
        minimize.innerHTML = ICONS.chevronDown;
        minimize.setAttribute('aria-label', 'Minimize chat window');
        minimize.title = 'Minimize chat';
        minimize.addEventListener('click', () => api.minimize());
        actions.append(minimize);

        const close = make('button');
        close.type = 'button';
        close.innerHTML = ICONS.close;
        close.setAttribute('aria-label', 'Close chat window');
        close.title = 'Close chat';
        close.addEventListener('click', () => api.minimize());
        actions.append(close);
      }
      header.append(actions);
      main.append(header, make('rs-room-banners'));

      const timeline = make('rs-timeline');
      const timelineRoot = timeline.attachShadow({mode:'open'});
      timelineRoot.innerHTML = `<style>
        :host{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;background:var(--color-tone-7,#fff)}
        rs-virtual-scroll-dynamic{display:flex;flex-direction:column;overflow-y:auto;overflow-x:hidden;flex:1;padding:0 0 8px;overscroll-behavior-y:none}
        rs-virtual-scroll-dynamic::-webkit-scrollbar{width:14px}
        rs-virtual-scroll-dynamic::-webkit-scrollbar-thumb{background-clip:padding-box;background-color:var(--color-tone-4,#e4e4e4);border:3px solid transparent;border-radius:7px;min-height:50px}
        rs-virtual-scroll-dynamic::-webkit-scrollbar-thumb:hover{background-color:var(--color-tone-3,#acacac)}
      </style>`;
      const virtual = make('rs-virtual-scroll-dynamic');
      virtual.style.overflowY = 'auto';
      virtual.style.minHeight = '0';
      const virtualRoot = virtual.attachShadow({mode:'open'});

      const vStyle = make('style');
      vStyle.textContent = `
        :host{display:flex;flex-direction:column;min-height:100%}
        .top-spacer{margin-top:auto}
        rs-room-info{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 12px 16px;text-align:center}
        .room-info-link{display:flex;flex-direction:column;align-items:center;text-decoration:none;color:var(--color-neutral-content-strong,#181c1f);gap:6px}
        .room-info-name{font-size:14px;font-weight:600;line-height:20px;color:var(--color-neutral-content-strong,#181c1f)}
        .room-info-meta{font-size:12px;line-height:16px;color:var(--color-neutral-content-weak,#5c6c74);padding-top:4px}
        .delimiter{display:flex;flex-direction:row;align-items:center;color:var(--color-neutral-content-weak,#5c6c74);font-size:10px;line-height:16px;font-weight:600;padding:8px 16px;user-select:none}
        .delimiter::before,.delimiter::after{content:'';flex:1 1 0%;border-bottom:1px solid var(--color-neutral-border-weak,#00000019);margin:auto}
        .delimiter::before{margin-inline-end:16px}
        .delimiter::after{margin-inline-start:16px}
      `;
      virtualRoot.append(vStyle);

      if (rich) {
        const info = make('rs-room-info');
        const infoLink = make('a', null, 'room-info-link');
        infoLink.href = `https://www.reddit.com/user/${encodeURIComponent(conversation.name)}`;
        infoLink.addEventListener('click', e => e.preventDefault());
        infoLink.append(makeRoomIcon(roomAvatarUrl, 48), make('div', conversation.name, 'room-info-name'));
        const meta = make('div', `Redditor for ${conversation.accountAge || '2y'} · ${conversation.karma || '1.4k'} karma`, 'room-info-meta');
        info.append(infoLink, meta);
        virtualRoot.append(info);
      }

      const delim = make('rs-timeline-delimiter');
      const dateText = new Date(1791432000000).toLocaleDateString(undefined, {month: 'short', day: 'numeric'});
      delim.append(make('div', dateText, 'delimiter'));
      virtualRoot.append(delim);

      let lastAuthor = null;
      const appendMessage = (author, text, id, {compactGroup = false} = {}) => {
        const isSelf = author === 'You';
        const avatarUrl = isSelf ? SELF_AVATAR : roomAvatarUrl;
        const isCompact = Boolean(compactGroup && rich && lastAuthor === author);
        lastAuthor = author;

        const event = make('rs-timeline-event');
        event.setAttribute('data-id', id);
        event.tabIndex = -1;
        const eventRoot = event.attachShadow({mode:'open'});
        eventRoot.innerHTML = `<style>
          :host{display:block;position:relative}
          .room-message{font:var(--font-14,14px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif);padding:4px 12px;position:relative;color:var(--color-neutral-content,#333d42)}
          .room-message:hover{background-color:var(--color-tone-6,#f8f8f8)}
          .room-message.regular{display:grid;grid-template-columns:32px minmax(0,1fr);column-gap:12px;padding-top:8px}
          .room-message.compact{padding-inline-start:56px}
          .user-avatar{grid-row:1 / span 2;width:32px;height:32px;border-radius:50%;overflow:hidden;background-color:var(--color-neutral-background-weak,#f6f8f9);background-size:cover;background-position:center;flex:none;display:flex;align-items:center;justify-content:center}
          .user-avatar img,.user-avatar svg{width:32px;height:32px;object-fit:cover;display:block;pointer-events:none}
          .msg-head{display:flex;align-items:center;gap:4px;min-height:20px}
          .user-name{font-size:14px;font-weight:700;line-height:20px;color:var(--color-tone-1,#131313)}
          time{font-size:12px;line-height:16px;color:var(--color-tone-2,#434343);margin-inline-start:2px}
          .compact-time{display:none;position:absolute;left:8px;top:6px;width:40px;text-align:right;font-size:10px;line-height:16px;color:var(--color-tone-2,#434343)}
          .room-message.compact:hover .compact-time{display:block}
          .room-message-body{display:flex;flex-direction:column;align-items:flex-start;min-width:0}
          .room-message-text{font-size:14px;line-height:20px;color:var(--color-neutral-content,#333d42);white-space:pre-line;word-break:break-word;overflow-wrap:anywhere}
          .event-menu{display:none;position:absolute;right:16px;top:0;transform:translateY(-50%);z-index:2;align-items:center;gap:2px;background:var(--color-tone-7,#fff);border:1px solid var(--color-neutral-border-weak,#00000019);border-radius:24px;box-shadow:var(--boxshadow-tooltip,0 2px 8px rgba(0,0,0,.14));padding:2px 6px}
          .room-message:hover .event-menu{display:flex}
          .event-menu button{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:var(--color-tone-2,#434343);cursor:pointer;padding:0;font-size:14px}
          .event-menu button:hover{background:var(--color-tone-6,#f8f8f8);color:var(--color-tone-1,#131313)}
          .reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
          .reactions:empty{display:none}
          .reaction-pill{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;border:1px solid var(--color-neutral-border-weak,#00000019);background:var(--color-neutral-background-weak,#f6f8f9);color:var(--color-tone-1,#131313);font-size:12px;line-height:18px;cursor:pointer}
        </style>`;

        event.event = {
          getId: () => id,
          getRoomId: () => conversation.id,
          getSender: () => isSelf ? '@t2_me:reddit.com' : `@t2_${conversation.id}:reddit.com`
        };

        const sequence = Number(/-remote-(\d+)$/.exec(id)?.[1] || 0);
        const date = new Date(1791432000000 + sequence * 60000);
        const timeStr = date.toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});

        const wrapper = make('div', null, `room-message ${isCompact ? 'compact' : 'regular'}`);
        const body = make('div', null, 'room-message-body');
        const msgText = make('div', text, 'room-message-text');
        msgText.dir = 'auto';
        const reactions = make('div', null, 'reactions');
        body.append(msgText, reactions);

        if (isCompact) {
          const compactTime = make('time', timeStr, 'compact-time');
          compactTime.dateTime = date.toISOString();
          wrapper.append(compactTime, body);
        } else {
          const avatarEl = make('div', null, 'user-avatar');
          if (rich) {
            const img = make('img');
            img.src = avatarUrl;
            img.alt = '';
            img.decoding = 'async';
            avatarEl.append(img);
          } else {
            avatarEl.style.backgroundImage = `url("${avatarUrl}")`;
          }
          const col = make('div');
          const line = make('div', null, 'msg-head');
          const nameEl = make('span', author, 'user-name');
          const timeEl = make('time', timeStr);
          timeEl.dateTime = date.toISOString();
          line.append(nameEl, timeEl);
          col.append(line, body);
          wrapper.append(avatarEl, col);
        }

        if (rich) {
          const menu = make('div', null, 'event-menu');
          const reactBtn = make('button');
          reactBtn.type = 'button';
          reactBtn.innerHTML = ICONS.emoji;
          reactBtn.setAttribute('aria-label', 'Add reaction');
          reactBtn.title = 'Add reaction';
          reactBtn.addEventListener('click', () => {
            const existing = reactions.querySelector('.reaction-pill');
            if (existing) { existing.remove(); return; }
            const pill = make('button', '👍 1', 'reaction-pill');
            pill.type = 'button';
            pill.addEventListener('click', () => pill.remove());
            reactions.append(pill);
          });
          const replyBtn = make('button');
          replyBtn.type = 'button';
          replyBtn.innerHTML = ICONS.reply.replace(/height="20" width="20"/, 'height="16" width="16"');
          replyBtn.setAttribute('aria-label', 'Reply in thread');
          replyBtn.title = 'Reply in thread';
          const moreBtn = make('button');
          moreBtn.type = 'button';
          moreBtn.innerHTML = ICONS.more;
          moreBtn.setAttribute('aria-label', 'More actions');
          moreBtn.title = 'More actions';
          menu.append(reactBtn, replyBtn, moreBtn);
          wrapper.append(menu);
        }

        eventRoot.append(wrapper);
        virtualRoot.append(event);
        return event;
      };

      conversation.messages.forEach(([author, text], i) => appendMessage(author, text, `${conversation.id}-remote-${i + 1}`));
      timelineRoot.append(virtual);
      main.append(timeline);

      const composer = make('rs-message-composer', null, 'composer');
      const form = make('form', null, 'composer-form');
      const inputRow = make('div', null, 'composer-input-row');
      const input = make('input');
      input.type = 'text';
      input.placeholder = 'Message';
      input.setAttribute('aria-label', rich ? 'Message' : 'Message (demo only)');
      inputRow.append(input);

      const bar = make('div', null, 'composer-actions');
      const mediaBtn = make('button', null, 'composer-btn');
      mediaBtn.type = 'button';
      mediaBtn.innerHTML = ICONS.image;
      mediaBtn.setAttribute('aria-label', 'Send media');
      mediaBtn.title = 'Send media';

      const emojiBtn = make('button', null, 'composer-btn');
      emojiBtn.type = 'button';
      emojiBtn.innerHTML = ICONS.emoji;
      emojiBtn.setAttribute('aria-label', 'Send an emoji');
      emojiBtn.title = 'Send an emoji';
      emojiBtn.addEventListener('click', () => {
        input.value = `${input.value}${input.value && !input.value.endsWith(' ') ? ' ' : ''}😊`;
        sendBtn.disabled = !input.value.trim();
        input.focus();
      });

      const gifBtn = make('button', null, 'composer-btn');
      gifBtn.type = 'button';
      gifBtn.innerHTML = ICONS.gif;
      gifBtn.setAttribute('aria-label', 'Send a GIF');
      gifBtn.title = 'Send a GIF';

      const sendBtn = make('button', null, 'composer-btn send-btn');
      sendBtn.type = 'submit';
      sendBtn.disabled = true;
      sendBtn.innerHTML = ICONS.send;
      sendBtn.setAttribute('aria-label', 'Send message');
      sendBtn.title = 'Send message';

      input.addEventListener('input', () => { sendBtn.disabled = !input.value.trim(); });
      form.addEventListener('submit', e => {
        e.preventDefault();
        const value = input.value.trim();
        if (!value) return;
        const list = remoteMessages.get(conversation.id);
        const nextSeq = list ? list.length : conversation.messages.length + 1;
        const eventId = `${conversation.id}-remote-${nextSeq}`;
        conversation.messages.push(['You', value]);
        if (list) list.push({event_id: eventId, type: 'm.room.message', sender: own, seq_id: String(nextSeq), origin_server_ts: Date.now(), content: {msgtype: 'm.text', body: value}});
        const node = appendMessage('You', value, eventId, {compactGroup: true});
        node.scrollIntoView?.({block: 'end'});
        const rowState = stateById.get(conversation.id);
        if (rowState) {
          rowState.preview = `You: ${value}`;
          rowState.timeLabel = new Date().toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'});
          syncRowUi(conversation.id);
        }
        input.value = '';
        sendBtn.disabled = true;
      });
      form.addEventListener('click', e => {
        if (!e.target.closest('button')) input.focus();
      });

      bar.append(mediaBtn, emojiBtn, gifBtn, sendBtn);
      form.append(inputRow, bar);
      composer.append(form);
      main.append(composer);
      roomRoot.append(main);

      api.appendMessage = (author, text, id, opts) => appendMessage(author, text, id, opts);
      for (const row of rows.children) {
        const isSelected = row.getAttribute('room') === conversation.id;
        row.toggleAttribute('selected', isSelected);
        row.shadowRoot?.querySelector('a.container')?.classList.toggle('selected', isSelected);
      }
      if (rich && typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { virtual.scrollTop = virtual.scrollHeight; });
    }

    conversations.forEach((conversation, idx) => {
      const row = make('rs-rooms-nav-room');
      row.setAttribute('room', conversation.id);
      row.dataset.order = String(idx);
      const r = row.attachShadow({mode:'open'});
      r.innerHTML = `<style>
        :host{display:block}
        :host([hidden]){display:none}
        .row-wrap{position:relative}
        a.container{display:flex;align-items:center;gap:8px;min-height:60px;padding:8px 12px;color:inherit;text-decoration:none;background-color:var(--color-tone-7,#fff);box-sizing:border-box;font:var(--font-12,12px/16px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif)}
        :host([selected]) a.container,a.container.selected,a.container:hover,a.container:focus{background-color:var(--color-tone-6,#f8f8f8);outline:none}
        .body{flex:1 1 0%;min-width:0;display:flex;flex-direction:column;gap:2px;overflow:hidden}
        .row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:0}
        .name-wrap{display:inline-flex;align-items:center;gap:4px;min-width:0;flex:1;overflow:hidden}
        .pin-indicator{display:inline-flex;align-items:center;color:var(--color-success-plain,#016e0b);flex:none}
        .pin-indicator[hidden]{display:none}
        .room-name{color:var(--color-tone-1,#131313);font:var(--font-12,12px/16px var(--font-sans,sans-serif));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .preview-wrap{display:block;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .last-message{display:block;color:var(--color-tone-2,#434343);font:var(--font-12,12px/16px var(--font-sans,sans-serif));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .last-message-time{color:var(--color-tone-2,#434343);font:var(--font-10,10px/16px var(--font-sans,sans-serif));white-space:nowrap;flex:none}
        a.container.has-notifications .room-name,a.container.has-notifications .last-message{font-weight:700;color:var(--color-tone-1,#131313)}
        .badges{display:flex;align-items:center;gap:6px;flex:none}
        .unread-badge{display:inline-flex;align-items:center;justify-content:center;min-width:16px;height:16px;padding:0 5px;border-radius:999px;background:#ff4500;color:#fff;font-size:10px;font-weight:700;line-height:1}
        .unread-badge[hidden]{display:none}
        .pin-btn{position:absolute;right:8px;top:50%;transform:translateY(-50%);display:none;align-items:center;justify-content:center;width:32px;height:32px;border:0;border-radius:999px;background:transparent;color:var(--color-tone-2,#434343);cursor:pointer;padding:0}
        .pin-btn:hover{background:var(--color-button-plain-background-hover,var(--color-secondary-background-hover,#dbe4e9));color:var(--color-tone-1,#131313)}
        .row-wrap:hover .pin-btn,.row-wrap:focus-within .pin-btn{display:inline-flex}
        .row-wrap:hover .last-message-time,.row-wrap:hover .badges{visibility:hidden}
        .row-wrap:hover .body{padding-inline-end:30px}
      </style>`;
      const wrap = make('div', null, 'row-wrap');
      const link = make('a', null, 'container');
      link.href = `https://www.reddit.com/room/${conversation.id}`;
      link.setAttribute('aria-label', `Direct chat with ${conversation.name}`);

      const icon = makeRoomIcon(defaultAvatar(conversation.avatarIndex ?? 1), 32);
      const body = make('div', null, 'body');
      const topRow = make('div', null, 'row');
      const nameWrap = make('span', null, 'name-wrap');
      const pinIndicator = make('span', null, 'pin-indicator');
      pinIndicator.innerHTML = ICONS.pinFill;
      pinIndicator.hidden = !conversation.pinned;
      nameWrap.append(pinIndicator, make('span', conversation.name, 'room-name'));
      topRow.append(nameWrap, make('span', conversation.timeLabel || '', 'last-message-time'));

      const bottomRow = make('div', null, 'row');
      const previewWrap = make('div', null, 'preview-wrap');
      previewWrap.append(make('span', conversation.preview, 'last-message preview'));
      const badges = make('div', null, 'badges');
      const unreadBadge = make('span', conversation.unread ? String(conversation.unread) : '', 'unread-badge');
      unreadBadge.hidden = !conversation.unread;
      badges.append(unreadBadge);
      bottomRow.append(previewWrap, badges);
      body.append(topRow, bottomRow);

      link.append(icon, body);
      link.addEventListener('click', event => { event.preventDefault(); select(conversation); });

      const pinBtn = make('button', null, 'pin-btn');
      pinBtn.type = 'button';
      pinBtn.tabIndex = -1;
      pinBtn.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        const st = stateById.get(conversation.id);
        if (st) { st.pinned = !st.pinned; syncRowUi(conversation.id); applyFilterAndOrder(); }
      });

      wrap.append(link, pinBtn);
      r.append(wrap);
      rows.append(row);
      rowById.set(conversation.id, row);
      syncRowUi(conversation.id);
    });

    const all = [...conversations, archived, legacy];
    const cachedIds = new Set(all.filter(c => c !== legacy).map(c => c.id));
    const directMap = Object.fromEntries(all.map(c => [`@t2_${c.id}:reddit.com`, [c.id]]));
    const avatarFor = c => defaultAvatar(c?.avatarIndex ?? 1);
    const members = Object.fromEntries(all.map(c => [`t2_${c.id}`, {displayName: c.name, name: c.name, prefixedName: `u/${c.name}`, avatar: {src: avatarFor(c)}}]));
    const users = {getRedditUserById: async id => members[id]};
    for (const row of rows.children) row.users = users;
    const own = '@t2_me:reddit.com';
    const remoteMessages = new Map(all.map(c => [c.id, [['You', `An archive message from the beginning of the conversation.`], ...c.messages].map(([author, text], i) => ({event_id: `${c.id}-remote-${i}`, type: 'm.room.message', sender: author === 'You' ? own : `@t2_${c.id}:reddit.com`, seq_id: String(i), origin_server_ts: 1791432000000 + i * 60000, content: {msgtype: 'm.text', body: text}}))]));
    const calls = [];
    const matrix = make('rs-matrix-client');
    matrix.client = {
      getUserId: () => own,
      isInitialSyncComplete: () => true,
      getUser: id => ({rawDisplayName: id === own ? 'You' : '', avatarUrl: id === own ? SELF_AVATAR : ''}),
      getRoom: id => cachedIds.has(id) ? {roomId: id, name: all.find(c => c.id === id)?.name, summaryHeroes: [`@t2_${id}:reddit.com`]} : null,
      getRooms: () => all.filter(c => cachedIds.has(c.id)).map(c => ({roomId: c.id, name: c.name, summaryHeroes: [`@t2_${c.id}:reddit.com`]})),
      getAccountData: type => type === 'm.direct' ? {getContent: () => directMap} : null,
      storeInactiveRoom: raw => { cachedIds.add(raw.room_id); calls.push({method: 'cache-room', roomId: raw.room_id}); },
      getRoomList: async options => {
        calls.push({method: 'rooms', options});
        const filtered = options.with_user ? all.filter(c => options.with_user === `@t2_${c.id}:reddit.com`) : all;
        const offset = Number(options.next_batch || 0);
        const size = options.page_size || 200;
        const selected = filtered.slice(offset, offset + size);
        return {
          rooms: selected.map(c => ({
            room_id: c.id,
            membership: 'join',
            last_seq_id: '100',
            state: [
              {type: 'com.reddit.chat.type', content: {type: 'direct', participants: [own, `@t2_${c.id}:reddit.com`]}},
              {type: 'm.room.member', state_key: `@t2_${c.id}:reddit.com`, content: {membership: 'join', displayname: c.name, avatar_url: avatarFor(c)}}
            ]
          })),
          ...(offset + size < filtered.length ? {next_batch: String(offset + size)} : {})
        };
      },
      http: {
        authedRequest: async (method, path, params = {}) => {
          calls.push({method, path, params});
          if (path.endsWith('/account_data/m.direct')) return directMap;
          if (path === '/sync') {
            return {
              next_batch: 'snapshot',
              rooms: {
                join: Object.fromEntries(all.filter(c => c !== legacy).map(c => [c.id, {
                  state: {
                    events: [
                      {type: 'com.reddit.chat.type', content: {type: 'direct', participants: [own, `@t2_${c.id}:reddit.com`]}},
                      {type: 'm.room.member', state_key: `@t2_${c.id}:reddit.com`, content: {membership: 'join', displayname: c.name, avatar_url: avatarFor(c)}}
                    ]
                  }
                }]))
              }
            };
          }
          const id = decodeURIComponent(path.split('/')[2]);
          if (path.endsWith('/members')) {
            const c = all.find(item => item.id === id);
            return {chunk: c ? [{type: 'm.room.member', state_key: `@t2_${id}:reddit.com`, content: {membership: 'join', displayname: c.name, avatar_url: avatarFor(c)}}] : []};
          }
          const events = remoteMessages.get(id) || [];
          const cursor = params.seq === undefined ? Infinity : Number(params.seq);
          return {events: events.filter(e => Number(e.seq_id) <= cursor).slice(-3).reverse()};
        }
      }
    };
    const history = make('rs-history');
    history.navigate = async route => {
      const pieces = route.split('/');
      const id = decodeURIComponent(pieces[2]);
      select(all.find(c => c.id === id));
      if (pieces[3] === 'event') {
        const eventId = decodeURIComponent(pieces[4]);
        const message = remoteMessages.get(id)?.find(e => e.event_id === eventId);
        if (message) {
          const event = api.appendMessage(message.sender === own ? 'You' : active.name, message.content.body, message.event_id);
          event.scrollIntoView?.({block: 'center'});
        }
      }
    };
    app.append(matrix, history);
    const api = {
      app, nav, room, calls, remoteMessages,
      select: id => select(all.find(c => c.id === id)),
      minimize: () => {},
      expand: () => {},
      avatarForId: id => avatarFor(all.find(c => c.id === id)),
      get active() { return active; }
    };
    select(conversations[0]);
    return api;
  }
  globalThis.ChatFixture = {build, conversations, defaultAvatar, SELF_AVATAR};
})();
