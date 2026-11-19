// Le guidage sonore d'une session : une piste audio (voir track.js) lue par un élément <audio>.
//
// C'est aussi l'horloge de la session : tant que la piste joue, le temps de la session est sa position de lecture.
// Écran allumé, la bulle s'y cale ; écran verrouillé, le son continue (écouteurs, Bluetooth, voiture) ; au
// déverrouillage, tout est déjà au bon endroit. L'écran de verrouillage et la voiture peuvent la mettre en pause.

import { patternLabel } from './breath.js';
import { formatDuration } from './stats.js';
import { renderTrack, wavBlob, TRACK_RATE } from './track.js';

const TAIL_GRACE_MS = 9000; // après la fin de la séance, on laisse sonner la retombée, puis on libère tout

export class Guide {
  /**
   * @param {{preset:object, cycles:number, style:string, muted:boolean,
   *          onPause?:()=>void, onPlay?:()=>void, onTime?:()=>void, onEnded?:()=>void, onFail?:(reason:string)=>void}} o
   */
  constructor(o) {
    this.o = o;
    this.state = 'idle'; // idle | starting | active | failed | closed
    this.audio = null;
    this.urls = [];
    this.handlers = {};
    this.unlocked = Promise.resolve(null);
    this.muted0 = o.muted;
  }

  /** Vrai dès que la piste joue (ou est en pause) : c'est elle qui donne l'heure. */
  get active() {
    return this.state === 'active';
  }

  get time() {
    return this.audio ? this.audio.currentTime : 0;
  }

  get paused() {
    return !this.audio || this.audio.paused;
  }

  get muted() {
    return this.audio ? this.audio.muted : this.muted0;
  }

  set muted(v) {
    this.muted0 = v;
    if (this.audio) this.audio.muted = v;
  }

  url(blob) {
    const u = URL.createObjectURL(blob);
    this.urls.push(u);
    return u;
  }

  /**
   * À appeler pendant le geste de l'utilisateur (un toucher) : crée l'élément audio et le débloque avec un instant
   * de silence, car iOS n'autorise la lecture qu'après un geste, élément par élément.
   */
  unlock() {
    if (this.audio || typeof Audio === 'undefined') return;
    const a = (this.audio = new Audio());
    a.preload = 'auto';
    a.muted = this.muted0;
    a.setAttribute('playsinline', '');
    a.src = this.url(wavBlob(new Int16Array(TRACK_RATE / 10)));
    this.unlocked = a.play().then(
      () => {
        a.pause();
        return null;
      },
      (e) => e,
    );
  }

  /** Fabrique la piste et la lance à la position `at()` (en secondes). Renvoie true si elle joue. */
  async start(at = () => 0) {
    if (this.state !== 'idle') return false;
    if (!this.audio) return this.fail({ name: 'son indisponible' });
    this.state = 'starting';
    const { preset, cycles, style } = this.o;
    const { pcm, rate } = await renderTrack({ preset, cycles, style });
    const refused = await this.unlocked;
    if (this.state !== 'starting') return false;
    if (refused) return this.fail(refused);
    const a = this.audio;
    a.src = this.url(wavBlob(pcm, rate));
    this.bind();
    try {
      await this.loaded();
      const t = at();
      if (t > 0.05) a.currentTime = t;
      await a.play();
    } catch (e) {
      return this.fail(e);
    }
    if (this.state !== 'starting') return false;
    this.state = 'active';
    this.setupMediaSession();
    return true;
  }

