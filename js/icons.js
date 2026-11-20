// Icônes SVG en ligne (style trait arrondi, couleur héritée du texte).

const stroke = (body, size = 24, cls = '') =>
  `<svg class="ico ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const solid = (body, size = 24, cls = '') =>
  `<svg class="ico ${cls}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">${body}</svg>`;

export const icon = {
  home: (s) => stroke('<path d="M3.5 11.2 12 4l8.5 7.2"/><path d="M5.5 9.8V19a1 1 0 0 0 1 1H10v-5.5h4V20h3.5a1 1 0 0 0 1-1V9.8"/>', s),
  chart: (s) => stroke('<path d="M5 20v-8M12 20V4M19 20v-5"/>', s),
  settings: (s) => stroke('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>', s),
  check: (s) => stroke('<path d="m5.5 12.5 4.2 4.2L18.5 8"/>', s),
  moon: (s) => stroke('<path d="M19.5 14.2A7.8 7.8 0 0 1 9.8 4.5a7.8 7.8 0 1 0 9.7 9.7z"/>', s),
  close: (s) => stroke('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>', s),
  chevronLeft: (s) => stroke('<path d="m14.5 6-6 6 6 6"/>', s),
  chevronRight: (s) => stroke('<path d="m9.5 6 6 6-6 6"/>', s),
  bell: (s) => stroke('<path d="M6.5 16.5V11a5.5 5.5 0 1 1 11 0v5.5l1.5 2h-14z"/><path d="M10 21h4"/>', s),
  download: (s) => stroke('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>', s),
  vibrate: (s) => stroke('<rect x="8" y="3.5" width="8" height="17" rx="2.2"/><path d="M4.5 8v8M19.5 8v8"/>', s),
  volume: (s) =>
    stroke('<path d="M4.5 9.7v4.6h3.2l4.3 3.4V6.3L7.7 9.7z" fill="currentColor"/><path d="M15.6 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.7 7.7 0 0 1 0 10.8"/>', s),
  volumeOff: (s) =>
    stroke('<path d="M4.5 9.7v4.6h3.2l4.3 3.4V6.3L7.7 9.7z" fill="currentColor"/><path d="m16 9.7 4.5 4.6M20.5 9.7 16 14.3"/>', s),
  pause: (s) => solid('<rect x="6.3" y="4.8" width="4" height="14.4" rx="1.4"/><rect x="13.7" y="4.8" width="4" height="14.4" rx="1.4"/>', s),
  play: (s) => solid('<path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/>', s),
  pip: (s) => stroke('<rect x="3" y="5" width="18" height="14" rx="2.6"/><rect x="12" y="12" width="7" height="5" rx="1.2" fill="currentColor"/>', s),
  eye: (s) => stroke('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>', s),
  eyeOff: (s) => stroke('<path d="M3 3l18 18M10.6 5.7A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-3.2 3.9M6.4 6.9A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>', s),
  refresh: (s) => stroke('<path d="M19.5 12a7.5 7.5 0 0 1-12.9 5.2M4.5 12A7.5 7.5 0 0 1 17.4 6.8"/><path d="M17.8 3.5v3.6h-3.6M6.2 20.5v-3.6h3.6"/>', s),
  plus: (s) => stroke('<path d="M12 5.5v13M5.5 12h13"/>', s),
  copy: (s) => stroke('<rect x="8.5" y="8.5" width="11" height="11" rx="2.6"/><path d="M15.5 8.5V6.6a2.1 2.1 0 0 0-2.1-2.1H6.6a2.1 2.1 0 0 0-2.1 2.1v6.8a2.1 2.1 0 0 0 2.1 2.1h1.9"/>', s),
  leaf: (s) => stroke('<path d="M5 19c0-8 5-13.5 14-14 0 8.5-5 14-12.5 14.2"/><path d="M5 19c2-3.5 4.5-6 8-8"/>', s),
  trophy: (s) => stroke('<path d="M8 4.5h8v5a4 4 0 0 1-8 0zM8 6.5H5.5a1 1 0 0 0-1 1c0 2 1.5 3.5 3.5 3.5M16 6.5h2.5a1 1 0 0 1 1 1c0 2-1.5 3.5-3.5 3.5M12 13.5V17M8.5 20h7M10 17h4"/>', s),
  sparkle: (s) => stroke('<path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5"/>', s),
  flame: (s = 24, cls = '') =>
    `<svg class="ico flame-ico ${cls}" viewBox="0 0 24 24" width="${s}" height="${s}" aria-hidden="true">
      <path class="flame-out" d="M12.3 2.2c.4 3 2.3 4.6 3.9 6.6 1.5 1.8 2.6 3.6 2.6 6.2a6.8 6.8 0 0 1-13.6 0c0-2.2.9-3.9 2.2-5.4.2 1.5 1 2.5 2.1 3-.3-3.7.4-7.4 2.8-10.4z" fill="currentColor"/>
      <path class="flame-in" d="M12 21.1a3.9 3.9 0 0 1-3.9-3.9c0-1.8 1.1-3 2.2-4.1.3 1 .9 1.6 1.6 1.9.4-1.1 1-2 1.8-2.8 1.4 1.4 2.2 2.7 2.2 5A3.9 3.9 0 0 1 12 21.1z" fill="#fff" fill-opacity=".38"/>
    </svg>`,
};
