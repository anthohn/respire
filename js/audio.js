// Ambiance sonore générée en direct (aucun fichier audio) :
// une note douce qui monte à l'inspiration et redescend à l'expiration, plus un petit carillon.

export class Sound {
  constructor() {
    this.ctx = null;
    this.nodes = null;
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

  startPad() {
    if (!this.ctx || this.nodes) return;
    const ctx = this.ctx;
    const master = ctx.createGain();
    master.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.4;

    const low = ctx.createOscillator();
    low.type = 'sine';
    const fifth = ctx.createOscillator();
    fifth.type = 'sine';
    const fifthGain = ctx.createGain();
    fifthGain.gain.value = 0.35;
    const shimmer = ctx.createOscillator();
    shimmer.type = 'triangle';
    const shimmerGain = ctx.createGain();
    shimmerGain.gain.value = 0.12;

    low.connect(filter);
    fifth.connect(fifthGain).connect(filter);
    shimmer.connect(shimmerGain).connect(filter);
    filter.connect(master).connect(ctx.destination);
    [low, fifth, shimmer].forEach((o) => o.start());

    this.nodes = { master, filter, low, fifth, shimmer };
    this.update(0, true);
  }

  /** `breath` : 0 = poumons vides, 1 = poumons pleins. */
  update(breath, instant = false) {
    if (!this.nodes) return;
    const { master, filter, low, fifth, shimmer } = this.nodes;
    const now = this.ctx.currentTime;
    const tc = instant ? 0.01 : 0.18;
    const base = 130.81 + breath * 65.4; // do grave → sol
    low.frequency.setTargetAtTime(base, now, tc);
    fifth.frequency.setTargetAtTime(base * 1.5, now, tc);
    shimmer.frequency.setTargetAtTime(base * 2, now, tc);
    filter.frequency.setTargetAtTime(380 + breath * 900, now, tc);
    master.gain.setTargetAtTime(0.025 + breath * 0.07, now, tc);
  }

  stopPad() {
    if (!this.nodes) return;
    const { master, low, fifth, shimmer } = this.nodes;
    const now = this.ctx.currentTime;
    master.gain.setTargetAtTime(0, now, 0.25);
    [low, fifth, shimmer].forEach((o) => o.stop(now + 1.2));
    this.nodes = null;
  }

  chime(freq = 523.25, volume = 0.12) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    [[1, 1], [2.76, 0.35], [5.4, 0.12]].forEach(([mult, amp]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq * mult;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(volume * amp, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.2 / mult ** 0.4);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 3.6);
    });
  }
}

export function vibrate(pattern) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* non supporté */
  }
}
