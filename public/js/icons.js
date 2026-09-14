'use strict';
/* A small, hand-authored line-icon set (24x24 viewBox, stroke-based) so the
 * app has one consistent icon language instead of emoji, with zero external
 * dependency and no build step. Usage: icon('home', 'icon-lg') returns a
 * ready-to-insert <svg> string sized/colored via the .icon CSS class
 * (currentColor), so it always matches surrounding text color in both
 * themes automatically. */

const ICON_PATHS = {
  home: '<path d="M4 11.5 12 4l8 7.5"/><path d="M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2.5 3h2l2.2 12.1a2 2 0 0 0 2 1.65h8.5a2 2 0 0 0 2-1.6L21 8H6"/>',
  package: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1-3.5 4-5.5 7-5.5s6 2 7 5.5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.6-4.6"/>',
  chevronLeft: '<path d="M15 5l-7 7 7 7"/>',
  chevronRight: '<path d="M9 5l7 7-7 7"/>',
  dots: '<circle cx="12" cy="5" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.3" fill="currentColor" stroke="none"/>',
  check: '<path d="M4 12.5l5 5L20 6.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M5 5l14 14M19 5 5 19"/>',
  whatsapp: '<path fill="currentColor" stroke="none" d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 18.1a8 8 0 0 1-4.1-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 1 1 20 12a8 8 0 0 1-8 8.1Zm4.4-5.9c-.2-.1-1.4-.7-1.6-.8-.2-.1-.4-.1-.6.1-.2.2-.6.8-.8 1-.1.2-.3.2-.5.1-.2-.1-1-.4-2-1.2-.7-.6-1.2-1.4-1.4-1.7-.1-.2 0-.4.1-.5.1-.1.2-.3.4-.4.1-.2.2-.3.2-.5.1-.2 0-.4 0-.5-.1-.1-.6-1.4-.8-1.9-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.5.1-.7.3-.2.2-.9.9-.9 2.2s1 2.5 1.1 2.7c.1.2 2 3 4.7 4.2.7.3 1.2.5 1.6.6.7.2 1.3.2 1.8.1.5-.1 1.4-.6 1.6-1.1.2-.5.2-1 .1-1.1-.1-.1-.2-.2-.4-.3Z"/>',
  basket: '<path d="M4 9h16l-1.5 10.5a1.5 1.5 0 0 1-1.5 1.3H7a1.5 1.5 0 0 1-1.5-1.3L4 9Z"/><path d="M8 9 9.5 4h5L16 9"/><path d="M9 13v4M12 13v4M15 13v4"/>',
  cup: '<path d="M5 3h11v9a5.5 5.5 0 0 1-11 0V3Z"/><path d="M16 6h1.5A2.5 2.5 0 0 1 20 8.5v0A2.5 2.5 0 0 1 17.5 11H16"/><path d="M6 21h9"/>',
  cookie: '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1" fill="currentColor" stroke="none"/><circle cx="14" cy="9" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="14" r="1" fill="currentColor" stroke="none"/><circle cx="10" cy="15" r="1" fill="currentColor" stroke="none"/>',
  milk: '<path d="M9 3h6v3.5l2 3.5v9a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2v-9l2-3.5V3Z"/><path d="M7.5 12h9"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11Z"/>',
  spray: '<path d="M8 8h6l1 3H7l1-3Z"/><path d="M9 3h4v2H9zM10 5h2v3h-2z"/><rect x="6" y="11" width="9" height="10" rx="1.5"/><path d="M18 8h2M19 6v4M16.5 5.5l1.4-1.4M16.5 10.5l1.4 1.4"/>',
  pot: '<path d="M4 10h16v3a6 6 0 0 1-6 6h-4a6 6 0 0 1-6-6v-3Z"/><path d="M2 10h20"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  dashboard: '<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/>',
  clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1"/><path d="M8 10h8M8 14h8M8 18h5"/>',
  checkCircle: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5L16 9.5"/>',
  card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9.5h18"/><path d="M6 14h4"/>',
  history: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2"/><path d="M9 2h6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>',
  moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4 8.5 8.5 0 1 0 20 14.5Z"/>',
  map: '<path d="M9 4 4 6v14l5-2 6 2 5-2V4l-5 2-6-2Z"/><path d="M9 4v14M15 6v14"/>',
  warning: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 10v4M12 17h.01"/>',
  storefront: '<path d="M4 9V6l2-3h12l2 3v3"/><path d="M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9Z"/><path d="M4 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>',
  phone: '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M11 18h2"/>',
  key: '<circle cx="8" cy="14" r="4"/><path d="M11 11l9-9M17 5l2 2M14 8l2 2"/>',
};

function icon(name, extraClass) {
  const path = ICON_PATHS[name];
  if (!path) return '';
  return `<svg class="icon${extraClass ? ' ' + extraClass : ''}" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}
