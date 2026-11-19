// Piste audio d'une session, fabriquée d'un coup et lue par un élément <audio>.
//
// Pourquoi un fichier plutôt que des sons calculés en direct : le téléphone le lit comme un podcast. Il continue
// écran verrouillé, avec des écouteurs ou en Bluetooth, et l'écran de verrouillage ou la voiture peuvent le mettre en pause.
//
// Le souffle est périodique (le même cycle revient toute la session) : on ne calcule donc qu'un cycle (ou quelques
// variantes de bruit) qu'on recopie. Même pour dix minutes, la fabrication est quasi instantanée.

import { phaseAt, cycleLength, sessionPlan } from './breath.js';
import { renderCue, gainFor, CUES, CHIMES } from './audio.js';

export const TRACK_RATE = 11025; // les sons sont doux et graves : inutile d'aller plus haut (fichier deux fois plus léger)
export const LEAD = 6; // secondes pour s'installer avant la première inspiration
export const TAIL = 5; // secondes de retombée après la dernière expiration

export const GUIDE_STYLES = [
  { id: 'vague', name: 'Vague', blurb: 'Une houle douce : elle enfle quand tu inspires, s’éloigne quand tu expires.' },
  { id: 'nappe', name: 'Nappe', blurb: 'Une nappe de voyelles qui s’ouvre quand tu inspires et se referme quand tu expires.' },
  { id: 'reperes', name: 'Repères', blurb: 'Seulement deux notes : l’une monte pour inspirer, l’autre descend pour expirer.' },
];
export const DEFAULT_GUIDE = 'vague';

const TAU = Math.PI * 2;
const XFADE = 0.04; // demi-durée du fondu enchaîné entre deux morceaux de bruit (s)
const PEAK = 0.5; // niveau maximal de la piste à volume 100 % (les boutons du téléphone règlent le reste)

/** Plan d'une piste : durées de chaque partie, en secondes. */
export function trackPlan(preset, minutes, { cycles, lead = LEAD, tail = TAIL } = {}) {
  const len = cycleLength(preset);
  const n = cycles ?? sessionPlan(preset, minutes).cycles;
  const breath = n * len;
  return { len, cycles: n, lead, tail, breath, total: lead + breath + tail };
}

/** Générateur pseudo-aléatoire (xorshift32) : le même bruit à chaque rendu, ce qui rend les tests reproductibles. */
function rng(seed) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) / 4294967296) * 2 - 1;
  };
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const mod = (i, n) => ((i % n) + n) % n;

// ---------- Bruit de houle : du bruit filtré dont la clarté et le volume suivent le souffle ----------

/** `bAt(i)` : niveau du souffle à l'échantillon i (i peut sortir de [0, n) pour les recouvrements). Rend n + 2X échantillons. */
function noiseSegment(seed, n, X, rate, bAt) {
  const rand = rng(seed);
  const warm = Math.round(0.3 * rate); // le filtre se met en régime avant le début
  const out = new Float32Array(n + 2 * X);
  let y1 = 0;
  let y2 = 0;
  for (let k = -warm - X; k < n + X; k++) {
    const b = bAt(k);
    const fc = 200 + 1900 * Math.pow(b, 1.2); // plus claire quand les poumons sont pleins
    const a = 1 - Math.exp((-TAU * fc) / rate);
    y1 += a * (rand() - y1);
    y2 += a * (y1 - y2);
    if (k >= -X) out[k + X] = y2 * (0.1 + 0.9 * Math.pow(b, 1.1)) * (0.5 / Math.sqrt(a));
  }
  return out;
}

// ---------- Parties tonales (parfaitement périodiques : leurs fréquences font un nombre entier d'oscillations par cycle) ----------

const harmonicBase = (hz, len) => Math.round(hz * len) / len;

/** Fond grave de la houle : une octave et une quinte, qui respirent avec le souffle. */
function bedSegment(i0, n, rate, len, bAt) {
  const f0 = harmonicBase(98, len);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const t = (i0 + k) / rate;
    const b = bAt(i0 + k);
    out[k] = (0.5 * Math.sin(TAU * f0 * t) + 0.3 * Math.sin(TAU * 2 * f0 * t) + 0.2 * Math.sin(TAU * 3 * f0 * t)) * (0.25 + 0.75 * b) * 0.32;
  }
  return out;
}

