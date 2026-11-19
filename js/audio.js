// Ambiance sonore générée en direct (aucun fichier audio).
//
// Principe : le son EST le souffle. Un souffle d'air filtré monte et s'éclaircit à l'inspiration,
// redescend et s'assombrit à l'expiration (jusqu'au quasi-silence), accompagné d'une note très douce
// qui suit la même courbe. Rien d'autre par défaut : on doit pouvoir respirer les yeux fermés.

import { phaseAt } from './breath.js';

export const SOUND_MODES = [
  { id: 'souffle', name: 'Souffle', blurb: 'Un souffle d’air qui monte et redescend avec le tien' },
  { id: 'vague', name: 'Vague', blurb: 'Des vagues douces et plus graves' },
  { id: 'carillon', name: 'Carillon', blurb: 'Une note claire à chaque inspiration et expiration' },
];

// Réglages de chaque ambiance : portée du filtre de l'air, niveaux relatifs des couches.
const MODES = {
  souffle: { f0: 360, ratio: 4.2, curve: 1.3, air: 1, foam: 0, tone: 1, bells: 0 },
  vague: { f0: 220, ratio: 4.1, curve: 1.1, air: 3.4, foam: 2.1, tone: 0.3, bells: 0 },
  carillon: { f0: 360, ratio: 4.2, curve: 1.3, air: 0.35, foam: 0, tone: 0.85, bells: 1 },
};

// Gamme pentatonique de ré majeur (Hz) pour les carillons.
const PENTA = [587.33, 659.25, 739.99, 880.0, 987.77, 1174.66];
const TONE_ROOT = 146.83; // ré grave ; la note monte d'une quinte à l'inspiration

const clamp01 = (x) => Math.min(1, Math.max(0, x));

function makeNoise(ctx, seconds = 8) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const xf = Math.floor(rate * 0.5);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    // bruit rose (filtre de Paul Kellet), généré un peu plus long pour boucler sans clic
    const src = new Float32Array(len + xf);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < src.length; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      src[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      if (i < xf) {
        const a = i / xf;
        d[i] = src[i] * a + src[len + i] * (1 - a); // fondu : la fin enchaîne sur le début
      } else d[i] = src[i];
    }
  }
  return buf;
}

