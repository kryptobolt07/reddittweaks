/* Shared feed filters (date, post type, subreddit, extra sort) for profile and subreddit archive feeds.
   Pure state, URL sync, predicate, and menu/chip builders; no page logic lives here. */
(() => {
  'use strict';
  const params={date:'rt_date',types:'rt_type',subreddits:'rt_sub',sort:'rt_sort'};
  // Post types, grouped in the menu's sections. Icons are Reddit's own (see iconPaths); GIF is a text tag.
  const typeDefs=Object.freeze([
    {id:'text',label:'Text',icon:'text-post',section:'Text'},{id:'textmedia',label:'Text with media',icon:'collection',section:'Text'},{id:'poll',label:'Polls',icon:'list-bulleted',section:'Text'},
    {id:'image',label:'Images',icon:'image',section:'Media'},{id:'gif',label:'GIFs',icon:'gif',section:'Media'},{id:'video',label:'Videos',icon:'video',section:'Media'},{id:'gallery',label:'Galleries',icon:'gallery',section:'Media'},
    {id:'link',label:'Links',icon:'link',section:'Links'},{id:'embed',label:'Embedded media',icon:'browser',section:'Links'},{id:'crosspost',label:'Crossposts',icon:'rotate',section:'Links'}]);
  const types=Object.freeze(typeDefs.map(t=>t.id));
  const typeLabels=Object.freeze(Object.fromEntries(typeDefs.map(t=>[t.id,t.label])));
  const typeIcons=Object.freeze(Object.fromEntries(typeDefs.map(t=>[t.id,t.icon])));
  const typeSections=Object.freeze(['Text','Media','Links'].map(label=>Object.freeze({label,types:Object.freeze(typeDefs.filter(t=>t.section===label).map(t=>t.id))})));
  // 20x20 filled glyphs harvested from Reddit's own pages (fill=currentColor), plus one calendar drawn in the same outline weight.
  const iconPaths={
    'text-post':["M14.7 2H5.3C3.48 2 2 3.48 2 5.3v9.4C2 16.52 3.48 18 5.3 18h9.4c1.82 0 3.3-1.48 3.3-3.3V5.3C18 3.48 16.52 2 14.7 2Zm1.5 12.7c0 .83-.67 1.5-1.5 1.5H5.3c-.83 0-1.5-.67-1.5-1.5V5.3c0-.83.67-1.5 1.5-1.5h9.4c.83 0 1.5.67 1.5 1.5v9.4Z", "M12 11.1H6v1.8h6v-1.8ZM14 7.1H6v1.8h8V7.1Z"],
    'collection':["M17.5 8.56V7.08c0-1.17-.7-2.17-1.7-2.63V3.5A2.5 2.5 0 0013.3 1H6.7a2.5 2.5 0 00-2.5 2.5v.95c-1 .46-1.7 1.46-1.7 2.63v1.48c-.9.59-1.5 1.6-1.5 2.76v4.38C1 17.52 2.48 19 4.3 19h11.4c1.82 0 3.3-1.48 3.3-3.3v-4.38c0-1.16-.6-2.17-1.5-2.76ZM4.3 8.02v-.94c0-.61.49-1.1 1.1-1.1h9.2c.61 0 1.1.49 1.1 1.1v.94H4.3ZM6.7 2.8h6.6c.39 0 .7.31.7.7v.68H6V3.5c0-.39.31-.7.7-.7Zm10.5 12.9c0 .83-.67 1.5-1.5 1.5H4.3c-.83 0-1.5-.67-1.5-1.5v-4.38c0-.83.67-1.5 1.5-1.5h11.4c.83 0 1.5.67 1.5 1.5v4.38Z", "M10 14.51a1.5 1.5 0 100-3 1.5 1.5 0 000 3Z"],
    'list-bulleted':"M4 2.45c-.86 0-1.55.69-1.55 1.55 0 .86.69 1.55 1.55 1.55.86 0 1.55-.69 1.55-1.55 0-.86-.69-1.55-1.55-1.55ZM4 8.45c-.86 0-1.55.69-1.55 1.55 0 .86.69 1.55 1.55 1.55.86 0 1.55-.69 1.55-1.55 0-.86-.69-1.55-1.55-1.55ZM4 14.45c-.86 0-1.55.69-1.55 1.55 0 .86.69 1.55 1.55 1.55.86 0 1.55-.69 1.55-1.55 0-.86-.69-1.55-1.55-1.55ZM9 4.9h8c.5 0 .9-.4.9-.9s-.4-.9-.9-.9H9c-.5 0-.9.4-.9.9s.4.9.9.9ZM17 15.1H9c-.5 0-.9.4-.9.9s.4.9.9.9h8c.5 0 .9-.4.9-.9s-.4-.9-.9-.9ZM17 9.1H9c-.5 0-.9.4-.9.9s.4.9.9.9h8c.5 0 .9-.4.9-.9s-.4-.9-.9-.9Z",
    'image':"M14.6 2H5.4A3.4 3.4 0 002 5.4v9.2A3.4 3.4 0 005.4 18h9.2a3.4 3.4 0 003.4-3.4V5.4A3.4 3.4 0 0014.6 2ZM5.4 3.8h9.2c.882 0 1.6.718 1.6 1.6v9.2c0 .484-.22.913-.561 1.207l-5.675-5.675a3.39 3.39 0 00-2.404-.996c-.87 0-1.74.332-2.404.996L3.8 11.488V5.4c0-.882.718-1.6 1.6-1.6ZM3.8 14.6v-.567l2.629-2.628a1.59 1.59 0 011.131-.469c.427 0 .829.166 1.131.469l4.795 4.795H5.4c-.882 0-1.6-.718-1.6-1.6Zm6.95-7.1a1.75 1.75 0 113.5 0 1.75 1.75 0 01-3.5 0Z",
    'video':"M8.797 14a1.78 1.78 0 01-.865-.224A1.816 1.816 0 017 12.187V7.812c0-.662.358-1.27.932-1.589a1.786 1.786 0 011.83.06L13.17 8.47c.521.334.831.906.831 1.53 0 .622-.31 1.194-.83 1.528l-3.408 2.187a1.79 1.79 0 01-.965.283V14Zm0-6.188v4.375L12.204 10 8.797 7.812ZM10 18.9c-1.516 0-2.946-.186-4.372-.57a5.626 5.626 0 01-3.958-3.956 16.605 16.605 0 01-.57-4.37c0-1.514.187-2.944.57-4.37a5.626 5.626 0 013.958-3.958 16.902 16.902 0 018.744 0 5.626 5.626 0 013.958 3.956c.384 1.428.57 2.858.57 4.371 0 1.513-.187 2.943-.57 4.37a5.626 5.626 0 01-3.958 3.957c-1.426.384-2.856.57-4.372.57Zm-6.592-4.994a3.818 3.818 0 002.686 2.686 15.12 15.12 0 007.81 0 3.814 3.814 0 002.686-2.686c.342-1.273.508-2.55.508-3.903 0-1.353-.166-2.63-.508-3.904a3.818 3.818 0 00-2.686-2.686 15.12 15.12 0 00-7.81 0A3.814 3.814 0 003.408 6.1a14.841 14.841 0 00-.508 3.903c0 1.353.166 2.63.508 3.903v.001Z",
    'gallery':["M15.7 5H15v-.7C15 2.48 13.52 1 11.7 1H4.3C2.48 1 1 2.48 1 4.3v7.4C1 13.52 2.48 15 4.3 15H5v.7C5 17.52 6.48 19 8.3 19h7.4c1.82 0 3.3-1.48 3.3-3.3V8.3C19 6.48 17.52 5 15.7 5ZM4.3 13.2c-.83 0-1.5-.67-1.5-1.5V4.3c0-.83.67-1.5 1.5-1.5h7.4c.83 0 1.5.67 1.5 1.5V5H8.3C6.48 5 5 6.48 5 8.3v4.9h-.7Zm2.69 3.22 2.24-2.24c.5-.5 1.31-.5 1.81 0l3.03 3.02H8.3c-.57 0-1.05-.32-1.31-.78Zm10.21-.72c0 .56-.32 1.05-.78 1.31l-4.1-4.1a3.09 3.09 0 00-4.36 0L6.8 14.07V8.31c0-.83.67-1.5 1.5-1.5h7.4c.83 0 1.5.67 1.5 1.5v7.39Z", "M14 11.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3Z"],
    'link':"M14.088 11.843a.9.9 0 01-.637-1.536l1.97-1.971a2.66 2.66 0 000-3.757c-1.003-1.003-2.754-1.005-3.756 0L9.694 6.55A.9.9 0 118.42 5.278l1.97-1.971a4.427 4.427 0 013.152-1.306c1.19 0 2.31.463 3.152 1.305a4.463 4.463 0 010 6.303l-1.971 1.971a.897.897 0 01-.637.264v-.001Zm-4.48 4.851 1.97-1.97a.9.9 0 10-1.273-1.272l-1.97 1.97c-1.003 1.004-2.755 1.002-3.757 0a2.66 2.66 0 010-3.757l1.97-1.971a.898.898 0 000-1.272.901.901 0 00-1.272 0l-1.971 1.971a4.463 4.463 0 000 6.303 4.43 4.43 0 003.152 1.305c1.19 0 2.31-.465 3.151-1.307Zm-.747-4.282 3.55-3.55a.9.9 0 10-1.272-1.273l-3.551 3.55a.9.9 0 00.637 1.537.9.9 0 00.637-.263l-.001-.001Z",
    'browser':"M10 1c-4.96 0-9 4.04-9 9s4.04 9 9 9 9-4.04 9-9-4.04-9-9-9Zm7.15 8.2h-3.17c-.1-2.37-.62-4.46-1.4-5.91 2.46.95 4.27 3.2 4.57 5.91Zm-7.15 8c-.66 0-2.2-2.24-2.38-6.4h4.76c-.18 4.16-1.73 6.4-2.38 6.4Zm-2.38-8C7.8 5.04 9.35 2.8 10 2.8c.65 0 2.2 2.24 2.38 6.4H7.62Zm-.2-5.91c-.78 1.45-1.3 3.55-1.4 5.91H2.85c.3-2.71 2.11-4.97 4.57-5.91ZM2.85 10.8h3.17c.1 2.37.62 4.46 1.4 5.91-2.46-.95-4.27-3.2-4.57-5.91Zm9.73 5.91c.78-1.45 1.3-3.55 1.4-5.91h3.17a7.188 7.188 0 01-4.57 5.91Z",
    'rotate':"M18 10.1a.9.9 0 01-1.8 0c0-2.867-2.332-5.2-5.199-5.2H8.074l.564.564a.9.9 0 01-1.274 1.272l-2.1-2.1a.898.898 0 010-1.272l2.1-2.1a.9.9 0 111.273 1.272l-.564.564H11c3.859 0 7 3.14 7 7Zm-5.363 3.164a.9.9 0 10-1.273 1.272l.564.564H9.001a5.205 5.205 0 01-5.199-5.2.9.9 0 00-1.8 0c0 3.86 3.141 7 7 7h2.927l-.564.564a.9.9 0 001.274 1.272l2.1-2.1a.898.898 0 000-1.272l-2.102-2.1Z",
    'community-fill':"M11.977 13.79h-1.955l4.549-10.715a.81.81 0 00-.381-1.032C12.447 1.12 10.37.747 8.179 1.18c-3.612.716-6.471 3.68-7.059 7.316a9.01 9.01 0 0010.409 10.377c3.735-.616 6.741-3.635 7.347-7.371.453-2.8-.388-5.405-2.017-7.322a.505.505 0 00-.853.119l-4.029 9.49ZM9.98 8.118a1.752 1.752 0 00-1.148.167 1.664 1.664 0 00-.651.596 1.703 1.703 0 00-.258.948v3.96H5.998V6.322h1.876v1.074h.035c.251-.344.567-.628.948-.851a2.55 2.55 0 011.311-.335c.172 0 .335.014.488.042.153.028.267.058.342.09l-.774 1.849a.766.766 0 00-.244-.073Z",
    'profile-fill':"M10 1c-4.96 0-9 4.04-9 9s4.04 9 9 9 9-4.04 9-9-4.04-9-9-9Zm0 4.5c1.52 0 2.75 1.23 2.75 2.75S11.52 11 10 11 7.25 9.77 7.25 8.25 8.48 5.5 10 5.5Zm-4.97 9.69C5.91 13.31 7.8 12 10 12c2.2 0 4.09 1.31 4.97 3.19A7.153 7.153 0 0110 17.2c-1.93 0-3.68-.77-4.97-2.01Z",
    'card':"M14.7 2H5.3C3.48 2 2 3.48 2 5.3v9.4C2 16.52 3.48 18 5.3 18h9.4c1.82 0 3.3-1.48 3.3-3.3V5.3C18 3.48 16.52 2 14.7 2ZM5.3 3.8h9.4c.83 0 1.5.67 1.5 1.5v3.8H3.8V5.3c0-.83.67-1.5 1.5-1.5Zm9.4 12.4H5.3c-.83 0-1.5-.67-1.5-1.5v-3.8h12.4v3.8c0 .83-.67 1.5-1.5 1.5Z",
    'archive':"M15.7 1H4.3C2.48 1 1 2.48 1 4.3v2.76c0 .5.4.9.9.9H2v6.74C2 16.52 3.48 18 5.3 18h9.4c1.82 0 3.3-1.48 3.3-3.3V7.96h.1c.5 0 .9-.4.9-.9V4.3C19 2.48 17.52 1 15.7 1ZM13 11.87H7v-1.8h6v1.8Zm4.2-5.71H2.8V4.3c0-.83.67-1.5 1.5-1.5h11.4c.83 0 1.5.67 1.5 1.5v1.86Z",
    'checkmark':"M7.09 15.84c-.23 0-.46-.09-.64-.26L1.3 10.42a.9.9 0 010-1.27.9.9 0 011.27 0l4.52 4.52L17.5 3.26a.9.9 0 011.27 0 .9.9 0 010 1.27L7.73 15.58c-.18.18-.41.26-.64.26Z",
    'chevron-right':"M7.5 17.9a.898.898 0 01-.636-1.536L13.227 10 6.864 3.636a.898.898 0 010-1.272.898.898 0 011.272 0l7 7a.898.898 0 010 1.272l-7 7a.897.897 0 01-.636.264Z",
    'arrow-back':"M17.5 9.1H4.679l5.487-5.462a.898.898 0 00.003-1.272.898.898 0 00-1.272-.003l-7.032 7a.898.898 0 000 1.275l7.03 7a.896.896 0 001.273-.003.898.898 0 00-.002-1.272l-5.487-5.462h12.82a.9.9 0 000-1.8Z",
    'activity':"M10 1c-.5 0-.9.4-.9.9v.17C5.11 2.52 2 5.9 2 10c0 4.41 3.59 8 8 8 4.11 0 7.48-3.11 7.93-7.1h.17c.5 0 .9-.4.9-.9 0-4.96-4.04-9-9-9Zm.9 1.86c3.25.41 5.84 2.99 6.24 6.24H10.9V2.86ZM10 16.2c-3.42 0-6.2-2.78-6.2-6.2 0-3.11 2.31-5.69 5.3-6.12V10c0 .5.4.9.9.9h6.12c-.44 2.99-3.01 5.3-6.12 5.3Z",
    // Reddit's outline glyphs; community uses its captured ring and r/ geometry.
    // Sort: an up arrow beside a down arrow; New: a sparkle.
    'sort':["M6.5 2.1a.9.9 0 01.64.26l3.2 3.2a.9.9 0 01-1.28 1.28L7.4 5.17V17.1a.9.9 0 01-1.8 0V5.17L3.94 6.84a.9.9 0 01-1.28-1.28l3.2-3.2a.9.9 0 01.64-.26Z","M13.5 17.9a.9.9 0 01-.64-.26l-3.2-3.2a.9.9 0 011.28-1.28l1.66 1.67V2.9a.9.9 0 011.8 0v11.93l1.66-1.67a.9.9 0 011.28 1.28l-3.2 3.2a.9.9 0 01-.64.26Z"],
    'new':"M10 1.5c.4 0 .75.27.86.66l1.1 3.88a2.7 2.7 0 001.86 1.86l3.88 1.1a.9.9 0 010 1.72l-3.88 1.1a2.7 2.7 0 00-1.86 1.86l-1.1 3.88a.9.9 0 01-1.72 0l-1.1-3.88a2.7 2.7 0 00-1.86-1.86l-3.88-1.1a.9.9 0 010-1.72l3.88-1.1a2.7 2.7 0 001.86-1.86l1.1-3.88A.9.9 0 0110 1.5Z",
    'caret-up-down':"M13.21 8c-.23 0-.46-.09-.63-.26L10 5.16 7.42 7.74a.9.9 0 01-1.27 0 .9.9 0 010-1.27l3.21-3.21a.9.9 0 011.27 0l3.21 3.21A.894.894 0 0113.21 8ZM10 17c-.23 0-.46-.09-.63-.26l-3.21-3.21a.9.9 0 010-1.27.9.9 0 011.27 0l2.58 2.58 2.58-2.58a.9.9 0 011.27 0 .9.9 0 010 1.27l-3.21 3.21c-.17.17-.4.26-.63.26H10Z",
    'search':"m18.736 17.464-3.483-3.483A7.961 7.961 0 0016.999 9 8 8 0 109 17a7.961 7.961 0 004.981-1.746l3.483 3.483a.9.9 0 101.272-1.273ZM9 15.2A6.207 6.207 0 012.8 9c0-3.419 2.781-6.2 6.2-6.2s6.2 2.781 6.2 6.2-2.781 6.2-6.2 6.2Z",
    'close':"m11.273 10 5.363-5.363a.9.9 0 10-1.273-1.273L10 8.727 4.637 3.364a.9.9 0 10-1.273 1.273L8.727 10l-5.363 5.363a.9.9 0 101.274 1.273L10 11.273l5.363 5.363a.897.897 0 001.274 0 .9.9 0 000-1.273L11.275 10h-.002Z",
    'community':["M10 2.8c3.97 0 7.2 3.23 7.2 7.2s-3.23 7.2-7.2 7.2-7.2-3.23-7.2-7.2S6.03 2.8 10 2.8ZM10 1a9 9 0 10.001 18.001A9 9 0 0010 1Z","M9.98 8.118a1.752 1.752 0 00-1.148.167 1.664 1.664 0 00-.651.596 1.703 1.703 0 00-.258.948v3.96H5.998V6.322h1.876v1.074h.035c.251-.344.567-.628.948-.851a2.55 2.55 0 011.311-.335c.172 0 .335.014.488.042.153.028.267.058.342.09l-.774 1.849a.766.766 0 00-.244-.073Z","M11.977 13.79h-1.955l4.549-10.715 1.657.7-4.251 10.015Z"],
    'classic':"M14.7 2H5.3C3.48 2 2 3.48 2 5.3v9.4C2 16.52 3.48 18 5.3 18h9.4c1.82 0 3.3-1.48 3.3-3.3V5.3C18 3.48 16.52 2 14.7 2ZM5.3 3.8h9.4c.83 0 1.5.67 1.5 1.5v1.43H3.8V5.3c0-.83.67-1.5 1.5-1.5Zm10.9 4.73v2.93H3.8V8.53h12.4Zm-1.5 7.67H5.3c-.83 0-1.5-.67-1.5-1.5v-1.43h12.4v1.43c0 .83-.67 1.5-1.5 1.5Z",
    'hot':"M14.92 6.703c-1.905-1.562-2.146-2.81-1.933-4.701a.905.905 0 00-.28-.758.895.895 0 00-.773-.23c-3.256.587-5.18 2.649-5.735 6.14a16.896 16.896 0 01-.67-.697.895.895 0 00-.644-.294.911.911 0 00-.658.264c-1.444 1.445-2.334 3.867-2.214 6.029C2.192 15.69 4.758 19 10.002 19c3.79 0 6.54-1.64 7.627-4.498.997-2.625-.04-5.613-2.707-7.8h-.001Zm-6.958 8.76c0-1.097 1.033-2.402 2.037-3.451 1.01 1.054 2.049 2.363 2.049 3.45 0 .829-.645 1.735-2.048 1.735-1.39 0-2.038-.908-2.038-1.734Zm7.983-1.601A4.804 4.804 0 0113.7 16.39a3.38 3.38 0 00.148-.928c0-2.262-2.254-4.465-3.85-5.973-1.59 1.502-3.837 3.697-3.837 5.973 0 .298.056.596.136.89-1.671-.932-2.407-2.495-2.49-3.997-.073-1.334.364-2.838 1.106-3.94.678.553 1.559 1.076 2.4 1.224.29-1.636.772-3.105 1.155-3.998.535-1.248 1.413-2.087 2.658-2.553.024 1.76.635 3.35 2.654 5.005 2.049 1.68 2.877 3.89 2.165 5.768h-.001Z",
    'top':"M17.1 11.03h-3.3V8.98h1.17a1.328 1.328 0 00.94-2.27l-5.27-5.28c-.34-.34-.94-.34-1.27 0L4.09 6.71c-.38.38-.49.95-.29 1.45.21.5.69.82 1.23.82H6.2v2.05H2.9a1.9 1.9 0 00-1.9 1.9v2.6c0 1.82 1.48 3.3 3.3 3.3h11.4c1.82 0 3.3-1.48 3.3-3.3v-2.6a1.9 1.9 0 00-1.9-1.9ZM10 3.34l3.83 3.84H12v7.85c0 1.1-.9 2-2 2s-2-.9-2-2V7.18H6.17L10 3.34ZM2.8 15.52v-2.6c0-.06.04-.1.1-.1h3.3v2.2c0 .74.22 1.42.58 2H4.3c-.83 0-1.5-.67-1.5-1.5Zm14.4 0c0 .83-.67 1.5-1.5 1.5h-2.48c.36-.58.58-1.26.58-2v-2.2h3.3c.05 0 .1.04.1.1v2.6Z",
    calendar:'M5.6 1h1.8v2H5.6V1Zm7 0h1.8v2h-1.8V1ZM5 3h10a3 3 0 013 3v9a3 3 0 01-3 3H5a3 3 0 01-3-3V6a3 3 0 013-3Zm0 1.8c-.72 0-1.2.48-1.2 1.2v.4h12.4V6c0-.72-.48-1.2-1.2-1.2H5ZM3.8 8.2V15c0 .72.48 1.2 1.2 1.2h10c.72 0 1.2-.48 1.2-1.2V8.2H3.8Z'
  };
  const SVG='http://www.w3.org/2000/svg';
  // An SVG glyph for a known icon name (20x20 viewBox), or the GIF tag. Null for unknown names.
  function svgIcon(name,size=20){
    if(name==='gif'){const tag=document.createElement('span');tag.className='rt-gif-tag';tag.dataset.icon='gif';tag.setAttribute('aria-hidden','true');tag.textContent='GIF';return tag;}
    const paths=iconPaths[name];if(!paths)return null;
    const s=document.createElementNS(SVG,'svg');s.setAttribute('viewBox','0 0 20 20');s.setAttribute('fill','currentColor');s.setAttribute('width',String(size));s.setAttribute('height',String(size));
    s.setAttribute('icon-name',name);s.setAttribute('aria-hidden','true');s.dataset.icon=name;s.dataset.nativeIcon='true';s.classList.add('rt-activity-icon');
    for(const d of [].concat(paths)){const path=document.createElementNS(SVG,'path');path.setAttribute('d',d);if(name==='calendar')path.setAttribute('fill-rule','evenodd');s.append(path);}
    return s;
  }
  const incomingHour={id:'hour',label:'Past hour',seconds:3600};
  const presets=Object.freeze([{id:'24h',label:'Past 24 hours',seconds:86400},{id:'week',label:'Past week',seconds:604800},{id:'month',label:'Past month',seconds:2592000},{id:'year',label:'Past year',seconds:31536000}]);
  const sorts=Object.freeze(['old','comments']),maxSubreddits=8;
  const isoDay=/^(\d{4})-(\d{2})-(\d{2})$/;
  const validDay=value=>{const m=isoDay.exec(value||'');if(!m)return false;const d=new Date(+m[1],+m[2]-1,+m[3]);return d.getFullYear()===+m[1] && d.getMonth()===+m[2]-1 && d.getDate()===+m[3];};
  const empty=()=>({date:null,types:[],subreddits:[],sort:null});
  const clone=state=>({date:state.date?{...state.date}:null,types:[...state.types],subreddits:[...state.subreddits],sort:state.sort});
  const subName=value=>String(value||'').trim().replace(/^\/?r\//i,'').replace(/[^\w]/g,'').slice(0,40);
  // Reddit's own post-type values, and archive values, reduced to ours. Unknown values map to ''.
  const typeAliases={self:'text',rtjson:'text',richtext:'text',text_only:'text',multi_media:'textmedia',text_media:'textmedia',polls:'poll',gifs:'gif',images:'image',videos:'video',galleries:'gallery',links:'link',crossposts:'crosspost',embedded:'embed',
    'hosted:video':'video',video_link:'video',reddit_video:'video',hosted_video:'video','rich:video':'embed',multi_image:'gallery',gallery_post:'gallery',image_link:'image',hosted_image:'image',article:'link',external:'link',article_link:'link'};
  function normalizeType(value){
    const v=String(value||'').trim().toLowerCase();
    if(types.includes(v))return v;
    return typeAliases[v]||'';
  }
  function parse(search){
    const p=new URLSearchParams(search||''),state=empty(),date=p.get(params.date);
    if(date==='hour' || presets.some(x=>x.id===date))state.date={preset:date};
    else{const m=/^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(date||'');if(m && validDay(m[1]) && validDay(m[2]))state.date=m[1]<=m[2]?{from:m[1],to:m[2]}:{from:m[2],to:m[1]};}
    for(const raw of (p.get(params.types)||'').split(',')){const t=normalizeType(raw);if(t && !state.types.includes(t))state.types.push(t);}
    for(const s of (p.get(params.subreddits)||'').split(',')){const n=subName(s);if(n && state.subreddits.length<maxSubreddits && !state.subreddits.some(x=>x.toLowerCase()===n.toLowerCase()))state.subreddits.push(n);}
    const sort=p.get(params.sort);if(sorts.includes(sort))state.sort=sort;
    return state;
  }
  function dateParam(date){return date?.preset?date.preset:date?.from && date?.to?date.from+'..'+date.to:'';}
  // Only the rt_* values for a state, in a stable order.
  function serialize(state){
    const out={},date=dateParam(state.date);
    if(date)out[params.date]=date;if(state.types.length)out[params.types]=state.types.join(',');if(state.subreddits.length)out[params.subreddits]=state.subreddits.join(',');if(state.sort)out[params.sort]=state.sort;
    return out;
  }
  const isActive=state=>Boolean(state.date || state.types.length || state.subreddits.length || state.sort);
  const equal=(a,b)=>JSON.stringify(serialize(a))===JSON.stringify(serialize(b));
  // Search string with our params replaced and everything else kept as-is.
  function applyToSearch(search,state){
    const p=new URLSearchParams(search||'');for(const name of Object.values(params))p.delete(name);
    for(const [name,value] of Object.entries(serialize(state)))p.set(name,value);
    const text=p.toString().replace(/%2C/gi,',');return text?'?'+text:'';
  }
  // history.replaceState keeps history.state; no navigation, no popstate.
  function write(state,{location:loc=globalThis.location,history:hist=globalThis.history}={}){
    const search=applyToSearch(loc.search,state);if(search===loc.search)return false;
    try{hist.replaceState(hist.state,'',loc.pathname+search+loc.hash);return true;}catch{return false;}
  }
  const read=(loc=globalThis.location)=>parse(loc.search);
  // Inclusive seconds range {after,before}: after is the start, before is exclusive. Null when no date filter.
  function dateRange(state,now=Date.now()/1000){
    const date=state.date;if(!date)return null;
    if(date.preset){const preset=date.preset==='hour'?incomingHour:presets.find(x=>x.id===date.preset);return preset?{after:Math.floor(now-preset.seconds),before:null}:null;}
    const [fy,fm,fd]=date.from.split('-').map(Number),[ty,tm,td]=date.to.split('-').map(Number);
    return {after:Math.floor(new Date(fy,fm-1,fd).getTime()/1000),before:Math.floor(new Date(ty,tm-1,td+1).getTime()/1000)};
  }
  // item: {created (seconds), postType, subreddit, kind}. Comments carry no post type, so a type filter excludes them.
  function predicate(state,now=Date.now()/1000){
    const range=dateRange(state,now),wanted=new Set(state.types),subs=new Set(state.subreddits.map(s=>s.toLowerCase()));
    return item=>{
      if(range){const t=Number(item.created);if(!Number.isFinite(t) || t<range.after || range.before!=null && t>=range.before)return false;}
      if(wanted.size && (item.kind==='comment' || !wanted.has(normalizeType(item.postType))))return false;
      if(subs.size && !subs.has(subName(item.subreddit).toLowerCase()))return false;
      return true;
    };
  }
  // Hosts whose links play inside Reddit as embeds.
  const embedHosts=/(^|\.)(youtube\.com|youtu\.be|vimeo\.com|streamable\.com|twitch\.tv|dailymotion\.com|dai\.ly|gfycat\.com|redgifs\.com|tiktok\.com|rumble\.com|soundcloud\.com|spotify\.com)$/i;
  const hostOf=value=>{try{return new URL(String(value||''),'https://www.reddit.com').hostname.toLowerCase();}catch{return '';}};
  const gifHref=value=>{try{return /\.gif$/i.test(new URL(String(value||''),'https://www.reddit.com').pathname);}catch{return false;}};
  // A native shreddit-post card: its post-type attribute plus markers inside it. Unknown values stay ''.
  function nativeType(node){
    const attr=name=>String(node.getAttribute(name)||'').trim(),has=sel=>{try{return Boolean(node.querySelector(sel));}catch{return false;}};
    const kind=attr('post-type').toLowerCase().replace(/-/g,'_'),href=attr('content-href')||attr('url')||attr('href'),host=hostOf(href),domain=attr('domain').toLowerCase();
    if(kind==='crosspost' || node.hasAttribute('crosspost-parent-id') || node.hasAttribute('is-crosspost') || has('[slot="crosspost-content"],shreddit-crosspost-embed,[data-testid="crosspost"]'))return 'crosspost';
    if(kind==='poll' || has('shreddit-poll,shreddit-poll-post'))return 'poll';
    if(gifHref(href) && ['image','link','gif','multi_media',''].includes(kind))return 'gif';
    if(kind==='gif')return 'gif';
    if(has('shreddit-embed,iframe[src],iframe[data-src]') && ['link','embed','rich:video','rich_video',''].includes(kind) || ['link','rich:video','rich_video','embed'].includes(kind) && (embedHosts.test(host) || embedHosts.test(domain)))return 'embed';
    if(kind==='video' || kind==='hosted:video' || has('shreddit-player,shreddit-player-2'))return 'video';
    if(kind==='image')return 'image';
    if(kind==='gallery')return 'gallery';
    if(kind==='multi_media')return 'textmedia';
    if(kind==='text')return 'text';
    if(kind==='link')return 'link';
    return normalizeType(kind);
  }
  // Best-effort type for an item (archive/post object) or a native card element; shared by every feed filter.
  function inferType(post){
    if(post && typeof post.getAttribute==='function' && post.nodeType===1){if(post.matches?.('shreddit-profile-comment'))return '';return nativeType(post);}
    if(!post || post.kind==='comment')return '';const known=normalizeType(post.postType);if(known)return known;
    const media=Array.isArray(post.media)?post.media:[];
    if(media.some(m=>gifHref(m?.url)) || gifHref(post.url))return 'gif';
    if(media.length>1)return 'gallery';if(media[0])return media[0].kind==='video'?'video':'image';
    try{const url=new URL(post.url),permalink=post.permalink?new URL(post.permalink):null;if(post.url && !/(^|\.)reddit\.com$/i.test(url.hostname) && (!permalink || url.href!==permalink.href))return embedHosts.test(url.hostname)?'embed':'link';}catch{}
    return 'text';
  }
  function countSubreddits(items){
    const counts=new Map();for(const item of items){const n=subName(item.subreddit);if(!n)continue;const key=n.toLowerCase(),entry=counts.get(key);if(entry)entry.count++;else counts.set(key,{key:n,count:1});}
    return counts;
  }
  // Archive buckets plus loaded items not already counted by the archive, as sorted [{key,count}].
  function mergeCounts(buckets,loaded=[]){
    const counts=new Map();
    for(const bucket of buckets||[]){const n=subName(bucket.key);if(!n)continue;const k=n.toLowerCase(),e=counts.get(k);if(e)e.count+=Number(bucket.count)||0;else counts.set(k,{key:n,count:Number(bucket.count)||0});}
    // Loaded items are mostly already inside the archive totals: take the larger count, never the sum.
    const seen=new Map();for(const item of loaded){const n=subName(item.subreddit);if(!n)continue;const k=n.toLowerCase(),e=seen.get(k);if(e)e.count++;else seen.set(k,{key:n,count:1});}
    for(const [k,v] of seen){const e=counts.get(k);if(e)e.count=Math.max(e.count,v.count);else counts.set(k,v);}
    return [...counts.values()].sort((a,b)=>b.count-a.count || a.key.localeCompare(b.key));
  }
  const dayLabel=value=>{const [y,m,d]=value.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});};
  function dateLabel(date){
    if(!date)return '';if(date.preset)return (date.preset==='hour'?incomingHour:presets.find(x=>x.id===date.preset))?.label || '';
    return date.from===date.to?dayLabel(date.from):dayLabel(date.from)+' – '+dayLabel(date.to);
  }
  // Short value for the main menu row: "Any time", "Past year", "Oct 1 – Oct 20" (years only when not this year).
  function dateShort(date,now=new Date()){
    if(!date)return 'Any time';if(date.preset)return (date.preset==='hour'?incomingHour:presets.find(x=>x.id===date.preset))?.label || 'Any time';
    const day=value=>{const [y,m,d]=value.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString(undefined,y===now.getFullYear()?{month:'short',day:'numeric'}:{month:'short',day:'numeric',year:'numeric'});};
    return date.from===date.to?day(date.from):day(date.from)+' – '+day(date.to);
  }
  // r/name, or u/name for a user profile feed (stored as u_name).
  const subLabel=name=>/^u_./i.test(name)?'u/'+String(name).slice(2):'r/'+name;
  // Current value shown beside each main-menu row.
  function valueLabels(state,now){
    return {date:dateShort(state.date,now),
      type:state.types.length>1?state.types.length+' types':state.types.length?typeLabels[state.types[0]]:'All',
      sub:state.subreddits.length>1?state.subreddits.length+' communities':state.subreddits.length?subLabel(state.subreddits[0]):'All'};
  }
  // Chips to show, each with the state that removes it and the icon of its menu row.
  function chipList(state){
    const chips=[];
    if(state.sort==='old')chips.push({id:'sort',label:'Oldest first',icon:'archive',remove:s=>({...s,sort:null})});
    if(state.sort==='comments')chips.push({id:'sort',label:'Most commented',icon:'archive',remove:s=>({...s,sort:null})});
    if(state.date)chips.push({id:'date',label:dateLabel(state.date),icon:'calendar',remove:s=>({...s,date:null})});
    for(const t of state.types)chips.push({id:'type:'+t,label:typeLabels[t],icon:typeIcons[t],remove:s=>({...s,types:s.types.filter(x=>x!==t)})});
    for(const sub of state.subreddits)chips.push({id:'sub:'+sub.toLowerCase(),label:subLabel(sub),icon:'community-fill',community:sub,remove:s=>({...s,subreddits:s.subreddits.filter(x=>x!==sub)})});
    return chips;
  }
  // ---------- community icons ----------
  const iconsApi=()=>globalThis.RTCommunityIcons,span24=24;
  function applyIcon(span,url){
    if(!url)return;
    const img=document.createElement('img');img.className='rt-community-img';img.alt='';img.decoding='async';img.referrerPolicy='no-referrer';img.src=url;
    img.addEventListener('error',()=>{img.replaceWith(placeholderIcon(span.dataset.rtCommunity,span.dataset.rtPlaceholder));},{once:true});
    span.replaceChildren(img);span.dataset.rtIconApplied='true';
  }
  function placeholderIcon(name,placeholder){return svgIcon(/^u_./i.test(name)?'profile-fill':placeholder || 'community-fill',span24)||document.createDocumentFragment();}
  // A fixed-size round community icon: the placeholder glyph now, the real icon swapped in without moving anything.
  function communityIcon(name,size=span24,placeholder){
    const span=document.createElement('span');span.className='rt-community-icon';span.dataset.rtCommunity=name;if(placeholder)span.dataset.rtPlaceholder=placeholder;span.style.setProperty('--rt-icon-size',size+'px');
    const known=iconsApi()?.peek?.(name);
    if(known)applyIcon(span,known);else{const g=placeholderIcon(name,placeholder);if(g.nodeType===1){g.setAttribute('width',String(size));g.setAttribute('height',String(size));}span.append(g);}
    return span;
  }
  // Fill in one community's icon, if the loader can find it.
  function loadIcon(span){
    if(span.dataset.rtIconApplied || span.dataset.rtIconRequested)return;span.dataset.rtIconRequested='true';
    const api=iconsApi();if(!api?.get)return;
    Promise.resolve(api.get(span.dataset.rtCommunity)).then(url=>{if(url && span.isConnected)applyIcon(span,url);},()=>{});
  }
  // Reddit-style chip row. Re-renders only inside click handlers, never on pointer-down,
  // so a real mouse click always reaches its button.
  function chipIcon(chip){
    const holder=document.createElement('span');holder.className='rt-filter-chip-icon';holder.setAttribute('aria-hidden','true');
    if(chip.community){const known=iconsApi()?.peek?.(chip.community);if(known){const img=document.createElement('img');img.className='rt-community-img';img.alt='';img.referrerPolicy='no-referrer';img.src=known;holder.append(img);holder.dataset.rtCommunity=chip.community;return holder;}}
    const icon=svgIcon(chip.icon,16);if(icon)holder.append(icon);return holder;
  }
  function renderChips(container,state,{onChange,make,glyph}){
    const chips=chipList(state);container.replaceChildren();container.hidden=!chips.length;
    for(const chip of chips){
      const el=make('span','rt-filter-chip'),text=make('span','rt-filter-chip-label',chip.label),remove=make('button','rt-filter-chip-remove');
      remove.type='button';remove.setAttribute('aria-label','Remove filter '+chip.label);remove.dataset.rtChipRemove=chip.id;remove.append(glyph('close'));
      remove.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();onChange(chip.remove(clone(state)));});
      el.dataset.rtChip=chip.id;el.append(chipIcon(chip),text,remove);container.append(el);
    }
    if(chips.length){const clear=make('button','rt-filter-clear','Clear filters');clear.type='button';clear.dataset.rtFilterClear='true';clear.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();onChange(empty());});container.append(clear);}
  }
  // Menu rows in the caller's own style: ctx supplies row(label,icon), activate(el,fn), glyph(kind).
  // icon: a glyph name, a node, or false for no icon. tail: right-aligned muted text. slot: reserve the checkmark column.
  function menuOption(ctx,{label,subtitle='',icon=null,checked=false,onSelect,value='',tail='',slot=false}){
    const el=ctx.row(label,icon===false?document.createDocumentFragment():icon || 'filter'),body=el.firstElementChild;
    if(icon!==false){const lead=body.firstElementChild?.firstElementChild;if(lead?.nodeType===1)lead.classList.add('rt-menu-lead');}
    if(subtitle){const sub=document.createElement('span');sub.className='text-12 text-neutral-content-weak ms-xs';sub.dataset.rtOptionSubtitle='true';sub.textContent=subtitle;body.firstElementChild.append(sub);}
    if(tail){const t=document.createElement('span');t.className='rt-opt-tail text-12 text-neutral-content-weak';t.dataset.rtOptionTail='true';t.textContent=tail;body.append(t);}
    if(slot){const s=document.createElement('span');s.className='rt-check-slot';s.dataset.rtCheckSlot='true';body.append(s);}
    if(value)el.dataset.rtOption=value;
    ctx.activate(el,onSelect);markChecked(ctx,el,checked);return el;
  }
  function markChecked(ctx,el,checked){
    if(el.getAttribute('aria-checked')!==String(checked))el.setAttribute('aria-checked',String(checked));
    let mark=el.querySelector('[data-rt-check]');
    if(checked && !mark){mark=ctx.glyph('checkmark');mark.dataset.rtCheck='true';(el.querySelector('[data-rt-check-slot]') || el.firstElementChild).append(mark);}else if(!checked)mark?.remove();
  }
  // Menu rows for hosts without Reddit's rpl-menu-item (profile search page, subreddit archive popover): same structure, same CSS.
  function plainContext(glyph,{role='menuitemcheckbox'}={}){
    const mk=(cls)=>{const el=document.createElement('div');el.className=cls;return el;};
    const row=(label,icon)=>{
      const el=mk('rt-menu-row cursor-pointer'),body=mk('flex justify-between items-center w-full'),caption=mk('flex items-center gap-xs rt-menu-caption');
      el.setAttribute('role',role);el.tabIndex=-1;el.setAttribute('aria-label',label);
      const lead=typeof icon==='string'?(svgIcon(icon,20)||glyph(icon)):icon;lead?.classList?.add('rt-menu-lead');
      caption.append(lead,document.createTextNode(label));body.append(caption);el.append(body);return el;
    };
    const activate=(el,fn)=>{
      el.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();fn(event);});
      el.addEventListener('keydown',event=>{if(event.key==='Enter' || event.key===' '){event.preventDefault();fn(event);}});
    };
    return {row,activate,glyph:name=>svgIcon(name,20) || glyph(name)};
  }
  // Small non-interactive section title inside a menu (Reddit's menu-section-title style).
  function sectionLabel(text){
    const el=document.createElement('div');el.className='rt-menu-section text-12 font-semibold text-neutral-content-weak';el.setAttribute('role','presentation');el.dataset.rtUi='filter-option';el.dataset.rtSection=text;el.textContent=text;return el;
  }
  // Post type list: "All types" then the Text / Media / Links sections. Multi-select; append(el) places each element.
  function typeOptions(ctx,{append,onToggle,onClear,iconSize=20,allIcon=false}){
    const rows=new Map(),elements=[],add=el=>{el.dataset.rtUi='filter-option';append(el);elements.push(el);return el;};
    const all=add(menuOption(ctx,{label:'All types',icon:allIcon,value:'all',onSelect:()=>onClear()}));
    for(const section of typeSections){
      add(sectionLabel(section.label));
      for(const id of section.types)rows.set(id,add(menuOption(ctx,{label:typeLabels[id],icon:svgIcon(typeIcons[id],iconSize),value:id,onSelect:()=>onToggle(id)})));
    }
    return {all,rows,elements,sync(selected){markChecked(ctx,all,!selected.length);for(const [id,el] of rows)markChecked(ctx,el,selected.includes(id));}};
  }
  function submenuHeader(label,onBack){
    const head=document.createElement('div');head.className='rt-sub-head';
    const back=document.createElement('button');back.className='rt-sub-back';back.type='button';back.dataset.rtSubBack='true';back.setAttribute('aria-label','Back');back.title='Back';back.append(svgIcon('arrow-back',16));
    back.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();onBack();});head.append(back);
    if(label){const title=document.createElement('span');title.className='rt-sub-title';title.textContent=label;head.append(title);}
    return {head,back};
  }
  const sourceNotes={archive:'Counts from the archive',loaded:'Counts from loaded items',loading:'Loading counts…',none:''};
  // Subreddit list: optional Back plus a pill search in one header row, then a scrolling list of
  // community icon / name / count / check rows (picked rows pinned first), then a footer note.
  function subredditPanel({ctx,onBack=null,onToggle,max=maxSubreddits,limit=200,nativeHeader=false}){
    const mk=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el;};
    const header=nativeHeader && onBack?submenuHeader('',onBack):null;
    const el=mk('div','rt-sub-panel'),head=header?.head || mk('div','rt-sub-head'),list=mk('div','rt-sub-list'),note=mk('div','rt-filter-note text-12 text-neutral-content-weak'),input=mk('input','rt-filter-search');
    el.dataset.rtUi='filter-option';el.dataset.rtSubPanel='true';list.dataset.rtSubList='true';list.setAttribute('role','group');list.setAttribute('aria-label','Communities');note.dataset.rtSubNote='true';head.dataset.rtSubHead='true';
    let back=header?.back || null;
    if(onBack && !header){back=mk('button','rt-sub-back');back.type='button';back.dataset.rtSubBack='true';back.setAttribute('aria-label','Back');back.title='Back';const arrow=svgIcon('arrow-back',20);back.append(arrow);back.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();onBack();});head.append(back);}
    input.type='search';input.placeholder='Search communities';input.setAttribute('aria-label','Search communities');input.autocomplete='off';
    // Typing must not trigger the host menu's own keyboard handling.
    input.addEventListener('keydown',event=>{if(event.key!=='Escape')event.stopPropagation();});
    let field=null,clear=null;
    if(nativeHeader){
      field=mk('div','rt-filter-field');clear=mk('button','rt-filter-search-clear');clear.type='button';clear.setAttribute('aria-label','Clear community search');clear.hidden=true;clear.append(svgIcon('close',14));
      field.append(svgIcon('search',18),input,clear);head.append(field);
      clear.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();input.value='';list.scrollTop=0;render();input.focus({preventScroll:true});});
    }else head.append(input);
    el.append(head,list,note);
    let observer=null,last={entries:[],picked:[],source:'none'};
    const render=(data=last)=>{
      if(clear)clear.hidden=!input.value;
      last=data;const picked=data.picked||[],pickedKeys=new Set(picked.map(n=>n.toLowerCase())),term=subName(input.value).toLowerCase(),entries=data.entries||[],byKey=new Map(entries.map(e=>[e.key.toLowerCase(),e]));
      const full=picked.length>=max,rows=[...picked.map(n=>byKey.get(n.toLowerCase())||{key:n,count:0}),...entries.filter(e=>!pickedKeys.has(e.key.toLowerCase()) && (!term || e.key.toLowerCase().includes(term) || subLabel(e.key).toLowerCase().includes(input.value.trim().toLowerCase())))].slice(0,limit);
      observer?.disconnect();observer=null;
      const keepTop=list.scrollTop;list.replaceChildren();
      const watch=typeof IntersectionObserver==='function'?(observer=new IntersectionObserver(items=>{for(const item of items)if(item.isIntersecting){observer?.unobserve(item.target);loadIcon(item.target);}},{root:list,rootMargin:'48px'})):null;
      let index=0;
      for(const entry of rows){
        const on=pickedKeys.has(entry.key.toLowerCase()),icon=communityIcon(entry.key,24,nativeHeader?'community':undefined);
        const row=menuOption(ctx,{label:subLabel(entry.key),icon,checked:on,value:entry.key,tail:entry.count?String(entry.count):'',slot:true,onSelect:()=>{if(row.getAttribute('aria-disabled')==='true')return;onToggle(entry.key);}});
        if(nativeHeader){icon.classList.add('rt-sub-icon-box');const caption=row.firstElementChild.firstElementChild,text=caption.lastChild,name=mk('span','rt-sub-name',text.textContent);text.replaceWith(name);}
        row.dataset.rtUi='filter-option';row.dataset.rtSubRow=entry.key;row.dataset.rtSubOption=entry.key;
        if(full && !on){row.setAttribute('aria-disabled','true');row.setAttribute('disabled','');row.title='Up to '+max+' communities';}
        list.append(row);
        if(watch)watch.observe(icon);else if(index++<16)loadIcon(icon);
      }
      if(!rows.length){const empty=mk('div','rt-sub-empty text-12 text-neutral-content-weak',term?(nativeHeader?'No communities match':'No matching communities'):'No communities yet');list.append(empty);}
      list.scrollTop=keepTop;
      const text=sourceNotes[data.source]??'',tail=full?'Up to '+max+' communities':'';note.textContent=[text,tail].filter(Boolean).join(' · ');note.hidden=!note.textContent;
    };
    input.addEventListener('input',()=>{list.scrollTop=0;render();});
    return {el,list,note,input,back,head,render,reset(){input.value='';if(clear)clear.hidden=true;list.scrollTop=0;},get data(){return last;}};
  }
  const iconNames=Object.freeze([...Object.keys(iconPaths),'gif']);
  globalThis.RTFeedFilters=Object.freeze({params:Object.freeze({...params}),types,typeLabels,typeIcons,typeSections,presets,sorts,maxSubreddits,empty,clone,parse,serialize,isActive,equal,applyToSearch,write,read,dateRange,predicate,normalizeType,inferType,countSubreddits,mergeCounts,dateLabel,dateShort,subLabel,valueLabels,chipList,renderChips,menuOption,markChecked,plainContext,sectionLabel,typeOptions,submenuHeader,subredditPanel,communityIcon,svgIcon,iconNames,subName});
})();