/** Nappe : deux voix aux harmoniques pondérées par deux formants qui glissent de « ou » (poumons vides) vers « a » (pleins). */
function padSegment(i0, n, rate, len, bAt) {
  const voices = [harmonicBase(110, len), harmonicBase(165, len)];
  const H = 10;
  const out = new Float32Array(n);
  const weights = voices.map(() => new Float32Array(H + 1));
  const BLOCK = 32;
  for (let k = 0; k < n; k++) {
    const b = bAt(i0 + k);
    if (k % BLOCK === 0) {
      const f1 = 300 + 500 * b;
      const f2 = 870 + 330 * b;
      voices.forEach((f0, v) => {
        for (let h = 1; h <= H; h++) {
          const f = h * f0;
          weights[v][h] = Math.exp(-0.5 * ((f - f1) / 120) ** 2) + 0.7 * Math.exp(-0.5 * ((f - f2) / 170) ** 2) + 0.12 / h;
        }
      });
    }
    const t = (i0 + k) / rate;
    let sum = 0;
    for (let v = 0; v < voices.length; v++) {
      const w = weights[v];
      const f0 = voices[v];
      for (let h = 1; h <= H; h++) sum += w[h] * Math.sin(TAU * h * f0 * t);
    }
    out[k] = sum * (0.15 + 0.85 * b) * 0.12;
  }
  return out;
}

// ---------- Rendu ----------

