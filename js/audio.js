// Notes de base du guidage « Repères » et vibrations.
// Les sons de la session sont fabriqués par track.js, puis lus par guide.js.

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * Les repères : [forme, de (Hz), vers (Hz), durée (s), niveau, coupure du filtre (Hz)].
 * Le glissé qui monte accompagne l'inspiration, celui qui descend l'expiration ; les pauses restent silencieuses.
 */
export const CUES = {
  glisse: { inhale: ['glide', 330, 494, 1.3, 0.06, 2000], exhale: ['glide', 440, 294, 1.7, 0.05, 1300] }, // mi → si, la → ré
};
/** Début et fin de session : le même geste, en plus long (monte au début, redescend à la fin). */
export const CHIMES = { start: ['glide', 262, 392, 1.8, 0.05, 1500], end: ['glide', 392, 262, 2.6, 0.05, 1200] };

/** Le curseur de volume est perceptif : 100 % reste doux, 0 % coupe le son. */
export const gainFor = (volume) => Math.pow(clamp01(volume / 100), 1.6);

export const SAMPLE_RATE = 22050;
const TAU = Math.PI * 2;
const LEVEL_MATCH = 1.85; // niveau aligné sur l'ancien moteur Web Audio, dont le compresseur relevait le son

/** Échantillons (−1..1) d'un repère : une note douce qui glisse, avec une enveloppe sans attaque franche. */
export function renderCue(spec, volume = 60, rate = SAMPLE_RATE) {
  const [type, from, to, dur, peak] = spec;
  const glide = type === 'glide';
  const silentAt = glide ? dur + 0.45 : dur + 0.2; // l'enveloppe atteint le silence ici
  const total = Math.ceil((dur + (glide ? 0.6 : 0.3)) * rate);
  const harmonic = glide ? 0.12 : 0.18;
  const gain = gainFor(volume) * LEVEL_MATCH;
  const floor = 0.0001;
  const out = new Float32Array(total);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < total; i++) {
    const t = i / rate;
    const f = from * Math.pow(to / from, Math.min(1, t / dur));
    p1 += (TAU * f) / rate;
    p2 += (TAU * 2 * f) / rate;
    let env;
    if (glide) {
      if (t < 0.28) env = floor + (peak - floor) * (t / 0.28);
      else if (t < dur * 0.5) env = peak;
      else env = peak * Math.pow(floor / peak, Math.min(1, (t - dur * 0.5) / (silentAt - dur * 0.5)));
    } else if (t < 0.018) env = floor + (peak - floor) * (t / 0.018);
    else env = peak * Math.pow(floor / peak, Math.min(1, (t - 0.018) / (silentAt - 0.018)));
    const fade = Math.min(1, (total - i) / (rate * 0.04)); // zéro exact à la fin : aucun claquement
    out[i] = (Math.sin(p1) + harmonic * Math.sin(p2)) * env * gain * fade;
  }
  return out;
}

export function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* non supporté */
  }
}
