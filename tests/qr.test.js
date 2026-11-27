import { test } from 'node:test';
import assert from 'node:assert/strict';
import { qrMatrix, qrSvg } from '../js/qr.js';
import { inviteLink } from '../js/circle.js';

const LINK = inviteLink('3162858841128824', 'https://respire-theta.vercel.app/');

// Le motif de repérage : un carré sombre de 7, entouré d'un liseré clair, avec un centre de 3 × 3.
const finder = (m, r0, c0) => {
  for (let r = 0; r < 7; r++) {
    for (let c = 0; c < 7; c++) {
      const edge = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      if (m[r0 + r][c0 + c] !== (edge || core)) return false;
    }
  }
  return true;
};

test('QR code : matrice carrée avec les trois motifs de repérage (haut gauche, haut droit, bas gauche) et pas de quatrième', () => {
  const m = qrMatrix(LINK);
  const n = m.length;
  assert.ok(m.every((row) => row.length === n));
  assert.equal(n, 33, 'un lien de cette longueur tient dans la version 4 (33 modules)');
  assert.ok(finder(m, 0, 0) && finder(m, 0, n - 7) && finder(m, n - 7, 0));
  assert.ok(!finder(m, n - 7, n - 7), 'rien en bas à droite');
});

test('QR code : toujours le même pour le même lien, et différent d’un lien à l’autre', () => {
  assert.deepEqual(qrMatrix(LINK), qrMatrix(LINK));
  assert.notDeepEqual(qrMatrix(LINK), qrMatrix(inviteLink('1111111111111111', 'https://respire-theta.vercel.app/')));
  assert.ok(qrMatrix(`${LINK}${'x'.repeat(80)}`).length > qrMatrix(LINK).length, 'un texte plus long donne une version plus grande');
});

test('QR code : le SVG reproduit exactement la matrice, avec sa zone de silence', () => {
  const m = qrMatrix(LINK);
  const n = m.length;
  const svg = qrSvg(LINK);
  assert.ok(svg.includes(`viewBox="0 0 ${n + 8} ${n + 8}"`), 'zone de silence de 4 modules de chaque côté');
  assert.ok(svg.includes('role="img"') && svg.includes('aria-label='));
  // On relit le tracé (M x y h len v1 h-len z) et on le compare module par module.
  const d = svg.match(/<path d="([^"]+)"/)[1];
  const drawn = Array.from({ length: n }, () => Array(n).fill(false));
  for (const [, x, y, len] of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-\d+z/g).map((a) => [a[0], +a[1] - 4, +a[2] - 4, +a[3]])) {
    for (let i = 0; i < len; i++) drawn[y][x + i] = true;
  }
  assert.deepEqual(drawn, m);
  // Sombre sur clair, quel que soit le thème.
  assert.ok(svg.includes('fill="#ffffff"') && svg.includes('fill="#0b1020"'));
});
