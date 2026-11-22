// Piste audio d'une session, fabriquée d'un coup et lue par un élément <audio>.
//
// Pourquoi un fichier plutôt que des sons calculés en direct : le téléphone le lit comme un podcast. Il continue
// écran verrouillé, avec des écouteurs ou en Bluetooth, et l'écran de verrouillage ou la voiture peuvent le mettre en pause.
//
// Le souffle est périodique (le même cycle revient toute la session) : on ne calcule donc que quelques sons
// (une frappe par phase, une ouverture, une clôture) qu'on recopie. Même pour dix minutes, la fabrication est quasi instantanée.

import { cycleLength, sessionPlan } from './breath.js';
import { renderCue, gainFor, CUES, CHIMES } from './audio.js';

export const TRACK_RATE = 11025; // les sons sont doux et graves : inutile d'aller plus haut (fichier deux fois plus léger)
export const LEAD = 5; // secondes pour s'installer avant la première inspiration (c'est aussi l'introduction de la session)
export const TAIL = 5; // secondes de retombée après la dernière expiration

export const GUIDE_STYLES = [
  { id: 'bol', name: 'Bol', blurb: 'Un bol chantant : le si pour inspirer, le ré pour expirer. Un carillon grave ouvre et clôt la séance.' },
  { id: 'reperes', name: 'Repères', blurb: 'Le guidage d’origine : une note qui monte pour inspirer, une qui descend pour expirer.' },
];
export const DEFAULT_GUIDE = 'bol';

const TAU = Math.PI * 2;
const PEAK = 0.5; // niveau maximal de la piste à volume 100 % (les boutons du téléphone règlent le reste)

/** Plan d'une piste : durées de chaque partie, en secondes. */
export function trackPlan(preset, minutes, { cycles, lead = LEAD, tail = TAIL, loop = false } = {}) {
  const len = cycleLength(preset);
  if (loop) {
    // Piste en boucle (session sans limite) : ni installation ni retombée, des cycles seulement.
    const n = loopCycles(preset);
    return { len, cycles: n, lead: 0, tail: 0, breath: n * len, total: n * len, loop: true };
  }
  const n = cycles ?? sessionPlan(preset, minutes).cycles;
  const breath = n * len;
  return { len, cycles: n, lead, tail, breath, total: lead + breath + tail, loop: false };
}

/**
 * Nombre de cycles d'une piste en boucle : environ quatre minutes, et un multiple de 3 (la boucle reste ainsi un
 * nombre rond de tours si un guidage venait à alterner trois variantes).
 */