/** Ajoute `src` (déjà pondéré par `weight(j)`) dans `pcm` à partir de l'indice `at`, en ignorant ce qui sort de la piste. */
function mixInto(pcm, at, src, scale, weight) {
  for (let j = 0; j < src.length; j++) {
    const i = at + j;
    if (i < 0 || i >= pcm.length) continue;
    const v = pcm[i] + Math.round(src[j] * scale * (weight ? weight(j) : 1) * 32767);
    pcm[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
}

/**
 * Fabrique la piste. Renvoie { pcm: Int16Array, rate, plan }.
 * `style` : 'vague' | 'nappe' | 'reperes'. `volume` : 0..100 (niveau de la piste ; le volume du téléphone règle le reste).
 */
export async function renderTrack({ preset, minutes, cycles, style = DEFAULT_GUIDE, volume = 100, lead, tail, rate = TRACK_RATE } = {}) {
  const plan = trackPlan(preset, minutes, { cycles, lead, tail });
  const L = plan.len * rate;
  const leadN = Math.round(plan.lead * rate);
  const tailN = Math.round(plan.tail * rate);
  const X = Math.round(XFADE * rate);
  const total = leadN + plan.cycles * L + tailN;
  const pcm = new Int16Array(total);
  const bTable = new Float32Array(L);
  for (let i = 0; i < L; i++) bTable[i] = phaseAt(preset, i / rate).breath;
  const bCycle = (i) => bTable[mod(i, L)];
  const silent = () => 0;
  const level = PEAK * gainFor(volume);

  // Fondu d'entrée et de sortie de toute la piste.
  const fadeIn = style === 'reperes' ? 0.05 : 2;
  const fadeOut = style === 'reperes' ? 0.6 : 3;
  const master = (i) => {
    const a = Math.min(1, i / (fadeIn * rate));
    const b = Math.min(1, (total - i) / (fadeOut * rate));
    const x = Math.min(a, b);
    return x * x * (3 - 2 * x); // lissé
  };

  if (style === 'reperes') {
    // Deux notes par cycle (le glissé qui monte, puis celui qui descend), recopiées ; un geste au début, un à la fin.
    const cycle = new Float32Array(L);
    const place = (buf, spec, seconds, wrap) => {
      const cue = renderCue(spec, 100, rate);
      const at = Math.round(seconds * rate);
      for (let j = 0; j < cue.length; j++) {
        const i = wrap ? mod(at + j, buf.length) : at + j;
        if (i < buf.length) buf[i] += cue[j];
      }
    };
    place(cycle, CUES.glisse.inhale, 0, true);
    place(cycle, CUES.glisse.exhale, preset.inhale + preset.hold1, true);
    let peak = 1e-9;
    for (let i = 0; i < cycle.length; i++) if (Math.abs(cycle[i]) > peak) peak = Math.abs(cycle[i]);
    const scale = level / peak;
    for (let c = 0; c < plan.cycles; c++) mixInto(pcm, leadN + c * L, cycle, scale);
    const edge = new Float32Array(Math.max(leadN, tailN) + 3 * rate);
    place(edge, CHIMES.start, 0.4, false);
    mixInto(pcm, 0, edge.subarray(0, leadN), level / peak);
    const endChime = new Float32Array(tailN + rate);
    place(endChime, CHIMES.end, 0, false);
    mixInto(pcm, leadN + plan.cycles * L, endChime.subarray(0, tailN), level / peak);
    for (let i = 0; i < total; i++) if (i < fadeIn * rate || total - i < fadeOut * rate) pcm[i] = Math.round(pcm[i] * master(i));
    return { pcm, rate, plan };
  }

  const tonal = style === 'nappe' ? padSegment : bedSegment;
  const useNoise = style === 'vague';
  await pause();

  // Un cycle de partie tonale (identique à chaque tour) et trois variantes de bruit (pour qu'on n'entende jamais de boucle).
  const tonalCycle = tonal(0, L, rate, plan.len, bCycle);
  const variants = useNoise ? [101, 202, 303].map((seed) => noiseSegment(seed, L, X, rate, bCycle)) : [];
  await pause();

  // Niveau : le plus haut pic d'un cycle complet (partie tonale + bruit), ramené au niveau voulu.
  let peak = 1e-9;
  for (let v = 0; v < Math.max(1, variants.length); v++) {
    for (let i = 0; i < L; i++) {
      const s = tonalCycle[i] + (variants[v] ? variants[v][i + X] : 0);
      if (Math.abs(s) > peak) peak = Math.abs(s);
    }
  }
  const scale = (level / peak) * 0.92; // un peu de marge pour les recouvrements

  // Poids d'un morceau de bruit : fondu d'entrée sur 2X, corps à 1, fondu de sortie sur 2X (puissance constante).
  const noiseWeight = (n, first, last) => (j) => {
    if (!first && j < 2 * X) return Math.sin(((Math.PI / 2) * j) / (2 * X));
    if (!last && j >= n) return Math.cos(((Math.PI / 2) * (j - n)) / (2 * X));
    return 1;
  };

  // Début : fond au niveau « poumons vides ».
  mixInto(pcm, 0, tonal(-leadN, leadN, rate, plan.len, silent), scale);
  if (useNoise) mixInto(pcm, -X, noiseSegment(7, leadN, X, rate, silent), scale, noiseWeight(leadN, true, false));
  // Cycles.
  for (let c = 0; c < plan.cycles; c++) {
    const s = leadN + c * L;
    mixInto(pcm, s, tonalCycle, scale);
    if (useNoise) mixInto(pcm, s - X, variants[c % variants.length], scale, noiseWeight(L, false, false));
    if (c % 8 === 7) await pause();
  }
  // Fin.
  const tailAt = leadN + plan.cycles * L;
  mixInto(pcm, tailAt, tonal(plan.cycles * L, tailN, rate, plan.len, silent), scale);
  if (useNoise) mixInto(pcm, tailAt - X, noiseSegment(11, tailN, X, rate, silent), scale, noiseWeight(tailN, false, true));

  for (let i = 0; i < total; i++) {
    if (i < fadeIn * rate || total - i < fadeOut * rate) pcm[i] = Math.round(pcm[i] * master(i));
  }
  return { pcm, rate, plan };
}

/** Fichier WAV (mono, 16 bits) d'une piste, sans recopier les échantillons. */
export function wavBlob(pcm, rate = TRACK_RATE) {
  const head = new DataView(new ArrayBuffer(44));
  const text = (o, str) => {
    for (let i = 0; i < str.length; i++) head.setUint8(o + i, str.charCodeAt(i));
  };
  const bytes = pcm.length * 2;
  text(0, 'RIFF');
  head.setUint32(4, 36 + bytes, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  head.setUint32(16, 16, true);
  head.setUint16(20, 1, true);
  head.setUint16(22, 1, true);
  head.setUint32(24, rate, true);
  head.setUint32(28, rate * 2, true);
  head.setUint16(32, 2, true);
  head.setUint16(34, 16, true);
  text(36, 'data');
  head.setUint32(40, bytes, true);
  return new Blob([head.buffer, pcm.buffer], { type: 'audio/wav' });
}
