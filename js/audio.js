// Repères sonores générés en direct (aucun fichier audio), pensés pour rester DISCRETS :
// ils se fondent derrière le travail et disent seulement « inspire » (le son monte) ou « expire » (le son descend).
// Entre deux repères, le silence : on n'entend rien de continu qui fatigue.

import { phaseAt } from './breath.js';

export const SOUND_MODES = [
  { id: 'glisse', name: 'Glissés', blurb: 'Une courte note douce : elle monte quand tu inspires, descend quand tu expires. Silence entre les deux.' },
  { id: 'bulle', name: 'Bulles', blurb: 'De petites bulles : elle monte à l’inspiration, redescend à l’expiration.' },
  { id: 'fil', name: 'Fil', blurb: 'Une note presque imperceptible qui monte et descend avec toi, en continu.' },
];

export const DEFAULT_MODE = 'glisse';
export const DEFAULT_VOLUME = 60; // sur 100

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/** Le curseur de volume est perceptif : 100 % reste doux, 0 % coupe le son. */
const gainFor = (volume) => Math.pow(clamp01(volume / 100), 1.6);

/** Petite pièce douce, pour que les notes se fondent au lieu de claquer. */
function makeImpulse(ctx, seconds = 1.4) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      lp += ((Math.random() * 2 - 1) * Math.pow(1 - t, 2.4) - lp) * (0.4 - 0.33 * t);
      d[i] = i < rate * 0.012 ? 0 : lp;
    }
  }
  return buf;
}

export class Sound {
  constructor() {
    this.ctx = null;
    this.g = null;
    this.mode = DEFAULT_MODE;
    this.volume = DEFAULT_VOLUME;
  }

  setMode(mode) {
    if (SOUND_MODES.some((m) => m.id === mode)) this.mode = mode;
  }

  setVolume(volume) {
    this.volume = Number.isFinite(volume) ? volume : DEFAULT_VOLUME;
    if (this.g) this.g.master.gain.setTargetAtTime(gainFor(this.volume), this.ctx.currentTime, 0.05);
  }

