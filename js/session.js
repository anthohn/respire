// Session de respiration plein écran : intro, respiration guidée, pause, fin.

import { Sound, vibrate } from './audio.js';
import { phaseAt, breathAt, sessionPlan, patternLabel, cycleLength } from './breath.js';
import { HINTS, PHASE_LABEL, POSTURE } from './content.js';
import { formatClock, formatDuration, MIN_SECONDS } from './stats.js';
import { icon } from './icons.js';
import { orb, esc } from './views.js';

const INTRO_SECONDS = 4.5;
const SCALE_MIN = 0.56;
const RING_C = 2 * Math.PI * 48.5;

export class Session {
  /**
   * @param {HTMLElement} root
   * @param {{preset:object, minutes:number, sound:boolean, haptics:boolean,
   *          onFinish:(r:{seconds:number,cycles:number,completed:boolean})=>void,
   *          onPrefs:(p:{sound:boolean,haptics:boolean})=>void, onExit:()=>void}} opts
   */
  constructor(root, opts) {
    this.root = root;
    this.opts = opts;
    this.preset = opts.preset;
    const plan = sessionPlan(this.preset, opts.minutes);
    this.total = plan.totalSeconds;
    this.cycles = plan.cycles;
    this.soundOn = opts.sound;
    this.hapticsOn = opts.haptics;
    this.sound = new Sound();
    this.mode = 'intro'; // intro | run | paused | done
    this.elapsed = 0;
    this.intro = INTRO_SECONDS;
    this.phase = '';
    this.cycleNo = -1;
    this.lastBreath = -1;
    this.shown = {};
    this.wake = null;
    this.raf = 0;
    this.confirming = false;
  }

  // ---------- Cycle de vie ----------