/** Petite réverbération : une pièce douce, sans traîne métallique. */
function makeImpulse(ctx, seconds = 2.2) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const w = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.6);
      lp += (w - lp) * (0.45 - 0.38 * t); // la queue s'assombrit
      d[i] = i < rate * 0.015 ? 0 : lp;
    }
  }
  return buf;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.g = null;
    this.mode = 'souffle';
    this.w = MODES.souffle;
  }

  setMode(mode) {
    if (!MODES[mode]) return;
    this.mode = mode;
    this.w = MODES[mode];
  }

  async unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch {
        return false;
      }
    }
    return true;
  }

  /** Utilise un contexte existant (par exemple hors-ligne, pour les tests). */
  attach(ctx) {
    this.ctx = ctx;
  }

  start(at = this.ctx.currentTime) {
    if (!this.ctx || this.g) return;
    const ctx = this.ctx;
    const g = {};
    const gain = (v = 0) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    const filter = (type, freq, q = 0.7) => {
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      return f;
    };

    // Sortie : un compresseur très doux évite tout pic, la réverbération donne de l'espace.
    g.master = gain(0);
    g.comp = ctx.createDynamicsCompressor();
    g.comp.threshold.value = -20;
    g.comp.knee.value = 24;
    g.comp.ratio.value = 3;
    g.comp.attack.value = 0.03;
    g.comp.release.value = 0.35;
    g.master.connect(g.comp).connect(ctx.destination);
    g.bus = gain(1);
    g.bus.connect(g.master);
    g.send = gain(0.28);
    g.conv = ctx.createConvolver();
    g.conv.buffer = makeImpulse(ctx);
    g.ret = gain(0.85);
    g.bus.connect(g.send);
    g.send.connect(g.conv);
    g.conv.connect(g.ret);
    g.ret.connect(g.master);

    // Air : bruit rose filtré. Le filtre monte à l'inspiration (plus clair) et redescend à l'expiration.
    g.noise = ctx.createBufferSource();
    g.noise.buffer = makeNoise(ctx);
    g.noise.loop = true;
    g.hp = filter('highpass', 110);
    g.bp = filter('bandpass', this.w.f0, 0.9);
    g.lp = filter('lowpass', 3000);
    g.air = gain(0);
    g.tex = gain(0.93); // très léger frémissement pour que l'air ne soit jamais figé
    g.lfo = ctx.createOscillator();
    g.lfo.frequency.value = 0.17;
    g.lfoAmt = gain(0.07);
    g.lfo.connect(g.lfoAmt).connect(g.tex.gain);
    g.noise.connect(g.hp).connect(g.bp).connect(g.lp).connect(g.air).connect(g.tex).connect(g.bus);

    // Écume (ambiance « vague ») : un peu de souffle aigu au sommet de la vague.
    g.foamHP = filter('highpass', 2200);
    g.foam = gain(0);
    g.noise.connect(g.foamHP).connect(g.foam).connect(g.bus);

    // Note douce : une quinte qui monte et descend avec le souffle.
    // Les trois voix gardent des rapports exacts (1, 3/2, 2) : jamais de battement ni de tremblement.
    // Seul un vibrato presque imperceptible (± 2,5 centièmes de ton, 0,13 Hz) garde la note vivante.
    g.toneLP = filter('lowpass', 600, 0.4);
    g.tone = gain(0);
    g.o1 = ctx.createOscillator();
    g.o1.type = 'triangle';
    g.o2 = ctx.createOscillator();
    g.o2.type = 'sine';
    g.o2Gain = gain(0.28);
    g.o3 = ctx.createOscillator();
    g.o3.type = 'sine';
    g.o3Gain = gain(0.4);
    g.vib = ctx.createOscillator();
    g.vib.frequency.value = 0.13;
    g.vibAmt = gain(2.5);
    g.vib.connect(g.vibAmt);
    [g.o1, g.o2, g.o3].forEach((o) => g.vibAmt.connect(o.detune));
    g.o1.connect(g.toneLP);
    g.o2.connect(g.o2Gain).connect(g.toneLP);
    g.o3.connect(g.o3Gain).connect(g.toneLP);
    g.toneLP.connect(g.tone).connect(g.bus);

    g.noise.start(at);
    g.lfo.start(at);
    [g.o1, g.o2, g.o3, g.vib].forEach((o) => o.start(at));
    g.master.gain.setTargetAtTime(1, at, 0.45); // entrée en douceur
    this.g = g;
    this.update(0, at);
  }

  /** `breath` : 0 = poumons vides, 1 = poumons pleins. `at` : instant (horloge audio) de la valeur. */
  update(breath, at = this.ctx.currentTime) {
    const g = this.g;
    if (!g) return;
    const e = clamp01(breath);
    const w = this.w;
    const tc = 0.12;
    g.bp.frequency.setTargetAtTime(w.f0 * Math.pow(w.ratio, e), at, tc);
    g.air.gain.setTargetAtTime(w.air * (0.012 + 0.2 * Math.pow(e, w.curve)), at, tc);
    g.foam.gain.setTargetAtTime(w.foam * 0.07 * Math.pow(e, 3), at, tc);
    const f = TONE_ROOT * Math.pow(2, (7 / 12) * e);
    g.o1.frequency.setTargetAtTime(f, at, tc);
    g.o2.frequency.setTargetAtTime(f * 1.5, at, tc);
    g.o3.frequency.setTargetAtTime(f * 2, at, tc);
    g.toneLP.frequency.setTargetAtTime(500 + 900 * e, at, tc);
    g.tone.gain.setTargetAtTime(w.tone * (0.012 + 0.06 * e), at, tc);
  }

  /** Changement de phase : seul le « carillon » ajoute une note. */
  cue(phase, cycle = 0, at = this.ctx.currentTime) {
    if (!this.g || !this.w.bells) return;
    if (phase === 'inhale') this.bell(PENTA[(cycle * 2) % PENTA.length], 0.05, at);
    else if (phase === 'exhale') this.bell(PENTA[(cycle * 2 + 3) % PENTA.length] / 2, 0.035, at);
  }

  bell(freq, volume, at) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, at);
    out.gain.exponentialRampToValueAtTime(volume, at + 0.008);
    out.gain.exponentialRampToValueAtTime(0.0001, at + 3.2);
    out.connect(this.g.bus);
    [[1, 1], [2.4, 0.22], [4.2, 0.07]].forEach(([ratio, amp]) => {
      const o = ctx.createOscillator();
      const a = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      a.gain.value = amp;
      o.connect(a).connect(out);
      o.start(at);
      o.stop(at + 3.4);
    });
  }

  /** Fin de la session : on laisse l'air et la note s'éteindre doucement. */
  stop(at = this.ctx.currentTime) {
    const g = this.g;
    if (!g) return;
    this.g = null;
    g.master.gain.setTargetAtTime(0, at, 0.3);
    const end = at + 1.8;
    [g.noise, g.lfo, g.o1, g.o2, g.o3, g.vib].forEach((s) => {
      try {
        s.stop(end);
      } catch {
        /* déjà arrêtée */
      }
    });
  }

  /** Bol chantant : début et fin de session. */
  chime(freq = 523.25, volume = 0.1, at = this.ctx?.currentTime) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const bus = this.g ? this.g.bus : ctx.destination;
    [[1, 1], [2.71, 0.3], [5.1, 0.1]].forEach(([ratio, amp]) => {
      const o = ctx.createOscillator();
      const a = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq * ratio;
      a.gain.setValueAtTime(0.0001, at);
      a.gain.exponentialRampToValueAtTime(volume * amp, at + 0.02);
      a.gain.exponentialRampToValueAtTime(0.0001, at + 4.5 / Math.pow(ratio, 0.4));
      o.connect(a).connect(bus);
      o.start(at);
      o.stop(at + 5);
    });
  }
}

/**
 * Programme à l'avance quelques secondes de respiration (aperçu dans les réglages, rendu hors-ligne pour les tests).
 */
export function scheduleDemo(sound, preset, seconds, at = sound.ctx.currentTime) {
  sound.start(at);
  let phase = '';
  let cycle = -1;
  for (let t = 0; t <= seconds; t += 0.02) {
    const p = phaseAt(preset, t);
    sound.update(p.breath, at + t);
    if (p.phase !== phase || p.cycle !== cycle) {
      phase = p.phase;
      cycle = p.cycle;
      sound.cue(phase, cycle, at + t);
    }
  }
  sound.stop(at + seconds);
}

export function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* non supporté */
  }
}
