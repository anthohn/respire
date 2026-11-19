// Session de respiration plein écran : intro, respiration guidée, pause, fin.
// Sur ordinateur elle continue en arrière-plan et peut passer dans une fenêtre flottante.

import { Sound, vibrate } from './audio.js';
import { phaseAt, breathAt, sessionPlan, patternLabel, cycleLength } from './breath.js';
import { HINTS, PHASE_LABEL, POSTURE } from './content.js';
import { formatClock, formatDuration, MIN_SECONDS } from './stats.js';
import { icon } from './icons.js';
import { orb, esc } from './views.js';
import { isDesktop, pipSupported, openPipWindow } from './pip.js';
import { Aura } from './aura.js';

const INTRO_SECONDS = 4.5;
const SCALE_MIN = 0.56;
const RING_C = 2 * Math.PI * 48.5;
/** Un trou plus long entre deux « tops » = ordinateur en veille ou onglet gelé : ce temps ne compte pas. */
const SLEEP_GAP_MS = 3000;
const chevron = `<span class="cta-ico">${icon.chevronRight(20)}</span>`;
/** Titre standard d'une fenêtre flottante : c'est lui que reconnaissent les extensions qui la gardent au premier plan. */
const PIP_TITLE = 'Picture-in-Picture';

export class Session {
  /**
   * @param {HTMLElement} root
   * @param {{preset:object, minutes:number, sound:boolean, haptics:boolean, pipAuto?:boolean,
   *          onFinish:(r:{seconds:number,cycles:number,completed:boolean})=>void,
   *          onPrefs:(p:{sound:boolean,haptics:boolean})=>void, onNotice?:(m:string)=>void, onExit:()=>void}} opts
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
    this.sound.setMode(opts.soundMode);
    this.sound.setVolume(opts.soundVolume);
    this.mode = 'intro'; // intro | run | paused | done
    this.elapsed = 0;
    this.intro = INTRO_SECONDS;
    this.introEnd = 0;
    this.runStart = 0;
    this.lastStep = 0;
    this.phase = '';
    this.cycleNo = -1;
    this.lastBreath = -1;
    this.shown = {};
    this.wake = null;
    this.raf = 0;
    this.confirming = false;
    this.destroyed = false;
    this.desktop = isDesktop();
    this.canVibrate = typeof navigator.vibrate === 'function'; // Safari sur iPhone ne vibre pas
    this.canPip = pipSupported();
    this.win = window; // fenêtre qui pilote l'animation (celle de l'onglet, ou la fenêtre flottante)
    this.pipWin = null;
    this.pipOpening = false;
    this.pending = null; // écran de fin en attente d'affichage
    this.away = null;
    this.ticker = null;
    this.baseTitle = document.title;
    this.aura = null; // fond WebGL (null = orbe CSS de secours)
    this.auraBreath = 0;
    this.auraKey = '';
    this.target = null;
    this.cur = null;
  }

  // ---------- Cycle de vie ----------

  open() {
    this.root.hidden = false;
    this.root.className = `session${this.desktop ? ' desktop' : ''}`;
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
    this.setupAura();

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
        // Sur téléphone, l'écran verrouillé fige tout : on met en pause. Sur ordinateur, on continue.
        if (this.mode === 'run' && !this.desktop && !this.pipWin) this.pause();
      } else if (this.mode === 'run' || this.mode === 'paused') {
        this.acquireWakeLock();
      }
    };
    this.onPipHide = () => this.leavePip();
    this.root.addEventListener('click', this.onClick);
    document.addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);

    // Doit rester synchrone avec le clic de l'utilisateur pour débloquer l'audio.
    if (this.soundOn) this.sound.unlock();
    this.acquireWakeLock();
    if (this.opts.pipAuto && this.canPip) this.openPip();

    this.paint(0, 0);
    this.setHint(POSTURE[0]);
    requestAnimationFrame(() => this.root.classList.add('open'));
    this.inner.focus({ preventScroll: true });

    const now = performance.now();
    this.introEnd = now + INTRO_SECONDS * 1000;
    this.lastStep = now;
    this.startTicker();
    this.raf = this.win.requestAnimationFrame(this.loop);
  }

  destroy() {
    this.destroyed = true;
    this.pending = null;
    if (this.pipWin) this.leavePip();
    cancelAnimationFrame(this.raf);
    this.win.cancelAnimationFrame(this.raf);
    this.stopTicker();
    this.aura?.destroy();
    this.aura = null;
    this.away?.remove();
    this.root.removeEventListener('click', this.onClick);
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.sound.stop();
    const ctx = this.sound.ctx;
    if (ctx) setTimeout(() => ctx.close().catch(() => {}), 1500);
    try {
      this.wake?.release();
    } catch {
      /* déjà relâché */
    }
    document.title = this.baseTitle;
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
    <canvas class="aura-canvas" aria-hidden="true"></canvas>
    <div class="s-inner" role="dialog" aria-modal="true" aria-label="Session de respiration" tabindex="-1">
      <header class="s-top">
        <button class="icon-btn" data-s="close" aria-label="Quitter la session">${icon.close(22)}</button>
        <p class="s-preset">${esc(p.name)}<span>${patternLabel(p)}</span></p>
        <div class="s-toggles">
          <button class="icon-btn ${this.soundOn ? 'on' : ''}" data-s="sound" aria-pressed="${this.soundOn}" aria-label="Son doux">${this.soundOn ? icon.volume(22) : icon.volumeOff(22)}</button>
          ${this.canVibrate ? `<button class="icon-btn ${this.hapticsOn ? 'on' : ''}" data-s="haptics" aria-pressed="${this.hapticsOn}" aria-label="Vibrations">${icon.vibrate(22)}</button>` : ''}
          ${this.canPip ? `<button class="icon-btn" data-s="pip" aria-pressed="false" aria-label="Fenêtre flottante" title="Fenêtre flottante : continue à respirer pendant que tu travailles">${icon.pip(22)}</button>` : ''}
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

  // ---------- Horloge ----------
  // Le temps se calcule à partir de l'horloge réelle (et non en additionnant des images) :
  // il reste exact même quand le navigateur ralentit un onglet caché.

  loop = () => {
    this.raf = this.win.requestAnimationFrame(this.loop);
    this.step(performance.now());
    this.drawAura();
  };

  /** Métronome indépendant de l'affichage : un onglet caché n'anime plus rien, mais ce « tic » continue. */
  startTicker() {
    try {
      const url = URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 250);'], { type: 'text/javascript' }));
      this.ticker = new Worker(url);
      this.tickerUrl = url;
      this.ticker.onmessage = () => {
        if (document.hidden || this.pipWin) this.step(performance.now());
      };
    } catch {
      this.ticker = null; // sans métronome : l'animation seule pilote la session
    }
  }

  stopTicker() {
    this.ticker?.terminate();
    this.ticker = null;
    if (this.tickerUrl) URL.revokeObjectURL(this.tickerUrl);
    this.tickerUrl = null;
  }

  step(now) {
    // Fenêtre flottante fermée sans prévenir (certains systèmes) : la session revient dans l'onglet.
    if (this.pipWin?.closed) {
      this.leavePip();
      return;
    }
    const gap = now - this.lastStep;
    this.lastStep = now;
    if (this.confirming) {
      if (this.mode === 'intro') this.introEnd += gap; // la confirmation fige aussi l'intro
      return;
    }
    if (gap > SLEEP_GAP_MS) {
      const lost = gap - 250;
      this.introEnd += lost;
      this.runStart += lost;
    }
    if (this.mode === 'intro') this.tickIntro(now);
    else if (this.mode === 'run') this.tickRun(now);
  }

  tickIntro(now) {
    this.intro = (this.introEnd - now) / 1000;
    const step = Math.min(POSTURE.length - 1, Math.floor(((INTRO_SECONDS - this.intro) / INTRO_SECONDS) * POSTURE.length));
    this.setHint(POSTURE[Math.max(0, step)]);
    if (this.intro <= 0) this.startRun();
  }

  startRun() {
    this.mode = 'run';
    this.runStart = performance.now() - this.elapsed * 1000;
    this.root.classList.add('running');
    if (this.soundOn && this.sound.ctx) {
      this.sound.start();
      this.sound.chime('start');
    }
  }

  tickRun(now) {
    this.elapsed = (now - this.runStart) / 1000;
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
    // Le titre de l'onglet suit la session : on la voit même quand l'onglet est caché.
    this.setTitle(`${PHASE_LABEL[p.phase]} · ${formatClock(this.total - t)}`);

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
    if (p.phase === 'inhale') this.aura?.pulse(1);
    else if (p.phase === 'exhale') this.aura?.pulse(-1);
    if (this.soundOn) this.sound.cue(p.phase, p.cycle);
    if (this.hapticsOn) {
      if (p.phase === 'inhale') vibrate(38);
      else if (p.phase === 'exhale') vibrate(22);
    }
  }

  paint(b, t) {
    this.auraBreath = b;
    if (this.aura) return; // l'aura WebGL se dessine à chaque image (drawAura)
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

  // ---------- Aura (WebGL) ----------

  setupAura() {
    const canvas = this.root.querySelector('.aura-canvas');
    const aura = canvas ? Aura.create(canvas, { full: true }) : null;
    if (!aura) {
      canvas?.remove();
      return;
    }
    this.aura = aura;
    aura.onLost = () => this.dropAura();
    this.root.classList.add('webgl');
  }

  /** WebGL perdu (carte graphique réinitialisée) : on revient à l'orbe CSS. */
  dropAura() {
    this.aura?.destroy();
    this.aura = null;
    this.root.classList.remove('webgl');
    this.root.querySelector('.aura-canvas')?.remove();
  }

  /** Repère, dans le canvas, l'élément que la bulle doit habiter (la zone de respiration, puis l'icône de fin). */
  fitAura() {
    const aura = this.aura;
    const canvas = aura.canvas;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    aura.resize(w, h, this.win.devicePixelRatio || 1);
    const el = this.root.querySelector(this.mode === 'done' ? '.done-orb' : '.s-orb-wrap');
    if (!el) return;
    const cr = canvas.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    this.target = { cx: r.left - cr.left + r.width / 2, cy: r.top - cr.top + r.height / 2, W: r.width };
    if (!this.cur) this.cur = { ...this.target };
  }

  drawAura() {
    const aura = this.aura;
    if (!aura || (document.hidden && !this.pipWin)) return;
    const canvas = aura.canvas;
    const done = this.mode === 'done';
    const key = `${canvas.clientWidth}x${canvas.clientHeight}:${done ? 'd' : 'r'}:${this.pipWin ? 'p' : 'm'}`;
    if (key !== this.auraKey) {
      this.auraKey = key;
      this.fitAura();
    }
    if (!this.target) return;
    // La bulle glisse en douceur vers sa nouvelle place (par exemple vers l'icône de fin).
    const k = 0.12;
    this.cur.cx += (this.target.cx - this.cur.cx) * k;
    this.cur.cy += (this.target.cy - this.cur.cy) * k;
    this.cur.W += (this.target.W - this.cur.W) * k;
    const b = done ? 0.55 + 0.18 * Math.sin(performance.now() / 1600) : this.auraBreath;
    const radius = this.cur.W * 0.5 * (done ? 0.8 : 0.52 + 0.4 * b);
    aura.setBubble(this.cur.cx, this.cur.cy, radius);
    aura.draw(b);
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

  setTitle(text) {
    if (this.pipWin) return; // pendant la fenêtre flottante, le titre de la page est réservé (voir enterPip)
    const full = `${text} — Respire`;
    if (this.shown.title === full) return;
    this.shown.title = full;
    document.title = full;
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
      case 'pip': if (this.pipWin) this.leavePip(); else this.openPip(); break;
      case 'pip-return': this.leavePip(); break;
      case 'pip-focus':
        if (!this.pipWin || this.pipWin.closed) {
          this.leavePip();
          this.opts.onNotice?.('La fenêtre flottante avait été fermée : la session est revenue ici.');
          break;
        }
        try {
          this.pipWin.focus();
        } catch {
          /* le navigateur refuse : « Ramener ici » reste possible */
        }
        this.opts.onNotice?.('Fenêtre flottante demandée au premier plan. Si elle reste cachée, utilise « Ramener ici ».');
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
        this.opts.onNotice?.(`Le son n’a pas pu démarrer sur cet appareil (${this.sound.lastError || 'raison inconnue'}).`);
      } else {
        if (this.mode === 'run') this.sound.start();
        const iphone = /iphone|ipad|ipod/i.test(navigator.userAgent);
        this.opts.onNotice?.(iphone ? 'Son activé. Rien d’audible ? Vérifie l’interrupteur silencieux de l’iPhone.' : 'Son activé');
      }
    } else {
      this.sound.stop();
      this.opts.onNotice?.('Son coupé');
    }
    this.opts.onPrefs({ sound: this.soundOn, haptics: this.hapticsOn });
  }

  syncToggles() {
    const snd = this.root.querySelector('[data-s="sound"]');
    const hap = this.root.querySelector('[data-s="haptics"]');
    snd.classList.toggle('on', this.soundOn);
    snd.setAttribute('aria-pressed', String(this.soundOn));
    snd.innerHTML = this.soundOn ? icon.volume(22) : icon.volumeOff(22);
    if (hap) {
      hap.classList.toggle('on', this.hapticsOn);
      hap.setAttribute('aria-pressed', String(this.hapticsOn));
    }
  }

  pause() {
    if (this.mode !== 'run') return;
    this.elapsed = Math.min(this.total, (performance.now() - this.runStart) / 1000);
    this.mode = 'paused';
    this.root.classList.add('paused');
    this.sound.stop();
    const btn = this.inner.querySelector('[data-el="toggle"]');
    btn.innerHTML = icon.play(26);
    btn.setAttribute('aria-label', 'Reprendre');
    this.inner.querySelector('[data-el="phase"]').textContent = 'En pause';
    this.setTitle('En pause');
    this.shown.hint = '';
    this.setHint('Touche l’écran pour reprendre');
  }

  resume() {
    if (this.mode !== 'paused') return;
    this.mode = 'run';
    this.runStart = performance.now() - this.elapsed * 1000;
    this.lastStep = performance.now();
    this.root.classList.remove('paused');
    this.phase = ''; // force le réaffichage de la phase courante
    const btn = this.inner.querySelector('[data-el="toggle"]');
    btn.innerHTML = icon.pause(26);
    btn.setAttribute('aria-label', 'Pause');
    if (this.soundOn && this.sound.ctx) {
      this.sound.unlock().then(() => {
        if (this.mode === 'run') this.sound.start();
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
    this.lastStep = performance.now();
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
    this.end(true);
    this.shown.title = '';
    if (!this.pipWin) document.title = 'Session terminée — Respire';
    if (this.hapticsOn) vibrate([50, 90, 50]);
    this.opts.onFinish({ seconds: this.total, cycles: this.cycles, completed: true });
  }

  end(withChime = false) {
    this.mode = 'done';
    this.stopTicker();
    if (withChime && this.soundOn && this.sound.g) {
      // Repère de fin : on laisse le son se terminer avant de tout éteindre.
      this.sound.chime('end');
      this.sound.stop(this.sound.ctx.currentTime + 4.5);
    } else {
      this.sound.stop();
    }
    try {
      this.wake?.release();
    } catch {
      /* déjà relâché */
    }
  }

  // ---------- Fenêtre flottante ----------

  /** Ouvre la session dans une petite fenêtre toujours visible. À appeler depuis un clic. */
  async openPip() {
    if (!this.canPip || this.pipWin || this.pipOpening || this.mode === 'done') return;
    this.pipOpening = true;
    try {
      const pw = await openPipWindow();
      if (this.destroyed || this.mode === 'done') {
        pw.close();
        return;
      }
      this.enterPip(pw);
    } catch {
      this.opts.onNotice?.('La fenêtre flottante n’a pas pu s’ouvrir.');
    } finally {
      this.pipOpening = false;
    }
  }

  enterPip(pw) {
    this.pipWin = pw;
    this.homeParent = this.root.parentNode;
    this.homeNext = this.root.nextSibling;
    pw.document.body.append(this.root);
    this.root.classList.add('pip');
    document.body.classList.remove('in-session');
    // Le navigateur donne à la fenêtre flottante le titre de la page qui l'a ouverte.
    document.title = PIP_TITLE;
    this.showAway();

    // L'animation suit la fenêtre flottante : celle de l'onglet est mise en veille quand il est caché.
    this.win.cancelAnimationFrame(this.raf);
    this.win = pw;
    this.raf = pw.requestAnimationFrame(this.loop);
    pw.addEventListener('keydown', this.onKey);
    pw.addEventListener('pagehide', this.onPipHide);
    this.syncPipButton();
  }

  /** Ramène la session dans l'onglet (et ferme la fenêtre flottante). */
  leavePip() {
    const pw = this.pipWin;
    if (!pw) return;
    this.pipWin = null;
    try {
      pw.cancelAnimationFrame(this.raf);
    } catch {
      /* fenêtre déjà fermée */
    }
    pw.removeEventListener('keydown', this.onKey);
    pw.removeEventListener('pagehide', this.onPipHide);

    const next = this.homeNext && this.homeNext.parentNode === this.homeParent ? this.homeNext : null;
    this.homeParent.insertBefore(this.root, next);
    this.root.classList.remove('pip');
    document.body.classList.add('in-session');
    this.away?.remove();
    this.away = null;
    this.shown.title = '';
    document.title = this.mode === 'done' ? 'Session terminée — Respire' : this.baseTitle;

    this.win = window;
    this.raf = window.requestAnimationFrame(this.loop);
    try {
      pw.close();
    } catch {
      /* déjà fermée */
    }
    this.syncPipButton();
    if (this.pending) this.renderPending();
  }

  syncPipButton() {
    const btn = this.root.querySelector('[data-s="pip"]');
    if (!btn) return;
    btn.classList.toggle('on', !!this.pipWin);
    btn.setAttribute('aria-pressed', String(!!this.pipWin));
    btn.setAttribute('aria-label', this.pipWin ? 'Ramener la session ici' : 'Fenêtre flottante');
  }

  /** Dans l'onglet, un écran d'attente remplace la session pendant qu'elle est dans la fenêtre flottante. */
  showAway() {
    const el = document.createElement('div');
    el.className = 'session-away';
    el.innerHTML = `
      <div class="away-card">
        <div class="away-orb">${orb('idle')}</div>
        <h2>Ta session continue dans la fenêtre flottante</h2>
        <p>Tu ne la vois plus ? Selon ton système, elle peut passer derrière une autre fenêtre : la session, elle, continue.</p>
        <button class="cta" data-s="pip-return">Ramener ici${chevron}</button>
        <button class="link-btn" data-s="pip-focus">Retrouver la fenêtre</button>
      </div>`;
    el.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-s]');
      if (btn) this.act(btn.dataset.s);
    });
    document.body.append(el);
    this.away = el;
  }

  // ---------- Écran de fin ----------

  /**
   * Affiche l'écran de fin (fourni par l'application). Si la session est dans la fenêtre flottante,
   * on y montre un message court et on garde l'écran complet pour le retour dans l'onglet.
   */
  showDone(html, after) {
    this.pending = { html, after };
    if (this.pipWin) this.renderPipDone();
    else this.renderPending();
  }

  renderPipDone() {
    this.root.classList.remove('running', 'paused');
    this.root.classList.add('done');
    this.inner.innerHTML = `
      <div class="pip-done">
        <div class="done-orb" aria-hidden="true">${orb('done')}<span class="done-check">${icon.check(40)}</span></div>
        <h2>Session terminée</h2>
        <p class="muted">${formatDuration(this.elapsed)} de respiration</p>
        <button class="cta" data-s="pip-return">Voir mon résultat${chevron}</button>
      </div>`;
  }

  renderPending() {
    const { html, after } = this.pending;
    this.pending = null;
    this.root.classList.remove('running', 'paused');
    this.root.classList.add('done');
    this.inner.setAttribute('aria-label', 'Session terminée');
    this.inner.innerHTML = html;
    this.inner.focus({ preventScroll: true });
    after?.();
  }

  async acquireWakeLock() {
    try {
      if ('wakeLock' in navigator && !document.hidden) this.wake = await navigator.wakeLock.request('screen');
    } catch {
      /* non disponible : l'écran pourra se mettre en veille */
    }
  }
}