  open() {
    this.root.hidden = false;
    this.root.className = 'session';
    this.root.innerHTML = this.template();
    document.body.classList.add('in-session');

    this.inner = this.root.querySelector('.s-inner');
    this.orbEl = this.root.querySelector('.orb');
    this.warmEl = this.root.querySelector('.orb-warm');
    this.haloEl = this.root.querySelector('.orb-halo');
    this.ripples = [...this.root.querySelectorAll('.orb-ripple')];
    this.ringBar = this.root.querySelector('.s-ring .bar');
    this.ringBar.style.strokeDasharray = RING_C.toFixed(2);
    this.ringBar.style.strokeDashoffset = RING_C.toFixed(2);

    this.onClick = (e) => {
      const el = e.target.closest('[data-s]');
      if (el) this.act(el.dataset.s);
    };
    this.onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (this.confirmOpen) this.act('resume');
        else this.requestClose();
      } else if (e.key === ' ' && !e.target.closest('button, a, input')) {
        e.preventDefault();
        this.act('toggle');
      }
    };
    this.onVisibility = () => {
      if (document.hidden) {
        if (this.mode === 'run') this.pause();
      } else if (this.mode === 'run' || this.mode === 'paused') {
        this.acquireWakeLock();
      }
    };
    this.root.addEventListener('click', this.onClick);
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);

    // Doit rester synchrone avec le clic de l'utilisateur pour débloquer l'audio.
    if (this.soundOn) this.sound.unlock();
    this.acquireWakeLock();

    this.paint(0, 0);
    this.setHint(POSTURE[0]);
    requestAnimationFrame(() => this.root.classList.add('open'));
    this.inner.focus({ preventScroll: true });

    this.last = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.root.removeEventListener('click', this.onClick);
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.sound.stopPad();
    const ctx = this.sound.ctx;
    if (ctx) setTimeout(() => ctx.close().catch(() => {}), 1500);
    try {
      this.wake?.release();
    } catch {
      /* déjà relâché */
    }
    document.body.classList.remove('in-session');
    this.root.classList.remove('open');
    this.root.hidden = true;
    this.root.innerHTML = '';
    this.opts.onExit();
  }

  template() {
    const p = this.opts.preset;
    return `
    <div class="s-bg" aria-hidden="true"></div>
    <div class="s-inner" role="dialog" aria-modal="true" aria-label="Session de respiration" tabindex="-1">
      <header class="s-top">
        <button class="icon-btn" data-s="close" aria-label="Quitter la session">${icon.close(22)}</button>
        <p class="s-preset">${esc(p.name)}<span>${patternLabel(p)}</span></p>
        <div class="s-toggles">
          <button class="icon-btn ${this.soundOn ? 'on' : ''}" data-s="sound" aria-pressed="${this.soundOn}" aria-label="Son doux">${this.soundOn ? icon.volume(22) : icon.volumeOff(22)}</button>
          <button class="icon-btn ${this.hapticsOn ? 'on' : ''}" data-s="haptics" aria-pressed="${this.hapticsOn}" aria-label="Vibrations">${icon.vibrate(22)}</button>
        </div>
      </header>

      <div class="s-stage" data-s="toggle">
        <div class="s-orb-wrap">
          ${orb('live')}
          <svg class="s-ring" viewBox="0 0 100 100" aria-hidden="true">
            <circle class="track" cx="50" cy="50" r="48.5"/>
            <circle class="bar" cx="50" cy="50" r="48.5" transform="rotate(-90 50 50)"/>
          </svg>
          <div class="s-center">
            <div class="s-phase swap" data-el="phase">Prépare-toi</div>
            <div class="s-count" data-el="count"></div>
          </div>
        </div>
      </div>

      <p class="s-hint" data-el="hint" aria-live="off"></p>

      <footer class="s-bottom">
        <div class="s-time">
          <span class="s-remaining" data-el="remaining">${formatClock(this.total)}</span>
          <span class="s-cycles" data-el="cycles">${this.cycles} respirations</span>
        </div>
        <button class="round-btn" data-s="toggle" data-el="toggle" aria-label="Pause">${icon.pause(26)}</button>
      </footer>

      <div class="s-confirm" data-el="confirm" hidden></div>
    </div>`;
  }

  // ---------- Boucle ----------

  loop = (now) => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.25, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    if (this.confirming) return;
    if (this.mode === 'intro') this.tickIntro(dt);
    else if (this.mode === 'run') this.tickRun(dt);
  };

  tickIntro(dt) {
    this.intro -= dt;
    const step = Math.min(POSTURE.length - 1, Math.floor(((INTRO_SECONDS - this.intro) / INTRO_SECONDS) * POSTURE.length));
    this.setHint(POSTURE[step]);
    if (this.intro <= 0) this.startRun();
  }

  startRun() {
    this.mode = 'run';
    this.root.classList.add('running');
    if (this.soundOn && this.sound.ctx) {
      this.sound.startPad();
      this.sound.chime(392, 0.08);
    }
  }

  tickRun(dt) {
    this.elapsed += dt;
    if (this.elapsed >= this.total) {
      this.complete();
      return;
    }
    this.render(this.elapsed);
  }

  render(t) {
    const p = phaseAt(this.preset, t);
    this.paint(p.breath, t);

    if (p.phase !== this.phase || p.cycle !== this.cycleNo) this.onPhase(p);

    const left = Math.max(1, Math.ceil(p.phaseDur - p.phaseT - 1e-6));
    this.text('count', left);
    this.text('remaining', formatClock(this.total - t));
    this.text('cycles', `Respiration ${Math.min(p.cycle + 1, this.cycles)} sur ${this.cycles}`);
    this.ringBar.style.strokeDashoffset = (RING_C * (1 - t / this.total)).toFixed(2);

    if (this.soundOn && Math.abs(p.breath - this.lastBreath) > 0.008) {
      this.sound.update(p.breath);
      this.lastBreath = p.breath;
    }
  }

  onPhase(p) {
    this.phase = p.phase;
    this.cycleNo = p.cycle;
    this.root.dataset.phase = p.phase;
    const label = this.inner.querySelector('[data-el="phase"]');
    label.textContent = PHASE_LABEL[p.phase];
    label.classList.remove('swap');
    void label.offsetWidth; // relance l'animation
    label.classList.add('swap');
    const hints = HINTS[p.phase];
    this.setHint(hints[p.cycle % hints.length]);
    if (this.hapticsOn) {
      if (p.phase === 'inhale') vibrate(38);
      else if (p.phase === 'exhale') vibrate(22);
    }
  }

  paint(b, t) {
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

  /** Met à jour le texte d'un élément seulement s'il change (évite du travail à chaque image). */
  text(name, value) {
    const v = String(value);
    if (this.shown[name] === v) return;
    this.shown[name] = v;
    const el = this.inner.querySelector(`[data-el="${name}"]`);
    if (el) el.textContent = v;
  }

  setHint(value) {
    if (this.shown.hint === value) return;
    this.shown.hint = value;
    const el = this.inner.querySelector('[data-el="hint"]');
    if (!el) return;
    el.textContent = value;
    el.classList.remove('swap');
    void el.offsetWidth;
    el.classList.add('swap');
  }

  // ---------- Actions ----------

  act(name) {
    switch (name) {
      case 'toggle':
        if (this.mode === 'intro') this.startRun();
        else if (this.mode === 'run') this.pause();
        else if (this.mode === 'paused' && !this.confirmOpen) this.resume();
        break;
      case 'close': this.requestClose(); break;
      case 'resume': this.hideConfirm(); this.resume(); break;
      case 'save': this.finishEarly(); break;
      case 'discard': this.destroy(); break;
      case 'sound': this.toggleSound(); break;
      case 'haptics':
        this.hapticsOn = !this.hapticsOn;
        this.syncToggles();
        if (this.hapticsOn) vibrate(30);
        this.opts.onPrefs({ sound: this.soundOn, haptics: this.hapticsOn });
        break;
      default:
    }
  }

  async toggleSound() {
    this.soundOn = !this.soundOn;
    this.syncToggles();
    if (this.soundOn) {
      const ok = await this.sound.unlock();
      if (!ok) {
        this.soundOn = false;
        this.syncToggles();
      } else if (this.mode === 'run') {
        this.sound.startPad();
      }
    } else {
      this.sound.stopPad();
    }
    this.opts.onPrefs({ sound: this.soundOn, haptics: this.hapticsOn });
  }

  syncToggles() {
    const [snd, hap] = this.root.querySelectorAll('.s-toggles .icon-btn');
    snd.classList.toggle('on', this.soundOn);
    snd.setAttribute('aria-pressed', String(this.soundOn));
    snd.innerHTML = this.soundOn ? icon.volume(22) : icon.volumeOff(22);
    hap.classList.toggle('on', this.hapticsOn);
    hap.setAttribute('aria-pressed', String(this.hapticsOn));
  }

  pause() {
    if (this.mode !== 'run') return;
    this.mode = 'paused';
    this.root.classList.add('paused');
    this.sound.stopPad();
    const btn = this.inner.querySelector('[data-el="toggle"]');
    btn.innerHTML = icon.play(26);
    btn.setAttribute('aria-label', 'Reprendre');
    this.inner.querySelector('[data-el="phase"]').textContent = 'En pause';
    this.shown.hint = '';
    this.setHint('Touche l’écran pour reprendre');
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.mode = 'run';
    this.root.classList.remove('paused');
    this.phase = ''; // force le réaffichage de la phase courante
    const btn = this.inner.querySelector('[data-el="toggle"]');
    btn.innerHTML = icon.pause(26);
    btn.setAttribute('aria-label', 'Pause');
    if (this.soundOn && this.sound.ctx) {
      this.sound.unlock().then(() => {
        if (this.mode === 'run') this.sound.startPad();
      });
    }
  }

  get confirmOpen() {
    return this.confirming;
  }

  requestClose() {
    if (this.mode === 'done') return;
    if (this.mode === 'run') this.pause();
    const box = this.inner.querySelector('[data-el="confirm"]');
    const enough = this.elapsed >= MIN_SECONDS;
    box.innerHTML = enough
      ? `<div class="confirm-card">
           <h3>Terminer maintenant ?</h3>
           <p>Tu as respiré ${formatDuration(this.elapsed)}. Cette session peut être enregistrée.</p>
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
    const seconds = Math.floor(this.elapsed);
    const cycles = Math.floor(this.elapsed / cycleLength(this.preset));
    this.hideConfirm();
    this.end();
    this.opts.onFinish({ seconds, cycles, completed: false });
  }

  complete() {
    this.elapsed = this.total;
    this.paint(0, this.total);
    this.ringBar.style.strokeDashoffset = '0';
    this.end();
    if (this.soundOn && this.sound.ctx) this.sound.chime(523.25, 0.13);
    if (this.hapticsOn) vibrate([50, 90, 50]);
    this.opts.onFinish({ seconds: this.total, cycles: this.cycles, completed: true });
  }

  end() {
    this.mode = 'done';
    cancelAnimationFrame(this.raf);
    this.sound.stopPad();
    try {
      this.wake?.release();
    } catch {
      /* déjà relâché */
    }
  }

  /** Remplace le contenu par l'écran de fin (fourni par l'application). */
  showDone(html) {
    this.root.classList.remove('running', 'paused');
    this.root.classList.add('done');
    this.inner.removeAttribute('aria-label');
    this.inner.setAttribute('aria-label', 'Session terminée');
    this.inner.innerHTML = html;
    this.inner.focus({ preventScroll: true });
  }

  async acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && !document.hidden) this.wake = await navigator.wakeLock.request('screen');
    } catch {
      /* non disponible : l'écran pourra se mettre en veille */
    }
  }
}
