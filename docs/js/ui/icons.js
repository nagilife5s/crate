// 線のアイコン（24×24）。currentColor で色が付く。
const p = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const f = (d) => `<svg viewBox="0 0 24 24" fill="currentColor">${d}</svg>`;

export const ICONS = {
  play: f('<path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/>'),
  pause: f('<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>'),
  next: f('<path d="M5 6.2v11.6a.9.9 0 0 0 1.4.75L15 12.75a.9.9 0 0 0 0-1.5L6.4 5.45A.9.9 0 0 0 5 6.2z"/><rect x="16.5" y="5" width="2.6" height="14" rx="1"/>'),
  prev: f('<path d="M19 6.2v11.6a.9.9 0 0 1-1.4.75L9 12.75a.9.9 0 0 1 0-1.5l8.6-5.8A.9.9 0 0 1 19 6.2z"/><rect x="4.9" y="5" width="2.6" height="14" rx="1"/>'),
  shuffle: p('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>'),
  repeat: p('<path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>'),
  queue: p('<path d="M3 6h13"/><path d="M3 12h13"/><path d="M3 18h9"/><path d="M17 15v6l4-3z" fill="currentColor"/>'),
  more: f('<circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/>'),
  plus: p('<path d="M12 5v14M5 12h14"/>'),
  gear: p('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  down: p('<path d="M6 9l6 6 6-6"/>'),
  back: p('<path d="M15 18l-6-6 6-6"/>'),
  chev: p('<path d="M9 18l6-6-6-6"/>'),
  search: p('<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'),
  x: p('<path d="M18 6 6 18M6 6l12 12"/>'),
  handle: p('<path d="M4 8h16M4 12h16M4 16h16"/>'),
  library: p('<rect x="3" y="4" width="4" height="16" rx="1"/><rect x="9" y="4" width="4" height="16" rx="1"/><path d="M15.5 5.2l3.9-.9 3 15.3-3.9.9z"/>'),
  playlist: p('<path d="M3 6h12M3 11h12M3 16h7"/><circle cx="17" cy="17" r="3"/><path d="M20 17V6l2 1"/>'),
  next_up: p('<path d="M4 7h11"/><path d="M4 12h7"/><path d="M15 12l5 4-5 4z" fill="currentColor"/>'),
  add_end: p('<path d="M4 6h12M4 11h12M4 16h7"/><path d="M18 14v6M15 17h6"/>'),
  add_pl: p('<path d="M3 6h12M3 11h12M3 16h7"/><path d="M18 13v7M14.5 16.5h7"/>'),
  edit: p('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
  open: p('<path d="M14 3h7v7"/><path d="M10 14 21 3"/><path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>'),
  trash: p('<path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/>'),
  remove: p('<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'),
  check: p('<path d="M20 6 9 17l-5-5"/>'),
  airplay: p('<path d="M5 17H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-1"/><path d="M12 15l5 6H7z" fill="currentColor"/>'),
  key: p('<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M16 7l3 3M19 4l2 2"/>'),
  reset: p('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  note: p('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>'),
};

export const ic = (name) => `<span class="ic">${ICONS[name] || ''}</span>`;

/** HTML に書いた <span class="ic" data-ic="..."> を埋める */
export function fillIcons(root = document) {
  root.querySelectorAll('[data-ic]').forEach((el) => { el.innerHTML = ICONS[el.dataset.ic] || ''; });
}
