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

/**
 * Les repères, définis une seule fois pour les deux moteurs (Web Audio et lecteur audio de secours).
 * [forme, de (Hz), vers (Hz), durée (s), niveau, coupure du filtre (Hz)]
 */
const CUES = {
  glisse: { inhale: ['glide', 330, 494, 1.3, 0.06, 2000], exhale: ['glide', 440, 294, 1.7, 0.05, 1300] }, // mi → si, la → ré
  bulle: { inhale: ['bubble', 300, 640, 0.17, 0.08], exhale: ['bubble', 600, 280, 0.22, 0.065] },
};
const CHIMES = { start: ['glide', 262, 392, 1.8, 0.05, 1500], end: ['glide', 392, 262, 2.6, 0.05, 1200] };

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
    this.kind = 'webaudio';
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
    this.playSpec(CUES[this.mode]?.[phase], at ?? this.ctx.currentTime);
  }

  playSpec(spec, at) {
    if (!spec) return;
    const [type, from, to, dur, peak, cutoff] = spec;
    if (type === 'glide') this.glide(from, to, dur, peak, at, cutoff);
    else this.bubble(from, to, dur, peak, at);
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
    this.playSpec(CHIMES[kind === 'start' ? 'start' : 'end'], at ?? this.ctx.currentTime);
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

// ---------- Secours : lecteur audio (quand Web Audio est absent, par exemple en Mode d'isolement d'iOS) ----------

export const SAMPLE_RATE = 22050;
const TAU = Math.PI * 2;
const LEVEL_MATCH = 1.85;

/** Échantillons (−1..1) d'un repère : même note, même enveloppe et même niveau que le moteur Web Audio (hors réverbération). */
export function renderCue(spec, volume = DEFAULT_VOLUME, rate = SAMPLE_RATE) {
  const [type, from, to, dur, peak] = spec;
  const glide = type === 'glide';
  const silentAt = glide ? dur + 0.45 : dur + 0.2; // l'enveloppe atteint le silence ici
  const total = Math.ceil((dur + (glide ? 0.6 : 0.3)) * rate);
  const harmonic = glide ? 0.12 : 0.18;
  // Le compresseur de Web Audio relève le niveau d'environ 1,85× (mesuré sur un rendu hors-ligne) : on s'y aligne.
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

/** Fichier WAV (mono, 16 bits) à partir d'échantillons. */
export function encodeWav(samples, rate = SAMPLE_RATE) {
  const n = samples.length;
  const view = new DataView(new ArrayBuffer(44 + n * 2));
  const text = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return new Uint8Array(view.buffer);
}

const wavUrl = (samples) => URL.createObjectURL(new Blob([encodeWav(samples)], { type: 'audio/wav' }));
const KINDS = ['inhale', 'exhale', 'start', 'end'];

/**
 * Même interface que `Sound`, mais joue de petits fichiers audio générés par un élément <audio> :
 * c'est ce qui reste quand l'API Web Audio n'existe pas (Mode d'isolement d'iOS). Pas de mode « Fil » (continu) :
 * il joue alors les « Glissés ». iOS ignore le volume des éléments audio, il est donc écrit dans les échantillons.
 */
export class ElementSound {
  constructor() {
    this.kind = 'element';
    this.ctx = null; // horloge minimale, pour garder les mêmes appels que Sound
    this.g = null;
    this.mode = DEFAULT_MODE;
    this.volume = DEFAULT_VOLUME;
    this.els = null;
    this.urls = [];
    this.timers = new Set();
    this.lastError = '';
    this.failed = false;
    this.onFail = null;
  }

  setMode(mode) {
    if (!SOUND_MODES.some((m) => m.id === mode)) return;
    this.mode = mode;
    this.prepare();
  }

  setVolume(volume) {
    this.volume = Number.isFinite(volume) ? volume : DEFAULT_VOLUME;
    this.prepare();
  }

  /** À appeler pendant un appui : iOS n'autorise la lecture qu'après un geste, élément par élément. */
  async unlock() {
    this.lastError = '';
    if (this.ctx && this.els) return true;
    if (typeof Audio === 'undefined') {
      this.lastError = 'son indisponible';
      return false;
    }
    this.els = {};
    const silence = wavUrl(new Float32Array(SAMPLE_RATE / 10));
    this.urls.push(silence);
    for (const k of KINDS) {
      const a = new Audio();
      a.preload = 'auto';
      a.setAttribute('playsinline', '');
      this.els[k] = a;
    }
    try {
      // Un instant de silence par élément, joué pendant l'appui : ils pourront ensuite jouer d'eux-mêmes.
      await Promise.all(
        KINDS.map(async (k) => {
          const a = this.els[k];
          a.src = silence;
          await a.play();
          a.pause();
        }),
      );
    } catch (e) {
      this.lastError = e?.name || 'lecture refusée';
      this.dispose();
      return false;
    }
    this.failed = false;
    this.ctx = {
      get currentTime() {
        return performance.now() / 1000;
      },
      close: () => {
        this.dispose();
        return Promise.resolve();
      },
    };
    this.prepare();
    return true;
  }

  specFor(kind) {
    if (kind === 'start' || kind === 'end') return CHIMES[kind];
    return CUES[this.mode === 'bulle' ? 'bulle' : 'glisse'][kind];
  }

  /** Fabrique les quatre sons au volume choisi (quelques millisecondes). */
  prepare() {
    if (!this.els) return;
    this.urls.slice(1).forEach((u) => URL.revokeObjectURL(u));
    this.urls = this.urls.slice(0, 1);
    for (const k of KINDS) {
      const url = wavUrl(renderCue(this.specFor(k), this.volume));
      this.urls.push(url);
      this.els[k].src = url;
      this.els[k].load();
    }
  }

  start() {
    if (!this.ctx || this.g) return;
    this.g = {};
  }

  update() {}

  playKind(kind, at) {
    const now = this.ctx.currentTime;
    const delay = Math.max(0, ((at ?? now) - now) * 1000);
    const run = () => {
      this.timers.delete(timer);
      const a = this.els?.[kind];
      if (!a) return;
      try {
        a.currentTime = 0;
        a.play()?.catch((e) => this.fail(e));
      } catch (e) {
        this.fail(e);
      }
    };
    const timer = setTimeout(run, delay);
    this.timers.add(timer);
  }

  fail(e) {
    if (this.failed) return;
    this.failed = true;
    this.lastError = e?.name || 'lecture refusée';
    this.onFail?.(this.lastError);
  }

  cue(phase, cycle = 0, at) {
    if (!this.g || !this.ctx || (phase !== 'inhale' && phase !== 'exhale')) return;
    this.playKind(phase, at);
  }

  chime(kind = 'start', at) {
    if (!this.g || !this.ctx) return;
    this.playKind(kind === 'start' ? 'start' : 'end', at);
  }

  stop(at) {
    if (!this.g || !this.ctx) return;
    this.g = null;
    const wait = at === undefined ? 0 : (at - this.ctx.currentTime) * 1000;
    const finish = () => this.silence();
    if (wait > 50) setTimeout(finish, wait); // laisse finir le repère de fin
    else finish();
  }

  /** Coupe tout de suite ce qui joue ou attend de jouer. */
  silence() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    if (!this.els) return;
    for (const k of KINDS) {
      try {
        this.els[k].pause();
        this.els[k].currentTime = 0;
      } catch {
        /* rien à couper */
      }
    }
  }

  dispose() {
    this.silence();
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
    this.els = null;
    this.ctx = null;
    this.g = null;
  }
}

/** Le moteur Web Audio quand il existe ; sinon le lecteur audio de secours. */
export function createSound() {
  const hasWebAudio = typeof window !== 'undefined' && !!(window.AudioContext || window.webkitAudioContext);
  return hasWebAudio ? new Sound() : new ElementSound();
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
