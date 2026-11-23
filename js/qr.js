// QR code de l'invitation : pour rejoindre un cercle en scannant l'écran d'un proche, sans rien envoyer.
// Tout se calcule ici, sur l'appareil (aucun service extérieur) ; l'encodeur est la bibliothèque libre
// « qrcode-generator » de Kazuhiko Arase (MIT), gardée telle quelle dans js/vendor/.

import qrcode from './vendor/qrcode.mjs';

/** Matrice du QR code de `text` : un tableau de lignes, `true` pour un module sombre. */
export function qrMatrix(text, level = 'M') {
  const qr = qrcode(0, level); // 0 : la taille (version) se choisit toute seule
  qr.addData(String(text));
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/**
 * Le QR code en SVG : un seul tracé aux bords nets, avec sa zone de silence (4 modules). Toujours sombre sur clair,
 * quel que soit le thème : c'est ce que les lecteurs lisent le mieux.
 */
export function qrSvg(text, { level = 'M', margin = 4, dark = '#0b1020', light = '#ffffff', label = 'QR code' } = {}) {
  const m = qrMatrix(text, level);
  const size = m.length + 2 * margin;
  let d = '';
  m.forEach((row, r) => {
    for (let c = 0; c < row.length; c++) {
      if (!row[c]) continue;
      let len = 1;
      while (c + len < row.length && row[c + len]) len++; // une série de modules voisins = un seul rectangle
      d += `M${c + margin} ${r + margin}h${len}v1h-${len}z`;
      c += len - 1;
    }
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${light}"/><path d="${d}" fill="${dark}"/></svg>`;
}
