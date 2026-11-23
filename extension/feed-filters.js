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
  // Reddit's 20x20 glyphs (outline silhouettes use fill=currentColor).
  const iconPaths={
    'nsfw-fill-12':'M6.506 5.119a.641.641 0 01.002-.723.74.74 0 01.31-.244 1.16 1.16 0 01.874 0 .695.695 0 01.306.244.647.647 0 01-.001.723.768.768 0 01-.303.259 1.008 1.008 0 01-.439.095 1.01 1.01 0 01-.44-.095.765.765 0 01-.309-.259Zm1.255 1.406a1.176 1.176 0 00-.507-.106c-.189 0-.36.036-.508.106a.854.854 0 00-.348.279.647.647 0 00-.127.386.6.6 0 00.13.382.87.87 0 00.353.266c.154.063.317.096.5.096s.352-.034.5-.1a.895.895 0 00.35-.27.625.625 0 00.123-.378.632.632 0 00-.124-.382.85.85 0 00-.342-.279Zm3.918.668c-.359.671-.958 1.57-1.937 2.55-.979.98-1.879 1.579-2.55 1.937-.749.4-1.637.4-2.386 0-.67-.358-1.57-.958-2.55-1.937-.98-.979-1.579-1.879-1.938-2.55-.4-.749-.4-1.637 0-2.387.36-.671.958-1.57 1.937-2.55.98-.98 1.88-1.579 2.55-1.937.75-.4 1.637-.4 2.386 0 .671.358 1.57.958 2.55 1.937.98.98 1.58 1.879 1.938 2.55.4.749.4 1.637 0 2.387ZM4 3.2H2.8v5.6H4V3.2Zm5.5 4.01a1.39 1.39 0 00-.246-.794 1.776 1.776 0 00-.6-.544c.168-.144.3-.312.395-.501.108-.21.163-.44.163-.682 0-.315-.089-.597-.266-.836a1.73 1.73 0 00-.712-.556A2.387 2.387 0 007.26 3.1c-.35 0-.677.065-.976.195-.298.13-.54.316-.72.555-.18.238-.27.521-.27.836 0 .243.054.472.163.684.096.189.228.357.394.501a1.788 1.788 0 00-.6.547 1.393 1.393 0 00.046 1.651c.192.255.465.46.806.608.341.148.727.223 1.151.223.416 0 .8-.074 1.14-.217.341-.145.613-.348.81-.605.197-.258.297-.549.297-.867l-.003-.001Z',
    'tag':"M9.15 2H4.3A2.3 2.3 0 0 0 2 4.3v4.85c0 .61.24 1.19.67 1.63l6.55 6.55a2.3 2.3 0 0 0 3.25 0l4.86-4.86a2.3 2.3 0 0 0 0-3.25l-6.55-6.55A2.3 2.3 0 0 0 9.15 2ZM3.8 4.3a.5.5 0 0 1 .5-.5h4.85a.5.5 0 0 1 .35.15l6.55 6.55a.5.5 0 0 1 0 .7l-4.85 4.85a.5.5 0 0 1-.7 0L3.95 9.5a.5.5 0 0 1-.15-.35V4.3Zm2.7.9a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z",
    'filter':['M3 6.9h7.11A4 4 0 0014 10c2.21 0 4-1.79 4-4s-1.79-4-4-4a4 4 0 00-3.89 3.1H3c-.5 0-.9.4-.9.9s.4.9.9.9Zm11-3.1c1.21 0 2.2.99 2.2 2.2 0 1.21-.99 2.2-2.2 2.2-1.21 0-2.2-.99-2.2-2.2 0-1.21.99-2.2 2.2-2.2Zm3 9.3H9.89A4 4 0 006 10c-2.21 0-4 1.79-4 4s1.79 4 4 4a4 4 0 003.89-3.1H17c.5 0 .9-.4.9-.9s-.4-.9-.9-.9ZM6 16.2c-1.21 0-2.2-.99-2.2-2.2 0-1.21.99-2.2 2.2-2.2 1.21 0 2.2.99 2.2 2.2 0 1.21-.99 2.2-2.2 2.2Z'],
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
    'archive':["M15.7 1H4.3C2.48 1 1 2.48 1 4.3v2.76c0 .5.4.9.9.9H2v6.74C2 16.52 3.48 18 5.3 18h9.4c1.82 0 3.3-1.48 3.3-3.3V7.96h.1c.5 0 .9-.4.9-.9V4.3C19 2.48 17.52 1 15.7 1Zm1.5 5.16H2.8V4.3c0-.83.67-1.5 1.5-1.5h11.4c.83 0 1.5.67 1.5 1.5v1.86ZM3.8 7.96h12.4v6.74c0 .83-.67 1.5-1.5 1.5H5.3c-.83 0-1.5-.67-1.5-1.5V7.96Z","M7 10.07h6v1.8H7z"],
    'checkmark':"M7.09 15.84c-.23 0-.46-.09-.64-.26L1.3 10.42a.9.9 0 010-1.27.9.9 0 011.27 0l4.52 4.52L17.5 3.26a.9.9 0 011.27 0 .9.9 0 010 1.27L7.73 15.58c-.18.18-.41.26-.64.26Z",
    'radio-button':"M10 2.8c3.97 0 7.2 3.23 7.2 7.2s-3.23 7.2-7.2 7.2-7.2-3.23-7.2-7.2S6.03 2.8 10 2.8ZM10 1a9 9 0 10.001 18.001A9 9 0 0010 1Z",
    'radio-button-fill':"M10 2.8c3.97 0 7.2 3.23 7.2 7.2s-3.23 7.2-7.2 7.2-7.2-3.23-7.2-7.2S6.03 2.8 10 2.8ZM10 1a9 9 0 10.001 18.001A9 9 0 0010 1Z M10 14a4 4 0 100-8 4 4 0 000 8Z",
    'chevron-right':"M7.5 17.9a.898.898 0 01-.636-1.536L13.227 10 6.864 3.636a.898.898 0 010-1.272.898.898 0 011.272 0l7 7a.898.898 0 010 1.272l-7 7a.897.897 0 01-.636.264Z",
    'arrow-back':"M17.5 9.1H4.679l5.487-5.462a.898.898 0 00.003-1.272.898.898 0 00-1.272-.003l-7.032 7a.898.898 0 000 1.275l7.03 7a.896.896 0 001.273-.003.898.898 0 00-.002-1.272l-5.487-5.462h12.82a.9.9 0 000-1.8Z",
    'activity':"M10 1c-.5 0-.9.4-.9.9v.17C5.11 2.52 2 5.9 2 10c0 4.41 3.59 8 8 8 4.11 0 7.48-3.11 7.93-7.1h.17c.5 0 .9-.4.9-.9 0-4.96-4.04-9-9-9Zm.9 1.86c3.25.41 5.84 2.99 6.24 6.24H10.9V2.86ZM10 16.2c-3.42 0-6.2-2.78-6.2-6.2 0-3.11 2.31-5.69 5.3-6.12V10c0 .5.4.9.9.9h6.12c-.44 2.99-3.01 5.3-6.12 5.3Z",
    // Reddit's outline glyphs; community uses its captured ring and r/ geometry.
    // Sort: a down arrow beside lines of decreasing length, drawn as a stroke at Reddit's outline weight.
    'sort':"M5 3.5v13M2.2 13.7 5 16.5l2.8-2.8M10.5 4.5h7.3M10.5 9h5.3M10.5 13.5h3.3",
    // Reddit's own New icon (icon-name="new", captured from its sort menu 2026-11-18).
    'new':"M10 10.9H4.678V9.1H9.1V4.678h1.801V10a.9.9 0 01-.901.9Zm3.3 5.492a7.15 7.15 0 01-3.3.808c-3.97 0-7.2-3.23-7.2-7.2S6.03 2.8 10 2.8c3.232 0 5.973 2.141 6.88 5.079.382.124.739.321 1.029.611l1.069 1.069C18.747 4.794 14.822.999 10 .999A9 9 0 0010 19a8.96 8.96 0 003.3-.633v-1.975Zm3.336-6.638a.926.926 0 00-1.273 0l-2.1 2.1a.9.9 0 101.273 1.272l.562-.563V18.6a.9.9 0 001.8 0v-6.037l.562.563a.9.9 0 001.274-1.272l-2.098-2.1Z",
    'best':["M15.22 8.6c-.6-3.51-2.68-6.21-4.76-7.47a.912.912 0 00-.93 0C7.59 2.3 5.37 4.89 4.76 8.61c-2.77 2.65-4.02 4.46-3.57 7.32.17 1.08 1.14 1.9 2.27 1.9h3.18c.61.72 1.53 1.17 2.51 1.17h1.71c.98 0 1.9-.44 2.51-1.17h3.18c1.12 0 2.1-.82 2.27-1.9.45-2.87-.8-4.67-3.59-7.33h-.01ZM2.97 15.65c-.24-1.53.15-2.65 1.66-4.33.1 1.83.55 3.45 1.06 4.71H3.46c-.24 0-.45-.17-.49-.38Zm6.18 1.55c-.57 0-1.09-.32-1.33-.81-.64-1.31-1.41-3.37-1.41-5.78 0-3.71 1.84-6.34 3.6-7.63 1.81 1.35 3.6 4.16 3.6 7.63 0 2.41-.77 4.47-1.41 5.78-.24.49-.77.81-1.33.81H9.15Zm7.88-1.55c-.03.21-.25.38-.49.38h-2.23c.51-1.26.96-2.88 1.06-4.71 1.51 1.69 1.9 2.8 1.66 4.33Z","M10 8.35c-.91 0-1.65.74-1.65 1.65 0 .91.74 1.65 1.65 1.65.91 0 1.65-.74 1.65-1.65 0-.91-.74-1.65-1.65-1.65Z"],
    'comment':["M10 1a9 9 0 00-9 9c0 1.947.79 3.58 1.935 4.957L.231 17.661A.784.784 0 00.785 19H10a9 9 0 009-9 9 9 0 00-9-9Zm0 16.2H6.162c-.994.004-1.907.053-3.045.144l-.076-.188a36.981 36.981 0 002.328-2.087l-1.05-1.263C3.297 12.576 2.8 11.331 2.8 10c0-3.97 3.23-7.2 7.2-7.2s7.2 3.23 7.2 7.2-3.23 7.2-7.2 7.2Z"],
    'show':["M10 13.9c-2.15 0-3.9-1.75-3.9-3.9S7.85 6.1 10 6.1s3.9 1.75 3.9 3.9-1.75 3.9-3.9 3.9Zm0-6a2.1 2.1 0 100 4.2 2.1 2.1 0 000-4.2Z","M10 16.97c-3.8 0-7.28-2.09-9.08-5.44-.51-.96-.51-2.1 0-3.06C2.72 5.11 6.2 3.03 10 3.03s7.28 2.09 9.08 5.44c.51.96.51 2.1 0 3.06-1.8 3.36-5.28 5.44-9.08 5.44Zm0-12.14c-3.14 0-6.01 1.72-7.5 4.5-.22.42-.22.94 0 1.35a8.514 8.514 0 007.5 4.5c3.14 0 6.01-1.72 7.5-4.5.22-.42.22-.94 0-1.35a8.514 8.514 0 00-7.5-4.5Z"],
    'gif-post-outline':["M4.711 12.664A2.8 2.8 0 013.6 11.583 3.108 3.108 0 013.2 10a3.052 3.052 0 01.411-1.583c.267-.46.659-.834 1.129-1.082a3.37 3.37 0 011.616-.385c.333 0 .664.043.986.128.309.081.605.205.879.369l-.5 1.169a1.314 1.314 0 00-.563-.357 2.3 2.3 0 00-.754-.124 1.733 1.733 0 00-1.863 1.848c-.006.344.073.684.232.99a1.7 1.7 0 001.542.925c.258.004.513-.051.746-.162a1.23 1.23 0 00.513-.443c.121-.185.185-.401.183-.622H6.124V9.619L9 9.6v.928a2.4 2.4 0 01-1.293 2.193 2.955 2.955 0 01-1.417.328 3.247 3.247 0 01-1.579-.385Zm5.471-5.648H11.5v5.968h-1.318V7.016Zm2.862 0H16.5v1.169h-2.138v1.392h1.79v1.169h-1.79v2.238h-1.318V7.016ZM10 20a18.04 18.04 0 01-6.369-1.162 4.226 4.226 0 01-2.469-2.47 18.033 18.033 0 010-12.737 4.228 4.228 0 012.469-2.469 18.116 18.116 0 0112.738 0 4.228 4.228 0 012.469 2.469 18.035 18.035 0 010 12.738 4.225 4.225 0 01-2.469 2.469A18.04 18.04 0 0110 20Zm0-18.75a16.8 16.8 0 00-5.929 1.082 2.978 2.978 0 00-1.739 1.739 16.783 16.783 0 000 11.857 2.98 2.98 0 001.739 1.74 16.858 16.858 0 0011.858 0 2.978 2.978 0 001.739-1.739 16.785 16.785 0 000-11.858 2.978 2.978 0 00-1.739-1.739A16.8 16.8 0 0010 1.25Z"],
    'author':["M17.536 2.465a5.006 5.006 0 00-7.072 0 4.98 4.98 0 00-1.458 3.503 1.934 1.934 0 00-.437-.023 1.903 1.903 0 00-1.388.759l-5.457 7.319c-.925 1.24-.806 2.87.288 3.965a3.015 3.015 0 002.14.908c.631 0 1.268-.205 1.826-.621l7.317-5.457a1.9 1.9 0 00.761-1.386 1.892 1.892 0 00-.022-.44 4.982 4.982 0 003.502-1.458 5.006 5.006 0 000-7.07Zm-5.316 8.91-7.318 5.457c-.633.474-1.249.25-1.617-.117-.366-.366-.589-.983-.117-1.616l5.457-7.32.15-.01L9.867 8.86l-2.162 2.162 1.273 1.272 2.162-2.162 1.091 1.09-.01.152Zm4.043-3.112c-1.209 1.209-3.316 1.209-4.525 0a3.204 3.204 0 010-4.525 3.18 3.18 0 012.263-.938c.855 0 1.658.333 2.263.938a3.204 3.204 0 010 4.525Z"],
    'caret-down':"M10 13.7a.897.897 0 01-.636-.264l-4.6-4.6a.9.9 0 111.272-1.273L10 11.526l3.964-3.963a.9.9 0 011.272 1.273l-4.6 4.6A.897.897 0 0110 13.7Z",
    'caret-up-down':"M13.21 8c-.23 0-.46-.09-.63-.26L10 5.16 7.42 7.74a.9.9 0 01-1.27 0 .9.9 0 010-1.27l3.21-3.21a.9.9 0 011.27 0l3.21 3.21A.894.894 0 0113.21 8ZM10 17c-.23 0-.46-.09-.63-.26l-3.21-3.21a.9.9 0 010-1.27.9.9 0 011.27 0l2.58 2.58 2.58-2.58a.9.9 0 011.27 0 .9.9 0 010 1.27l-3.21 3.21c-.17.17-.4.26-.63.26H10Z",
    'search':"m18.736 17.464-3.483-3.483A7.961 7.961 0 0016.999 9 8 8 0 109 17a7.961 7.961 0 004.981-1.746l3.483 3.483a.9.9 0 101.272-1.273ZM9 15.2A6.207 6.207 0 012.8 9c0-3.419 2.781-6.2 6.2-6.2s6.2 2.781 6.2 6.2-2.781 6.2-6.2 6.2Z",
    'close':"m11.273 10 5.363-5.363a.9.9 0 10-1.273-1.273L10 8.727 4.637 3.364a.9.9 0 10-1.273 1.273L8.727 10l-5.363 5.363a.9.9 0 101.274 1.273L10 11.273l5.363 5.363a.897.897 0 001.274 0 .9.9 0 000-1.273L11.275 10h-.002Z",
    'community':["M10 2.8c3.97 0 7.2 3.23 7.2 7.2s-3.23 7.2-7.2 7.2-7.2-3.23-7.2-7.2S6.03 2.8 10 2.8ZM10 1a9 9 0 10.001 18.001A9 9 0 0010 1Z","M9.98 8.118a1.752 1.752 0 00-1.148.167 1.664 1.664 0 00-.651.596 1.703 1.703 0 00-.258.948v3.96H5.998V6.322h1.876v1.074h.035c.251-.344.567-.628.948-.851a2.55 2.55 0 011.311-.335c.172 0 .335.014.488.042.153.028.267.058.342.09l-.774 1.849a.766.766 0 00-.244-.073Z","M11.977 13.79h-1.955l4.549-10.715 1.657.7-4.251 10.015Z"],
    'classic':"M14.7 2H5.3C3.48 2 2 3.48 2 5.3v9.4C2 16.52 3.48 18 5.3 18h9.4c1.82 0 3.3-1.48 3.3-3.3V5.3C18 3.48 16.52 2 14.7 2ZM5.3 3.8h9.4c.83 0 1.5.67 1.5 1.5v1.43H3.8V5.3c0-.83.67-1.5 1.5-1.5Zm10.9 4.73v2.93H3.8V8.53h12.4Zm-1.5 7.67H5.3c-.83 0-1.5-.67-1.5-1.5v-1.43h12.4v1.43c0 .83-.67 1.5-1.5 1.5Z",
    'hot':"M14.92 6.703c-1.905-1.562-2.146-2.81-1.933-4.701a.905.905 0 00-.28-.758.895.895 0 00-.773-.23c-3.256.587-5.18 2.649-5.735 6.14a16.896 16.896 0 01-.67-.697.895.895 0 00-.644-.294.911.911 0 00-.658.264c-1.444 1.445-2.334 3.867-2.214 6.029C2.192 15.69 4.758 19 10.002 19c3.79 0 6.54-1.64 7.627-4.498.997-2.625-.04-5.613-2.707-7.8h-.001Zm-6.958 8.76c0-1.097 1.033-2.402 2.037-3.451 1.01 1.054 2.049 2.363 2.049 3.45 0 .829-.645 1.735-2.048 1.735-1.39 0-2.038-.908-2.038-1.734Zm7.983-1.601A4.804 4.804 0 0113.7 16.39a3.38 3.38 0 00.148-.928c0-2.262-2.254-4.465-3.85-5.973-1.59 1.502-3.837 3.697-3.837 5.973 0 .298.056.596.136.89-1.671-.932-2.407-2.495-2.49-3.997-.073-1.334.364-2.838 1.106-3.94.678.553 1.559 1.076 2.4 1.224.29-1.636.772-3.105 1.155-3.998.535-1.248 1.413-2.087 2.658-2.553.024 1.76.635 3.35 2.654 5.005 2.049 1.68 2.877 3.89 2.165 5.768h-.001Z",
    'top':"M17.1 11.03h-3.3V8.98h1.17a1.328 1.328 0 00.94-2.27l-5.27-5.28c-.34-.34-.94-.34-1.27 0L4.09 6.71c-.38.38-.49.95-.29 1.45.21.5.69.82 1.23.82H6.2v2.05H2.9a1.9 1.9 0 00-1.9 1.9v2.6c0 1.82 1.48 3.3 3.3 3.3h11.4c1.82 0 3.3-1.48 3.3-3.3v-2.6a1.9 1.9 0 00-1.9-1.9ZM10 3.34l3.83 3.84H12v7.85c0 1.1-.9 2-2 2s-2-.9-2-2V7.18H6.17L10 3.34ZM2.8 15.52v-2.6c0-.06.04-.1.1-.1h3.3v2.2c0 .74.22 1.42.58 2H4.3c-.83 0-1.5-.67-1.5-1.5Zm14.4 0c0 .83-.67 1.5-1.5 1.5h-2.48c.36-.58.58-1.26.58-2v-2.2h3.3c.05 0 .1.04.1.1v2.6Z",
    // Reddit marks the selected sort with the filled variant of its icon (captured from its sort menu 2026-11-19).
    'hot-fill':"M14.92 6.703c-1.906-1.562-2.147-2.81-1.934-4.701a.905.905 0 00-.28-.758.895.895 0 00-.773-.23C8.845 1.572 6.97 3.47 6.31 6.642c-.034.233-.05.442-.044.643l-.111.03a4.972 4.972 0 00-.627-.856.895.895 0 00-.644-.294.911.911 0 00-.658.264c-1.444 1.445-2.334 3.867-2.215 6.029C2.19 15.692 4.753 19 10 19c3.739 0 6.54-1.64 7.627-4.498.997-2.625-.04-5.614-2.707-7.8ZM9.999 17.198c-1.851 0-2.695-1.22-2.695-2.33 0-1.471 1.365-3.223 2.69-4.633 1.335 1.415 2.709 3.173 2.709 4.634 0 1.112-.851 2.329-2.705 2.329Z",
    'new-fill':"m18.978 9.56-1.069-1.069c-1.012-1.013-2.807-1.013-3.818 0l-2.1 2.1a2.698 2.698 0 000 3.818c.373.373.83.608 1.309.717v3.241A8.96 8.96 0 0110 19a9 9 0 01-9-9 9 9 0 019-9c4.822 0 8.747 3.795 8.978 8.56Zm-8.177-4.982H9V9H4.578v1.8h4.223a2 2 0 002-2V4.578Zm5.835 5.176a.926.926 0 00-1.273 0l-2.1 2.1a.9.9 0 101.273 1.272l.562-.563V18.6a.9.9 0 001.8 0v-6.037l.562.563a.9.9 0 001.274-1.272l-2.098-2.1Z",
    'top-fill':"M17.1 11.1h-4.2V8.4h1.82c.51 0 .97-.31 1.16-.78.2-.47.09-1.01-.27-1.37l-5.01-5a.863.863 0 00-1.21 0l-5 5c-.36.36-.47.9-.27 1.37.2.47.65.78 1.17.78H7.1v2.7H2.9A1.9 1.9 0 001 13v2.6c0 1.82 1.48 3.3 3.3 3.3h11.4c1.82 0 3.3-1.48 3.3-3.3V13a1.9 1.9 0 00-1.9-1.9Zm-12.8 6c-.83 0-1.5-.67-1.5-1.5V13c0-.06.04-.1.1-.1h4.2v2.84c0 .49.14.95.35 1.36H4.3Zm12.9-1.5c0 .83-.67 1.5-1.5 1.5h-3.15c.22-.41.35-.86.35-1.36V12.9h4.2c.05 0 .1.04.1.1v2.6Z",
    calendar:'M5.6 1h1.8v2H5.6V1Zm7 0h1.8v2h-1.8V1ZM5 3h10a3 3 0 013 3v9a3 3 0 01-3 3H5a3 3 0 01-3-3V6a3 3 0 013-3Zm0 1.8c-.72 0-1.2.48-1.2 1.2v.4h12.4V6c0-.72-.48-1.2-1.2-1.2H5ZM3.8 8.2V15c0 .72.48 1.2 1.2 1.2h10c.72 0 1.2-.48 1.2-1.2V8.2H3.8Z'
  };
  const SVG='http://www.w3.org/2000/svg';
  // An SVG glyph for a known icon name (20x20 viewBox), or the GIF tag. Null for unknown names.
  function svgIcon(name,size=20){
    if(name==='gif'){const tag=document.createElement('span');tag.className='rt-gif-tag';tag.dataset.icon='gif';tag.setAttribute('aria-hidden','true');tag.textContent='GIF';return tag;}
    const nsfw=name==='nsfw-fill-12',paths=iconPaths[name];if(!paths)return null;
    const s=document.createElementNS(SVG,'svg');s.setAttribute('viewBox',nsfw?'0 0 12 12':'0 0 20 20');s.setAttribute('fill','currentColor');s.setAttribute('width',String(size));s.setAttribute('height',String(size));
    if(name==='sort'){s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','1.8');s.setAttribute('stroke-linejoin','round');s.setAttribute('stroke-linecap','round');}
    s.setAttribute('icon-name',name);s.setAttribute('aria-hidden','true');s.dataset.icon=name;s.dataset.nativeIcon='true';s.classList.add('rt-activity-icon');
    for(const d of [].concat(paths)){const path=document.createElementNS(SVG,'path');path.setAttribute('d',d);if(name==='calendar' || name==='archive')path.setAttribute('fill-rule','evenodd');s.append(path);}
    return s;
  }
  const hourPreset=Object.freeze({id:'hour',label:'Past hour',seconds:3600});
  const presets=Object.freeze([
    Object.freeze({id:'24h',label:'Past 24 hours',seconds:86400}),
    Object.freeze({id:'week',label:'Past week',seconds:604800}),
    Object.freeze({id:'month',label:'Past month',seconds:2592000}),
    Object.freeze({id:'year',label:'Past year',seconds:31536000})
  ]);
  const allPresets=Object.freeze([hourPreset,...presets]);
  const findPreset=id=>allPresets.find(x=>x.id===id)||null;
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
    if(findPreset(date))state.date={preset:date};
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
    if(date.preset){const preset=findPreset(date.preset);return preset?{after:Math.floor(now-preset.seconds),before:null}:null;}
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
    if(!date)return '';if(date.preset)return findPreset(date.preset)?.label || '';
    return date.from===date.to?dayLabel(date.from):dayLabel(date.from)+' – '+dayLabel(date.to);
  }
  // Short value for the main menu row: "Any time", "Past year", "Oct 1 – Oct 20" (years only when not this year).
  function dateShort(date,now=new Date()){
    if(!date)return 'Any time';if(date.preset)return findPreset(date.preset)?.label || 'Any time';
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
  function placeholderIcon(name,placeholder){return svgIcon(placeholder || (/^u_./i.test(name)?'profile-fill':'community-fill'),placeholder?16:span24)||document.createDocumentFragment();}
  // A fixed-size round community icon: the placeholder glyph now, the real icon swapped in without moving anything.
  function communityIcon(name,size=span24,placeholder){
    const span=document.createElement('span');span.className='rt-community-icon';span.dataset.rtCommunity=name;if(placeholder)span.dataset.rtPlaceholder=placeholder;span.style.setProperty('--rt-icon-size',size+'px');
    const known=iconsApi()?.peek?.(name);
    if(known)applyIcon(span,known);else{const g=placeholderIcon(name,placeholder);if(g.nodeType===1){const glyphSize=String(placeholder?Math.min(size,16):size);g.setAttribute('width',glyphSize);g.setAttribute('height',glyphSize);}span.append(g);}
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
    const glyph=()=>svgIcon(chip.icon,16);
    if(chip.community){
      // Fixed 16px round slot: the glyph now, the community's own icon swapped in when known, without moving the label.
      holder.dataset.rtCommunity=chip.community;holder.classList.add('rt-filter-chip-icon-community');
      const show=url=>{const img=document.createElement('img');img.className='rt-community-img';img.alt='';img.decoding='async';img.referrerPolicy='no-referrer';img.src=url;img.addEventListener('error',()=>{const g=glyph();if(g)img.replaceWith(g);else img.remove();},{once:true});holder.replaceChildren(img);};
      const known=iconsApi()?.peek?.(chip.community);if(known){show(known);return holder;}
      const g=glyph();if(g)holder.append(g);
      Promise.resolve(iconsApi()?.get?.(chip.community)).then(url=>{if(url && holder.isConnected!==false)show(url);},()=>{});
      return holder;
    }
    const icon=glyph();if(icon)holder.append(icon);return holder;
  }
  // One filter as Reddit's own scope pill (rpl-input-chip, as for u/name in the header search):
  // leading icon, label, trailing close; a click anywhere on it removes the filter.
  // Reddit's custom elements may set attributes in their constructor, which document.createElement
  // rejects ("The result must not have attributes"). Parsed elements are upgraded later, which is allowed.
  function parsedElement(tag,cls){if(!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(tag))throw Error('Invalid custom element name.');const parsed=new DOMParser().parseFromString('<'+tag+'></'+tag+'>','text/html'),el=document.adoptNode(parsed.body.firstElementChild);if(cls)el.className=cls;return el;}
  function pill(chip,{make,glyph,onRemove}){
    const el=parsedElement('rpl-input-chip','rt-filter-chip');el.dataset.rtChip=chip.id;
    for(const [key,value] of [['appearance','bordered'],['type','standalone']])el.setAttribute(key,value);
    el.setAttribute('aria-label','Remove filter '+chip.label);
    const lead=make('span','rt-filter-chip-lead');lead.slot='leading';lead.style.cssText='display:flex;align-items:center';lead.append(chipIcon(chip));
    const text=make('span','rt-filter-chip-label whitespace-nowrap overflow-hidden text-ellipsis text-label-2',chip.label);
    const remove=make('button','rt-filter-chip-remove');remove.type='button';remove.setAttribute('aria-label','Remove filter '+chip.label);remove.dataset.rtChipRemove=chip.id;remove.append(glyph('close'));
    const trail=make('span','flex items-center ms-2xs');trail.slot='trailing';trail.append(remove);
    el.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();onRemove();});
    el.append(lead,text,trail);return el;
  }
  function renderChips(container,state,{onChange,make,glyph}){
    const chips=chipList(state);container.replaceChildren();container.hidden=!chips.length;
    for(const chip of chips)container.append(pill(chip,{make,glyph,onRemove:()=>onChange(chip.remove(clone(state)))}));
    if(chips.length){const clear=make('button','rt-filter-clear','Clear filters');clear.type='button';clear.dataset.rtFilterClear='true';clear.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();onChange(empty());});container.append(clear);}
    fitRail(container);
  }
  // Applied filters (docs/feed-controls-ux-plan.md, 5): the pills stay in the container as the source of every filter
  // and its remove handler, but are not shown in the row. The owner's button (badgeFor) carries the count; computers add
  // one summary chip in the row's leftover width ("Videos · r/pics"), truncated, then "N filters", then nothing. The
  // chip opens the Applied filters list (popover on computers, the Sort & filter sheet on phones); its × clears all.
  const rails=new WeakMap();
  function fitRail(container,options){
    if(!container)return;
    let rail=rails.get(container);
    if(!rail){
      rail={badgeFor:null,frame:0,observer:null};rails.set(container,rail);
      if(typeof ResizeObserver==='function'){rail.observer=new ResizeObserver(()=>{cancelAnimationFrame(rail.frame);rail.frame=requestAnimationFrame(()=>layoutRail(container));});rail.observer.observe(container);}
    }
    if(options && 'badgeFor' in options)rail.badgeFor=options.badgeFor || null;
    layoutRail(container);
  }
  function railBadge(container,count){
    const button=rails.get(container)?.badgeFor;if(!button?.isConnected)return;
    let badge=button.querySelector(':scope>.rt-filter-count');
    if(!count){badge?.remove();button.removeAttribute('data-rt-filter-count');return;}
    if(!badge){badge=document.createElement('span');badge.className='rt-filter-count';badge.setAttribute('aria-hidden','true');button.append(badge);}
    badge.textContent=String(count);button.setAttribute('data-rt-filter-count',String(count));
  }
  const chipLabel=node=>node.querySelector('.rt-filter-chip-label')?.textContent.trim() || node.dataset.rtChip || 'Filter';
  const appliedPills=container=>container?[...container.children].filter(node=>node.matches('.rt-filter-chip')):[];
  function clearAllPills(container){
    const clear=container.querySelector(':scope>.rt-filter-clear');
    if(clear)clear.click();else for(const node of appliedPills(container).reverse())node.click();
  }
  function layoutRail(container){
    if(!container.isConnected || !container.hasAttribute('data-rt-rail'))return;
    for(const node of container.querySelectorAll(':scope>.rt-filter-summary,:scope>.rt-filter-more'))node.remove();
    const pills=appliedPills(container),clear=container.querySelector(':scope>.rt-filter-clear');
    for(const node of [...pills,clear])if(node)node.hidden=true;
    container.removeAttribute('data-rt-collapsed');
    railBadge(container,pills.length);
    if(!pills.length || container.hidden)return;
    if(globalThis.matchMedia?.('(max-width: 767.98px)')?.matches){container.setAttribute('data-rt-collapsed','');return;}
    const labels=pills.map(chipLabel),count=labels.length===1?'1 filter':labels.length+' filters';
    const chip=document.createElement('span');chip.className='rt-filter-summary';
    const open=document.createElement('button');open.type='button';open.className='rt-filter-summary-open';open.setAttribute('aria-haspopup','dialog');open.setAttribute('aria-expanded','false');
    open.setAttribute('aria-label',count+' applied: '+labels.join(', ')+'. Show applied filters');open.title=labels.join(', ');
    const text=document.createElement('span');text.className='rt-filter-summary-text';text.textContent=labels.join(' · ');
    open.append(svgIcon('filter',16) || document.createTextNode(''),text);
    open.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();openRailList(container,open);});
    const x=document.createElement('button');x.type='button';x.className='rt-filter-summary-clear';x.setAttribute('aria-label','Clear all filters');x.append(svgIcon('close',16) || document.createTextNode('×'));
    x.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();clearAllPills(container);});
    chip.append(open,x);container.append(chip);
    // Truncated names say less than the count does.
    if(labels.length>1 && text.scrollWidth>text.clientWidth+1)text.textContent=count;
    if(container.scrollWidth>container.clientWidth+1 || text.clientWidth && text.clientWidth<24){chip.remove();container.setAttribute('data-rt-collapsed','');}
  }
  // A phone Sort & filter sheet's first row: every applied filter on its own page, each removable, with Clear all.
  function appliedRow(ui,container){
    const pills=container?[...container.children].filter(node=>node.matches('.rt-filter-chip')):[];if(!pills.length)return null;
    const clear=container.querySelector(':scope>.rt-filter-clear');
    const page=(_body,list)=>{
      for(const node of pills){const label=node.querySelector('.rt-filter-chip-label')?.textContent.trim() || 'Filter';
        list.row({label,icon:node.querySelector('[slot="leading"] svg,[slot="leading"] img')?.cloneNode(true) || null,action:{label:'Remove filter '+label,icon:svgIcon('close',16) || null,onSelect:()=>node.click()},onSelect:()=>node.click()});}
      list.divider();list.row({label:'Clear all filters',onSelect:()=>{if(clear)clear.click();else for(const node of [...pills].reverse())node.click();}});
    };
    const row=ui.row({label:'Applied filters',icon:svgIcon('filter',20),subtitle:pills.length===1?'1 filter':pills.length+' filters',chevron:true,keepOpen:true,onSelect:()=>{ui.push({title:'Applied filters',build:page});return {stay:true};}});
    ui.divider();return row;
  }
  // Every applied filter, each removable by its own pill's handler, plus Clear all.
  let railList=null;
  function closeRailList(){const list=railList;railList=null;list?.close();}
  function openRailList(container,anchor){
    closeRailList();
    const entries=appliedPills(container).map(node=>({node,label:chipLabel(node),icon:node.querySelector('[slot="leading"] svg,[slot="leading"] img')?.cloneNode(true) || null}));
    const clearAll=()=>clearAllPills(container);
    const phone=globalThis.matchMedia?.('(max-width: 767.98px)')?.matches && globalThis.RTFeedSheet;
    anchor.setAttribute('aria-expanded','true');
    if(phone){
      const sheet=globalThis.RTFeedSheet.open({title:'Applied filters',returnFocus:anchor,onClose:()=>anchor.setAttribute('aria-expanded','false'),build:(_body,ui)=>{
        for(const entry of entries)ui.row({label:entry.label,icon:entry.icon?.cloneNode(true) || null,action:{label:'Remove filter '+entry.label,icon:svgIcon('close',16) || null,onSelect:()=>entry.node.click()},onSelect:()=>entry.node.click()});
        ui.divider();ui.row({label:'Clear all filters',onSelect:clearAll});
      }});
      railList={close:()=>sheet.close?.()};return;
    }
    const pop=document.createElement('div');pop.className='rt-filter-list';pop.dataset.rtUi='applied-filters';pop.setAttribute('role','dialog');pop.setAttribute('aria-label','Applied filters');
    const head=document.createElement('div');head.className='rt-filter-list-head';const title=document.createElement('span');title.textContent='Applied filters';
    const all=document.createElement('button');all.type='button';all.className='rt-filter-list-clear';all.textContent='Clear all';all.addEventListener('click',event=>{event.preventDefault();closeRailList();clearAll();});
    head.append(title,all);pop.append(head);
    for(const entry of entries){
      const row=document.createElement('div');row.className='rt-filter-list-row';
      const text=document.createElement('span');text.className='rt-filter-list-label';if(entry.icon)row.append(entry.icon);text.textContent=entry.label;
      const remove=document.createElement('button');remove.type='button';remove.className='rt-filter-list-remove';remove.setAttribute('aria-label','Remove filter '+entry.label);remove.append(svgIcon('close',16) || document.createTextNode('×'));
      remove.addEventListener('click',event=>{event.preventDefault();closeRailList();entry.node.click();});
      row.append(text,remove);pop.append(row);
    }
    const box=anchor.getBoundingClientRect(),width=280,left=Math.max(8,Math.min(box.left,(document.documentElement.clientWidth || innerWidth)-width-8));
    pop.style.cssText=`position:fixed;z-index:2147483000;top:${Math.round(box.bottom+4)}px;left:${Math.round(left)}px;width:${width}px`;
    const away=event=>{if(!event.composedPath().includes(pop) && !event.composedPath().includes(anchor))closeRailList();};
    const keys=event=>{if(event.key==='Escape'){event.preventDefault();closeRailList();anchor.focus({preventScroll:true});}};
    document.addEventListener('pointerdown',away,true);document.addEventListener('keydown',keys,true);addEventListener('scroll',closeRailList,{passive:true,once:true});
    document.body.append(pop);pop.querySelector('button')?.focus({preventScroll:true});
    railList={close:()=>{document.removeEventListener('pointerdown',away,true);document.removeEventListener('keydown',keys,true);removeEventListener('scroll',closeRailList);pop.remove();anchor.setAttribute('aria-expanded','false');}};
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
  function typeOptions(ctx,{append,onToggle,onClear,iconSize=20,allIcon=false,outline=false}){
    const rows=new Map(),elements=[],add=el=>{el.dataset.rtUi='filter-option';append(el);elements.push(el);return el;};
    const all=add(menuOption(ctx,{label:'All types',icon:allIcon,value:'all',onSelect:()=>onClear()}));
    for(const section of typeSections){
      add(sectionLabel(section.label));
      for(const id of section.types)rows.set(id,add(menuOption(ctx,{label:typeLabels[id],icon:svgIcon(outline && id==='gif'?'gif-post-outline':typeIcons[id],iconSize),value:id,onSelect:()=>onToggle(id)})));
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
  // community icon / name / count / check rows (picked rows pinned first), then a (hidden) source note.
  function subredditPanel({ctx,onBack=null,onToggle,max=maxSubreddits,limit=200,nativeHeader=false,onClear=null,clearLabel='All communities'}){
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
      clear.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();input.value='';list.scrollTop=0;input.dispatchEvent(new Event('input',{bubbles:true}));input.focus({preventScroll:true});});
    }else head.append(input);
    el.append(head,list,note);
    let observer=null,last={entries:[],picked:[],source:'none'};
    const render=(data=last)=>{
      if(clear)clear.hidden=!input.value;
      last=data;const picked=data.picked||[],pickedKeys=new Set(picked.map(n=>n.toLowerCase())),term=subName(input.value).toLowerCase(),entries=data.entries||[],byKey=new Map(entries.map(e=>[e.key.toLowerCase(),e]));
      const full=picked.length>=max,rows=[...picked.map(n=>byKey.get(n.toLowerCase())||{key:n,count:0}),...entries.filter(e=>!pickedKeys.has(e.key.toLowerCase()) && (!term || e.matched===true || e.key.toLowerCase().includes(term) || subLabel(e.key).toLowerCase().includes(input.value.trim().toLowerCase())))].slice(0,limit);
      observer?.disconnect();observer=null;
      const keepTop=list.scrollTop;list.replaceChildren();
      const watch=typeof IntersectionObserver==='function'?(observer=new IntersectionObserver(items=>{for(const item of items)if(item.isIntersecting){observer?.unobserve(item.target);loadIcon(item.target);}},{root:list,rootMargin:'48px'})):null;
      if(onClear){const all=menuOption(ctx,{label:clearLabel,icon:svgIcon('show',16),checked:!picked.length,value:'all',onSelect:onClear});all.dataset.rtUi='filter-option';all.dataset.rtSubAll='true';list.append(all);}
      let index=0;
      for(const entry of rows){
        const on=pickedKeys.has(entry.key.toLowerCase()),icon=communityIcon(entry.key,24,nativeHeader?(/^u_./i.test(entry.key)?'author':'community'):undefined);
        const row=menuOption(ctx,{label:subLabel(entry.key),icon,checked:on,value:entry.key,tail:entry.count?String(entry.count):'',slot:true,onSelect:()=>{if(row.getAttribute('aria-disabled')==='true')return;onToggle(entry.key);}});
        if(nativeHeader){icon.classList.add('rt-sub-icon-box');const caption=row.firstElementChild.firstElementChild,text=caption.lastChild,name=mk('span','rt-sub-name',text.textContent);text.replaceWith(name);}
        row.dataset.rtUi='filter-option';row.dataset.rtSubRow=entry.key;row.dataset.rtSubOption=entry.key;
        if(full && !on){row.setAttribute('aria-disabled','true');row.setAttribute('disabled','');row.title='Up to '+max+' communities';}
        list.append(row);
        if(watch)watch.observe(icon);else if(index++<16)loadIcon(icon);
      }
      if(!rows.length){const empty=mk('div','rt-sub-empty text-12 text-neutral-content-weak',term?(nativeHeader?'No communities match':'No matching communities'):'No communities yet');list.append(empty);}
      list.scrollTop=keepTop;
      // The source label stays on the element for tests and diagnostics; it is not shown in the menu.
      const text=sourceNotes[data.source]??'';note.dataset.rtSource=text;note.textContent='';note.hidden=true;
    };
    input.addEventListener('input',()=>{list.scrollTop=0;render();});
    return {el,list,note,input,back,head,render,reset(){input.value='';if(clear)clear.hidden=true;list.scrollTop=0;},get data(){return last;}};
  }
  const iconNames=Object.freeze([...Object.keys(iconPaths),'gif']);
  globalThis.RTFeedFilters=Object.freeze({params:Object.freeze({...params}),types,typeLabels,typeIcons,typeSections,presets,hourPreset,allPresets,sorts,maxSubreddits,empty,clone,parse,serialize,isActive,equal,applyToSearch,write,read,dateRange,predicate,normalizeType,inferType,countSubreddits,mergeCounts,dateLabel,dateShort,subLabel,valueLabels,chipList,renderChips,fitRail,appliedRow,openApplied:openRailList,appliedCount:container=>appliedPills(container).length,pill,parsedElement,menuOption,markChecked,plainContext,sectionLabel,typeOptions,submenuHeader,subredditPanel,communityIcon,loadIcon,svgIcon,iconNames,subName});
})();
