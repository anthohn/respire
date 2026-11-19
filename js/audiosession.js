// Session audio : on se laisse guider à l'oreille, écran éteint si on veut.
//
// La séance entière est une piste audio (voir track.js) lue par un élément <audio>. Le téléphone la joue comme un
// podcast : elle continue écran verrouillé, passe par les écouteurs ou le Bluetooth de la voiture, et se commande
// depuis l'écran de verrouillage. Le temps de la séance, c'est la position de lecture : il reste juste même si
// l'écran se verrouille, si un appel interrompt la lecture ou si l'application passe en arrière-plan.

import { phaseAt, breathAt, patternLabel, cycleLength } from './breath.js';
import { PHASE_LABEL } from './content.js';
import { formatClock, formatDuration, MIN_SECONDS } from './stats.js';
import { icon } from './icons.js';
import { orb, esc } from './views.js';
import { renderTrack, wavBlob, trackPlan, TRACK_RATE } from './track.js';

const SCALE_MIN = 0.56;

export class AudioSession {
  /**
   * @param {HTMLElement} root
   * @param {{preset:object, minutes:number, audioStyle:string, onNotice?:(m:string)=>void,
   *          onFinish:(r:{seconds:number,cycles:number,completed:boolean})=>void, onExit:()=>void}} opts
   */
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.preset = opts.preset;
    this.plan = trackPlan(opts.preset, opts.minutes);
    this.mode = 'prep'; // prep (fabrication de la piste) | play | paused | done
    this.audio = null;
    this.urls = [];
    this.raf = 0;
    this.shown = {};
    this.confirming = false;
    this.destroyed = false;
    this.pending = null;
  }

  // ---------- Cycle de vie ----------

  open() {
    this.root.hidden = false;
    this.root.className = 'session audio';
    this.root.innerHTML = this.template();
    document.body.classList.add('in-session');
    this.inner = this.root.querySelector('.s-inner');
    this.orbEl = this.root.querySelector('.orb');
    this.warmEl = this.root.querySelector('.orb-warm');
    this.haloEl = this.root.querySelector('.orb-halo');
    this.ripples = [...this.root.querySelectorAll('.orb-ripple')];

    this.onClick = (e) => {
      const el = e.target.closest('[data-s]');
      if (el) this.act(el.dataset.s);
    };
    this.onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.confirming) this.act('resume');
        else this.requestClose();
      } else if (e.key === ' ' && !e.target.closest('button, a, input')) {
        e.preventDefault();
        this.act('toggle');
      }
    };
    this.root.addEventListener('click', this.onClick);
    document.addEventListener('keydown', this.onKey);

    // Pendant l'appui : on crée l'élément audio et on le débloque avec un instant de silence
    // (iOS n'autorise la lecture qu'après un geste, élément par élément). La piste arrive juste après.
    const a = (this.audio = new Audio());
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    a.src = this.url(wavBlob(new Int16Array(TRACK_RATE / 10)));
    this.unlocked = a.play().then(
      () => {
        a.pause();
        return null;
      },
      (e) => e,
    );

    requestAnimationFrame(() => this.root.classList.add('open'));
    this.inner.focus({ preventScroll: true });
    this.loop = () => {
      this.raf = requestAnimationFrame(this.loop);
      if (!document.hidden) this.paint();
    };
    this.loop();
    this.prepare();
  }

  url(blob) {
    const u = URL.createObjectURL(blob);
    this.urls.push(u);
    return u;
  }

  async prepare() {
    const { pcm, rate } = await renderTrack({ preset: this.preset, cycles: this.plan.cycles, style: this.opts.audioStyle });
    if (this.destroyed) return;
    const refused = await this.unlocked;
    if (this.destroyed) return;
    if (refused) return this.fail(refused);
    const a = this.audio;
    a.src = this.url(wavBlob(pcm, rate));
    this.bind();
    try {
      await a.play();
    } catch (e) {
      return this.fail(e);
    }
    if (this.destroyed) return;
    this.mode = 'play';
    this.syncButton();
    this.setupMediaSession();
  }

  bind() {
    const a = this.audio;
    this.on = {
      ended: () => this.complete(),
      pause: () => {
        // L'utilisateur, l'écran de verrouillage, un appel ou le Bluetooth qui se coupe : dans tous les cas, on est en pause.
        if (this.mode !== 'play' || a.ended) return;
        this.mode = 'paused';
        this.syncButton();
      },
      play: () => {
        if (this.mode !== 'paused') return;
        if (this.confirming) this.hideConfirm();
        this.mode = 'play';
        this.syncButton();
      },
      timeupdate: () => this.updatePosition(),
      error: () => this.fail(a.error ? { name: `erreur ${a.error.code}` } : null),
    };
    for (const [name, fn] of Object.entries(this.on)) a.addEventListener(name, fn);
  }

  fail(e) {
    if (this.destroyed || this.mode === 'done') return;
    this.opts.onNotice?.(`Le son n’a pas pu démarrer (${e?.name || 'lecture impossible'}).`);
    this.destroy();
  }

  destroy() {
    this.destroyed = true;
    this.pending = null;
    cancelAnimationFrame(this.raf);
    this.root.removeEventListener('click', this.onClick);
    document.removeEventListener('keydown', this.onKey);
    const a = this.audio;
    if (a) {
      for (const [name, fn] of Object.entries(this.on || {})) a.removeEventListener(name, fn);
      a.pause();
      a.removeAttribute('src');
      a.load();
    }
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
    this.clearMediaSession();
    document.body.classList.remove('in-session');
    this.root.classList.remove('open');
    this.root.hidden = true;
    this.root.innerHTML = '';
    this.opts.onExit();
  }

  // ---------- Écran de verrouillage, Bluetooth, voiture ----------

  setupMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const p = this.preset;
    try {
      ms.metadata = new MediaMetadata({
        title: `${p.name} · ${patternLabel(p)}`,
        artist: 'Respire',
        album: formatDuration(this.plan.breath),
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
    handle('pause', () => this.audio?.pause());
    handle('stop', () => this.audio?.pause()); // jamais de fin brutale depuis une commande à distance
    for (const name of ['seekto', 'seekbackward', 'seekforward', 'previoustrack', 'nexttrack']) handle(name, null);
    ms.playbackState = 'playing';
    this.updatePosition();
  }

  updatePosition() {
    const a = this.audio;
    const ms = navigator.mediaSession;
    if (!ms?.setPositionState || !a || !Number.isFinite(a.duration)) return;
    try {
      ms.setPositionState({ duration: a.duration, position: Math.min(a.currentTime, a.duration), playbackRate: 1 });
    } catch {
      /* position hors limites pendant un changement de piste */
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

  // ---------- Lecture ----------

  play() {
    this.audio?.play().catch((e) => this.fail(e));
  }

  toggle() {
    if (this.mode === 'play') this.audio.pause();
    else if (this.mode === 'paused') this.play();
  }

  /** Secondes de respiration écoulées (la position de lecture, moins l'installation). */
  elapsed() {
    if (!this.audio || this.mode === 'prep') return 0;
    return Math.max(0, Math.min(this.plan.breath, this.audio.currentTime - this.plan.lead));
  }

  act(name) {
    switch (name) {
      case 'toggle': this.toggle(); break;
      case 'close': this.requestClose(); break;
      case 'resume': this.hideConfirm(); if (this.mode === 'paused') this.play(); break;
      case 'save': this.finishEarly(); break;
      case 'discard': this.destroy(); break;
      default: break;
    }
  }

  requestClose() {
    if (this.mode === 'done') return;
    if (this.mode === 'play') this.audio.pause();
    const box = this.inner.querySelector('[data-el="confirm"]');
    const elapsed = this.elapsed();
    box.innerHTML = elapsed >= MIN_SECONDS
      ? `<div class="confirm-card">
           <h3>Terminer maintenant ?</h3>
           <p>Tu as respiré ${formatDuration(elapsed)}. Cette session peut être enregistrée.</p>
           <button class="cta" data-s="save">Enregistrer et terminer</button>
           <button class="btn ghost wide" data-s="resume">Reprendre</button>
           <button class="link-btn" data-s="discard">Quitter sans enregistrer</button>
         </div>`
      : `<div class="confirm-card">
           <h3>Quitter la session ?</h3>
           <p>Moins d’une minute ne compte pas dans ta série. Encore un petit effort, ça vaut le coup.</p>
           <button class="cta" data-s="resume">Reprendre</button>
           <button class="link-btn" data-s="discard">Quitter</button>
         </div>`;
    box.hidden = false;
    this.confirming = true;
    box.querySelector('button').focus({ preventScroll: true });
  }

  hideConfirm() {
    const box = this.inner.querySelector('[data-el="confirm"]');
    box.hidden = true;
    box.innerHTML = '';
    this.confirming = false;
  }

  finishEarly() {
    const elapsed = this.elapsed();
    this.hideConfirm();
    this.end();
    this.opts.onFinish({ seconds: Math.floor(elapsed), cycles: Math.floor(elapsed / cycleLength(this.preset)), completed: false });
  }

  complete() {
    if (this.mode === 'done') return;
    this.end();
    this.opts.onFinish({ seconds: Math.round(this.plan.breath), cycles: this.plan.cycles, completed: true });
  }

  end() {
    this.mode = 'done';
    this.audio?.pause();
    this.clearMediaSession();
  }

  showDone(html, after) {
    this.pending = { html, after };
    this.root.classList.remove('running', 'paused');
    this.root.classList.add('done');
    this.inner.setAttribute('aria-label', 'Session terminée');
    this.inner.innerHTML = html;
    this.inner.focus({ preventScroll: true });
    this.pending = null;
    after?.();
  }

  // ---------- Affichage ----------

  template() {
    const p = this.preset;
    return `
    <div class="s-bg" aria-hidden="true"></div>
    <div class="s-inner" role="dialog" aria-modal="true" aria-label="Session audio" tabindex="-1">
      <header class="s-top">
        <button class="icon-btn" data-s="close" aria-label="Quitter la session">${icon.close(22)}</button>
        <p class="s-preset">${esc(p.name)}<span>${patternLabel(p)}</span></p>
        <span class="icon-btn a-ghost" aria-hidden="true">${icon.headphones(22)}</span>
      </header>

      <div class="s-stage" data-s="toggle">
        <div class="s-orb-wrap">
          ${orb('live')}
          <div class="s-center">
            <div class="s-phase swap" data-el="phase">Préparation…</div>
            <div class="s-count" data-el="count"></div>
          </div>
        </div>
      </div>

      <p class="s-hint" data-el="hint">Tu peux verrouiller ton téléphone : la session continue.</p>

      <footer class="s-bottom">
        <div class="s-time">
          <span class="s-remaining" data-el="remaining">${formatClock(this.plan.breath)}</span>
          <span class="s-cycles" data-el="cycles">${this.plan.cycles} respirations</span>
        </div>
        <button class="round-btn" data-s="toggle" data-el="toggle" aria-label="Pause">${icon.pause(26)}</button>
      </footer>

      <div class="s-confirm" data-el="confirm" hidden></div>
    </div>`;
  }

  text(name, value) {
    const v = String(value);
    if (this.shown[name] === v) return;
    this.shown[name] = v;
    const el = this.inner.querySelector(`[data-el="${name}"]`);
    if (!el) return;
    el.textContent = v;
    if (name === 'phase') {
      el.classList.remove('swap');
      void el.offsetWidth;
      el.classList.add('swap');
    }
  }

  syncButton() {
    const playing = this.mode === 'play';
    this.root.classList.toggle('running', playing);
    this.root.classList.toggle('paused', this.mode === 'paused');
    const btn = this.inner.querySelector('[data-el="toggle"]');
    btn.innerHTML = playing ? icon.pause(26) : icon.play(26);
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Reprendre');
    try {
      if (navigator.mediaSession) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    } catch {
      /* état non pris en charge */
    }
  }

  /** À chaque image quand l'écran est allumé : tout se déduit de la position de lecture. */
  paint() {
    if (this.mode === 'done') return;
    const t = this.mode === 'prep' ? -this.plan.lead : this.audio.currentTime - this.plan.lead;
    let label = 'Prépare-toi';
    let count = '';
    let breath = 0;
    if (this.mode === 'prep') label = 'Préparation…';
    else if (t >= this.plan.breath) label = 'Relâche';
    else if (t >= 0) {
      const p = phaseAt(this.preset, t);
      label = PHASE_LABEL[p.phase];
      count = Math.max(1, Math.ceil(p.phaseDur - p.phaseT - 1e-6));
      breath = p.breath;
    }
    this.text('phase', label);
    this.text('count', count);
    const run = Math.max(0, Math.min(this.plan.breath, t));
    this.text('remaining', formatClock(this.plan.breath - run));
    if (t >= 0 && t < this.plan.breath) this.text('cycles', `Respiration ${Math.min(Math.floor(run / this.plan.len) + 1, this.plan.cycles)} sur ${this.plan.cycles}`);
    this.paintOrb(breath, run);
  }

  paintOrb(b, t) {
    const s = SCALE_MIN + (1 - SCALE_MIN) * b;
    this.orbEl.style.transform = `scale(${s.toFixed(4)})`;
    this.warmEl.style.opacity = b.toFixed(3);
    this.haloEl.style.transform = `scale(${(0.78 + 0.5 * b).toFixed(3)})`;
    this.haloEl.style.opacity = (0.35 + 0.65 * b).toFixed(3);
    this.ripples.forEach((el, i) => {
      const bi = breathAt(this.preset, t - (i + 1) * 0.6);
      el.style.transform = `scale(${(SCALE_MIN + (1 - SCALE_MIN) * bi + 0.05 * (i + 1)).toFixed(4)})`;
      el.style.opacity = (0.5 * bi * (1 - i * 0.28)).toFixed(3);
    });
  }
}