  /** Attend que le navigateur connaisse la durée de la piste (nécessaire pour se placer à une position). */
  loaded() {
    const a = this.audio;
    if (a.readyState >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = (ok) => {
        a.removeEventListener('loadedmetadata', onOk);
        a.removeEventListener('error', onErr);
        clearTimeout(timer);
        ok ? resolve() : reject({ name: 'chargement impossible' });
      };
      const onOk = () => done(true);
      const onErr = () => done(false);
      const timer = setTimeout(() => done(false), 8000);
      a.addEventListener('loadedmetadata', onOk);
      a.addEventListener('error', onErr);
    });
  }

  bind() {
    const a = this.audio;
    const emit = (name) => () => this.state === 'active' && this.o[name]?.();
    this.handlers = {
      pause: () => {
        if (!a.ended) emit('onPause')();
        this.sync();
      },
      play: () => {
        emit('onPlay')();
        this.sync();
      },
      timeupdate: () => {
        emit('onTime')();
        this.position();
      },
      ended: () => {
        emit('onEnded')();
        if (this.finishing) this.destroy();
      },
      error: () => this.state !== 'closed' && this.fail(a.error ? { name: `erreur ${a.error.code}` } : null),
    };
    for (const [name, fn] of Object.entries(this.handlers)) a.addEventListener(name, fn);
  }

  fail(e) {
    if (this.state === 'closed') return false;
    const wasActive = this.state === 'active';
    const reason = e?.name || 'lecture impossible';
    this.destroy();
    this.state = 'failed';
    this.o.onFail?.(reason, wasActive);
    return false;
  }

  play() {
    this.audio?.play().catch((e) => this.fail(e));
  }

  pause() {
    this.audio?.pause();
  }

  seek(t) {
    if (!this.audio) return;
    try {
      this.audio.currentTime = t;
    } catch {
      /* piste pas encore chargée */
    }
  }

  /** Fin de séance : la retombée finit de sonner (si on l'entend), puis tout est libéré. */
  finish() {
    if (this.state !== 'active') return this.destroy();
    if (this.audio.paused || this.audio.muted) return this.destroy();
    this.finishing = true;
    clearTimeout(this.finishTimer);
    this.finishTimer = setTimeout(() => this.destroy(), TAIL_GRACE_MS);
    this.clearMediaSession();
  }

  destroy() {
    if (this.state === 'closed') return;
    this.state = 'closed';
    clearTimeout(this.finishTimer);
    const a = this.audio;
    if (a) {
      for (const [name, fn] of Object.entries(this.handlers)) a.removeEventListener(name, fn);
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
    this.clearMediaSession();
  }

  // ---------- Écran de verrouillage, Bluetooth, voiture ----------

  setupMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const { preset, cycles } = this.o;
    try {
      ms.metadata = new MediaMetadata({
        title: `${preset.name} · ${patternLabel(preset)}`,
        artist: 'Respire',
        album: formatDuration(cycles * (preset.inhale + preset.hold1 + preset.exhale + preset.hold2)),
        artwork: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      });
    } catch {
      /* métadonnées non prises en charge : les commandes marchent quand même */
    }
    const handle = (name, fn) => {
      try {
        ms.setActionHandler(name, fn);
      } catch {
        /* action inconnue sur ce navigateur */
      }
    };
    handle('play', () => this.play());
    handle('pause', () => this.pause());
    handle('stop', () => this.pause()); // jamais de fin brutale depuis une commande à distance
    for (const name of ['seekto', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack']) handle(name, null);
    this.sync();
    this.position();
  }

  sync() {
    try {
      if (navigator.mediaSession && this.state === 'active') navigator.mediaSession.playbackState = this.audio.paused ? 'paused' : 'playing';
    } catch {
      /* état non pris en charge */
    }
  }

  position() {
    const a = this.audio;
    const ms = navigator.mediaSession;
    if (!ms?.setPositionState || !a || !Number.isFinite(a.duration) || this.state !== 'active') return;
    try {
      ms.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: 1 });
    } catch {
      /* position hors limites */
    }
  }

  clearMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    try {
      ms.metadata = null;
      ms.playbackState = 'none';
      for (const name of ['play', 'pause', 'stop']) ms.setActionHandler(name, null);
    } catch {
      /* rien à nettoyer */
    }
  }
}