export function loopCycles(preset) {
  return 3 * Math.max(1, Math.round(80 / cycleLength(preset)));
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

// ---------- Convolution rapide (FFT) : sert à la réverbération du bol ----------

const twiddles = new Map();

/** Transformée de Fourier rapide sur place (taille = puissance de 2). `inverse` : transformée inverse, normalisée. */
function fft(re, im, inverse = false) {
  const n = re.length;
  let tw = twiddles.get(n);
  if (!tw) {
    tw = { cos: new Float64Array(n / 2), sin: new Float64Array(n / 2) };
    for (let i = 0; i < n / 2; i++) {
      tw.cos[i] = Math.cos((TAU * i) / n);
      tw.sin[i] = Math.sin((TAU * i) / n);
    }
    twiddles.set(n, tw);
  }
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1;
    const step = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < half; k++) {
        const wr = tw.cos[k * step];
        const wi = sign * tw.sin[k * step];
        const a = i + k;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
  if (inverse) {
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
  }
}

const irSpectra = new WeakMap(); // réponse -> { taille -> spectre }

/** Convolution de `x` avec la réponse `ir` (longueur x + ir - 1), par FFT. Le spectre de la réponse est gardé. */
export function convolve(x, ir) {
  const out = x.length + ir.length - 1;
  let n = 1;
  while (n < out) n <<= 1;
  let bySize = irSpectra.get(ir);
  if (!bySize) irSpectra.set(ir, (bySize = new Map()));
  let h = bySize.get(n);
  if (!h) {
    h = { re: new Float64Array(n), im: new Float64Array(n) };
    h.re.set(ir);
    fft(h.re, h.im);
    bySize.set(n, h);
  }
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  re.set(x);
  fft(re, im);
  for (let i = 0; i < n; i++) {
    const r = re[i] * h.re[i] - im[i] * h.im[i];
    im[i] = re[i] * h.im[i] + im[i] * h.re[i];
    re[i] = r;
  }
  fft(re, im, true);
  return Float32Array.from(re.subarray(0, out));
}

// ---------- Bol chantant : deux frappes par cycle, un carillon grave pour ouvrir et clore ----------

const BOWL = { inhale: 493.88, exhale: 293.66 }; // si4 pour inspirer, ré4 pour expirer
// do4 fa4 la4 do5 : aucune des notes de respiration (si, ré), dans un autre timbre, pour ne rien confondre avec elles
const CHIME_NOTES = [261.63, 349.23, 440.0, 523.25];
// [rapport de fréquence, amplitude, durée de chute (s), battement de la copie désaccordée (Hz)]
const BOWL_MODES = [[1.0, 1.0, 2.6, 0.7], [2.71, 0.34, 1.5, 1.1], [5.15, 0.1, 0.7, 1.7]];
const CHIME_MODES = [[1.0, 1.0, 1.1, 0.8], [2.76, 0.3, 0.55, 1.2], [5.4, 0.09, 0.3, 1.9]];
const SHIMMER = 0.14; // poids de la copie désaccordée : la résonance ondule à peine (±0,5 dB)
// Les frappes sont brèves : à crête égale, le bol paraîtrait plus discret que Repères. Ce gain donne le même niveau perçu (même RMS).
const BOL_GAIN = 1.29;
const MARK_MIN = 4; // une ouverture ou une clôture ne se joue que si l'installation ou la retombée dure au moins ça (s)

/** Une note de cloche : somme de modes qui s'éteignent, attaque douce (aucune variation de hauteur, aucun bruit). */
function modal(freq, dur, modes, attack, rate) {
  const n = Math.round(dur * rate);
  const out = new Float32Array(n);
  for (const [ratio, amp, tau, beat] of modes) {
    for (const [detune, weight] of [[0, 1 - SHIMMER], [beat, SHIMMER]]) {
      const w = (TAU * (freq * ratio + detune)) / rate;
      for (let i = 0; i < n; i++) {
        const t = i / rate;
        const a = Math.sin((Math.min(1, t / attack) * Math.PI) / 2);
        out[i] += weight * amp * Math.sin(w * i) * a * a * Math.exp(-t / tau);
      }
    }
  }
  const end = Math.round(0.12 * rate);
  for (let i = 0; i < Math.min(end, n); i++) out[n - 1 - i] *= i / end; // la note se referme sans clic
  return out;
}

/** « La salle » : du bruit adouci qui s'éteint en 2,8 s, normalisé en énergie. Même graine : même salle à chaque fois. */
function roomImpulse(rate) {
  const n = Math.round(2.8 * rate);
  const pre = Math.round(0.025 * rate);
  const rand = rng(77);
  const a = 1 - Math.exp((-TAU * 2200) / rate);
  const ir = new Float32Array(n);
  let y1 = 0;
  let y2 = 0;
  let e = 0;
  for (let i = 0; i < n; i++) {
    y1 += a * (rand() - y1);
    y2 += a * (y1 - y2);
    if (i >= pre) {
      ir[i] = y2 * Math.exp(-i / (0.75 * rate));
      e += ir[i] * ir[i];
    }
  }
  const k = 1 / Math.sqrt(e);
  for (let i = 0; i < n; i++) ir[i] *= k;
  return ir;
}

const DRY = 0.68; // part du son sec ; le reste est la réverbération
const sumSquares = (a, seconds, rate) => {
  let e = 0;
  const n = Math.min(a.length, Math.round(seconds * rate));
  for (let i = 0; i < n; i++) e += a[i] * a[i];
  return e;
};

const bolCache = new Map();

/** Les quatre sons du bol (inspirer, expirer, ouverture, clôture), réverbération comprise. Calculés une fois par fréquence d'échantillonnage. */
function bolSounds(rate) {
  if (!bolCache.has(rate)) {
    bolCache.set(
      rate,
      (async () => {
        const room = roomImpulse(rate);
        const wet = (dry) => {
          const conv = convolve(dry, room);
          const out = new Float32Array(conv.length);
          for (let i = 0; i < conv.length; i++) out[i] = (1 - DRY) * conv[i] + (i < dry.length ? DRY * dry[i] : 0);
          return out;
        };
        const inhale = wet(modal(BOWL.inhale, 5, BOWL_MODES, 0.02, rate));
        await pause();
        const exhale = wet(modal(BOWL.exhale, 5, BOWL_MODES, 0.02, rate));
        await pause();
        const place = (buf, at, note, dur) => {
          const sig = modal(note, dur, CHIME_MODES, 0.008, rate);
          const a = Math.round(at * rate);
          for (let i = 0; i < sig.length; i++) buf[a + i] += sig[i];
        };
        const [n1, n2, n3, n4] = CHIME_NOTES;
        const introDry = new Float32Array(Math.round(4.4 * rate));
        [n1, n2, n3].forEach((f, i) => place(introDry, 0.5 + 0.3 * i, f, 1.6)); // monte
        place(introDry, 1.4, n4, 3.0);
        const outroDry = new Float32Array(Math.round(4.8 * rate));
        place(outroDry, 0.3, n4, 1.6); // redescend
        place(outroDry, 0.6, n3, 1.6);
        place(outroDry, 0.9, n2, 1.6);
        place(outroDry, 1.5, n1, 3.3);
        const intro = wet(introDry);
        await pause();
        const outro = wet(outroDry);
        // L'ouverture et la clôture ont le niveau d'un cycle de respiration (énergie sur les 5 s de l'installation / de la retombée).
        const cycleEnergy = sumSquares(inhale, 10, rate) + sumSquares(exhale, 10, rate);
        const gIntro = Math.sqrt(cycleEnergy / 10 / (sumSquares(intro, 5, rate) / 5));
        const gOutro = Math.sqrt(cycleEnergy / 10 / (sumSquares(outro, 5, rate) / 5));
        for (let i = 0; i < intro.length; i++) intro[i] *= gIntro;
        for (let i = 0; i < outro.length; i++) outro[i] *= gOutro;
        let refPeak = 1e-9;
        for (const a of [inhale, exhale, intro, outro]) for (let i = 0; i < a.length; i++) if (Math.abs(a[i]) > refPeak) refPeak = Math.abs(a[i]);
        return { inhale, exhale, intro, outro, refPeak };
      })(),
    );
  }
  return bolCache.get(rate);
}

/** À appeler un peu après le démarrage de l'application : le premier son du bol se prépare pendant que l'on ne fait rien. */
export function warmGuide(style = DEFAULT_GUIDE, rate = TRACK_RATE) {
  return style === 'reperes' ? Promise.resolve() : bolSounds(rate);
}

// ---------- Rendu ----------

/** Ajoute `src` (déjà pondéré par `weight(j)`) dans `pcm` à partir de l'indice `at`, en ignorant ce qui sort de la piste. */
function mixInto(pcm, at, src, scale, weight, circular = false) {
  for (let j = 0; j < src.length; j++) {
    let i = at + j;
    if (circular) i = mod(i, pcm.length); // en boucle, la fin déborde sur le début et inversement
    else if (i < 0 || i >= pcm.length) continue;
    const v = pcm[i] + Math.round(src[j] * scale * (weight ? weight(j) : 1) * 32767);
    pcm[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : v;
  }
}

/**
 * Fabrique la piste. Renvoie { pcm: Int16Array, rate, plan }.
 * `style` : 'bol' | 'reperes'. `volume` : 0..100 (niveau de la piste ; le volume du téléphone règle le reste).
 */
export async function renderTrack({ preset, minutes, cycles, style = DEFAULT_GUIDE, volume = 100, lead, tail, rate = TRACK_RATE, loop = false } = {}) {
  const plan = trackPlan(preset, minutes, { cycles, lead, tail, loop });
  const L = plan.len * rate;
  const leadN = Math.round(plan.lead * rate);
  const tailN = Math.round(plan.tail * rate);
  const total = leadN + plan.cycles * L + tailN;
  const pcm = new Int16Array(total);
  const level = PEAK * gainFor(volume);

  // Fondu d'entrée et de sortie de toute la piste.
  const resumes = style !== 'reperes' && plan.cycles === 0 && leadN === 0; // retombée seule, qui prolonge la piste en boucle
  const fadeIn = loop || resumes ? 0 : 0.05;
  const fadeOut = loop ? 0 : style === 'reperes' ? 0.6 : 1.2;
  const fade = () => {
    if (loop) return;
    for (let i = 0; i < total; i++) {
      if (i < fadeIn * rate || total - i < fadeOut * rate) {
        const x = Math.min(fadeIn > 0 ? Math.min(1, i / (fadeIn * rate)) : 1, Math.min(1, (total - i) / (fadeOut * rate)));
        pcm[i] = Math.round(pcm[i] * x * x * (3 - 2 * x)); // lissé
      }
    }
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
    if (!loop) {
      const edge = new Float32Array(Math.max(leadN, tailN) + 3 * rate);
      place(edge, CHIMES.start, 0.4, false);
      mixInto(pcm, 0, edge.subarray(0, leadN), level / peak);
      const endChime = new Float32Array(tailN + rate);
      place(endChime, CHIMES.end, 0, false);
      mixInto(pcm, leadN + plan.cycles * L, endChime.subarray(0, tailN), level / peak);
      fade();
    }
    return { pcm, rate, plan };
  }

  // Bol : une frappe à chaque début d'inspiration (si) et d'expiration (ré), une résonance qui déborde sur la suite.
  const sounds = await bolSounds(rate);
  const exhaleAt = Math.round((preset.inhale + preset.hold1) * rate);
  const cycle = new Float32Array(Math.max(L, sounds.inhale.length, exhaleAt + sounds.exhale.length));
  for (let i = 0; i < sounds.inhale.length; i++) cycle[i] += sounds.inhale[i];
  for (let i = 0; i < sounds.exhale.length; i++) cycle[exhaleAt + i] += sounds.exhale[i];
  const bolLevel = level * BOL_GAIN;
  const scale = bolLevel / sounds.refPeak;
  // En boucle, la résonance de la fin du tour se prolonge sur le début (la jonction est invisible) ; sinon elle déborde sur la suite.
  for (let c = 0; c < plan.cycles; c++) mixInto(pcm, leadN + c * L, cycle, scale, null, loop);
  // Une retombée seule (fin d'une longue séance) reprend la résonance du cycle précédent, que la piste en boucle vient de laisser.
  if (!loop && plan.cycles === 0 && leadN === 0) mixInto(pcm, -L, cycle, scale);
  if (!loop && plan.lead >= MARK_MIN) mixInto(pcm, 0, sounds.intro, scale);
  if (!loop && plan.tail >= MARK_MIN) mixInto(pcm, leadN + plan.cycles * L, sounds.outro, scale);
  // Jamais plus fort que le niveau demandé, même si des résonances se superposent.
  let peak = 0;
  for (let i = 0; i < total; i++) if (Math.abs(pcm[i]) > peak) peak = Math.abs(pcm[i]);
  const cap = bolLevel * 32767;
  if (peak > cap) for (let i = 0; i < total; i++) pcm[i] = Math.round((pcm[i] * cap) / peak);
  fade();
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
