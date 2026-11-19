// « Ton ascension » : géométrie du chemin qui monte de 0 à 100 jours.
// Fonction pure : renvoie le tracé SVG, la position des paliers et celle du marqueur « Tu es ici ».

export const STEPS = [0, 3, 7, 14, 30, 60, 100];

const W = 300;
const STEP = 124;
const TOP = 74;
const BOTTOM = 66;
const XS = [150, 214, 86, 214, 86, 214, 150];

const f = (p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
const lerp = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });

export function journeyLayout(current) {
  const n = STEPS.length - 1;
  const H = TOP + BOTTOM + n * STEP;
  const pts = STEPS.map((value, i) => ({ value, x: XS[i], y: H - BOTTOM - i * STEP }));

  // Chaque tronçon est une courbe en S : tangentes verticales aux paliers.
  const segs = pts.slice(0, -1).map((a, i) => {
    const b = pts[i + 1];
    const my = (a.y + b.y) / 2;
    return [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
  });
  const curve = ([, c1, c2, e]) => `C ${f(c1)}, ${f(c2)}, ${f(e)}`;
  const full = `M ${f(pts[0])} ${segs.map(curve).join(' ')}`;

  // Dernier palier atteint, puis avancement dans le tronçon suivant.
  let i = 0;
  while (i < n && current >= STEPS[i + 1]) i++;

  let marker;
  let done;
  if (i >= n) {
    marker = pts[n];
    done = full;
  } else {
    const u = (current - STEPS[i]) / (STEPS[i + 1] - STEPS[i]);
    const [p0, p1, p2, p3] = segs[i];
    const a = lerp(p0, p1, u);
    const b = lerp(p1, p2, u);
    const c = lerp(p2, p3, u);
    const d = lerp(a, b, u);
    const e = lerp(b, c, u);
    marker = lerp(d, e, u);
    done = `M ${f(pts[0])} ${segs.slice(0, i).map(curve).join(' ')}${u > 0 ? ` C ${f(a)}, ${f(d)}, ${f(marker)}` : ''}`.replace(/\s+/g, ' ').trim();
  }
  return { W, H, pts, full, done, marker, segment: i };
}