  /** À appeler pendant un appui. En cas d'échec, `lastError` dit pourquoi (pour l'afficher). */
  async unlock() {
    this.lastError = '';
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) {
        this.lastError = 'son indisponible';
        return false;
      }
      try {
        this.ctx = new AC();
      } catch (e) {
        this.lastError = e?.name || 'création impossible';
        return false;
      }
    }
    const ctx = this.ctx;
    try {
      // Safari sur iPhone : jouer un instant de silence pendant l'appui débloque la sortie audio.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    } catch {
      /* sans conséquence : on tente quand même de reprendre */
    }
    if (ctx.state !== 'running') {
      // « suspended » (page) ou « interrupted » (Safari après un appel ou Siri) : dans les deux cas il faut reprendre.
      try {
        await ctx.resume();
      } catch (e) {
        this.lastError = e?.name || 'reprise impossible';
        return false;
      }
    }
    if (ctx.state !== 'running') {
      this.lastError = `état « ${ctx.state} »`;
      return false;
    }
    return true;
  }

  /** Utilise un contexte existant (par exemple hors-ligne, pour les tests). */
  attach(ctx) {
    this.ctx = ctx;
  }

  start(at) {
    if (!this.ctx || this.g) return;
    const ctx = this.ctx;
    at = at ?? ctx.currentTime;
    const g = {};
    g.master = ctx.createGain();
    g.master.gain.value = gainFor(this.volume);
    // Compresseur très doux : aucune crête, même si le volume est poussé.
    g.comp = ctx.createDynamicsCompressor();
    g.comp.threshold.value = -24;
    g.comp.knee.value = 24;
    g.comp.ratio.value = 3;
    g.comp.attack.value = 0.03;
    g.comp.release.value = 0.35;
    g.master.connect(g.comp).connect(ctx.destination);
    g.bus = ctx.createGain();
    g.bus.connect(g.master);
    g.send = ctx.createGain();
    g.send.gain.value = 0.22;
    g.conv = ctx.createConvolver();
    g.conv.buffer = makeImpulse(ctx);
    g.ret = ctx.createGain();
    g.ret.gain.value = 0.9;
    g.bus.connect(g.send);
    g.send.connect(g.conv);
    g.conv.connect(g.ret);
    g.ret.connect(g.master);

    if (this.mode === 'fil') {
      // Un fil de son : sinus pur, presque imperceptible, qui suit la courbe du souffle.
      g.thread = ctx.createOscillator();
      g.thread.type = 'sine';
      g.thread2 = ctx.createOscillator();
      g.thread2.type = 'sine';
      g.thread2Gain = ctx.createGain();
      g.thread2Gain.gain.value = 0.14;
      g.threadGain = ctx.createGain();
      g.threadGain.gain.value = 0;
      g.thread.connect(g.threadGain);
      g.thread2.connect(g.thread2Gain).connect(g.threadGain);
      g.threadGain.connect(g.bus);
      g.thread.start(at);
      g.thread2.start(at);
    }
    this.g = g;
    this.update(0, at);
  }

  /** `breath` : 0 = poumons vides, 1 = poumons pleins. Seul le mode « Fil » est continu. */
  update(breath, at) {
    const g = this.g;
    if (!g || !g.thread || !this.ctx) return;
    at = at ?? this.ctx.currentTime;
    const e = clamp01(breath);
    const f = 261.63 * Math.pow(2, (7 / 12) * e); // do → sol
    g.thread.frequency.setTargetAtTime(f, at, 0.12);
    g.thread2.frequency.setTargetAtTime(f * 2, at, 0.12);
    g.threadGain.gain.setTargetAtTime(0.004 + 0.032 * Math.pow(e, 1.2), at, 0.12);
  }

  /** Changement de phase. L'inspiration monte, l'expiration descend ; les pauses restent silencieuses. */
  cue(phase, cycle = 0, at) {
    if (!this.g || !this.ctx) return;
    at = at ?? this.ctx.currentTime;
    if (this.mode === 'glisse') {
      if (phase === 'inhale') this.glide(330, 494, 1.3, 0.06, at, 2000); // mi → si, plus clair
      else if (phase === 'exhale') this.glide(440, 294, 1.7, 0.05, at, 1300); // la → ré, plus rond
    } else if (this.mode === 'bulle') {
      if (phase === 'inhale') this.bubble(300, 640, 0.17, 0.08, at);
      else if (phase === 'exhale') this.bubble(600, 280, 0.22, 0.065, at);
    }
  }

  /** Note douce qui glisse d'une hauteur à l'autre, sans attaque franche ni cloche. */
  glide(from, to, dur, peak, at, cutoff) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = 0.4;
    out.gain.setValueAtTime(0.0001, at);
    out.gain.linearRampToValueAtTime(peak, at + 0.28);
    out.gain.setValueAtTime(peak, at + dur * 0.5);
    out.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.45);
    lp.connect(out).connect(this.g.bus);
    [[1, 1], [2, 0.12]].forEach(([mult, amp]) => {
      const o = ctx.createOscillator();
      const a = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(from * mult, at);
      o.frequency.exponentialRampToValueAtTime(to * mult, at + dur);
      a.gain.value = amp;
      o.connect(a).connect(lp);
      o.start(at);
      o.stop(at + dur + 0.6);
    });
  }

  /** Petite bulle : un court balayage de hauteur, arrondi, sans résonance métallique. */
  bubble(from, to, dur, peak, at) {
    const ctx = this.ctx;
    const out = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1800;
    out.gain.setValueAtTime(0.0001, at);
    out.gain.linearRampToValueAtTime(peak, at + 0.018);
    out.gain.exponentialRampToValueAtTime(0.0001, at + dur + 0.2);
    lp.connect(out).connect(this.g.bus);
    [[1, 1], [2, 0.18]].forEach(([mult, amp]) => {
      const o = ctx.createOscillator();
      const a = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(from * mult, at);
      o.frequency.exponentialRampToValueAtTime(to * mult, at + dur);
      a.gain.value = amp;
      o.connect(a).connect(lp);
      o.start(at);
      o.stop(at + dur + 0.3);
    });
  }

  /** Début et fin de session : le même geste, en plus long (monte au début, redescend à la fin). */
  chime(kind = 'start', at) {
    if (!this.ctx || !this.g) return;
    at = at ?? this.ctx.currentTime;
    if (kind === 'start') this.glide(262, 392, 1.8, 0.05, at, 1500);
    else this.glide(392, 262, 2.6, 0.05, at, 1200);
  }

  /** Fin de la session : tout s'éteint doucement. */
  stop(at) {
    const g = this.g;
    if (!g || !this.ctx) return;
    at = at ?? this.ctx.currentTime;
    this.g = null;
    g.master.gain.setTargetAtTime(0, at, 0.25);
    [g.thread, g.thread2].forEach((s) => {
      try {
        s?.stop(at + 1.8);
      } catch {
        /* déjà arrêtée */
      }
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
