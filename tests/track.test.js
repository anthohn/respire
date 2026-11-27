import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTrack, trackPlan, wavBlob, convolve, loopCycles, GUIDE_STYLES, DEFAULT_GUIDE, TRACK_RATE, LEAD, TAIL } from '../js/track.js';
import { PRESETS, cycleLength, sessionPlan, DURATIONS, durationLabel } from '../js/breath.js';

const STYLES = GUIDE_STYLES.map((g) => g.id);
const preset = (id) => PRESETS.find((p) => p.id === id);
const peakOf = (pcm) => pcm.reduce((m, v) => Math.max(m, Math.abs(v) / 32768), 0);
// Niveau maximal d'une piste : 0,5 ; le bol a des frappes brèves, on lui laisse un peu plus de crête pour qu'il paraisse aussi fort que Repères.
const maxPeak = (style) => (style === 'bol' ? 0.65 : 0.5);
const rmsAt = (pcm, rate, t, w = 0.1) => {
  const a = Math.max(0, Math.floor((t - w / 2) * rate));
  const b = Math.min(pcm.length, Math.floor((t + w / 2) * rate));
  let s = 0;
  for (let i = a; i < b; i++) s += (pcm[i] / 32768) ** 2;
  return Math.sqrt(s / Math.max(1, b - a));
};

test('piste : plan = installation + respirations + retombée', () => {
  const p = preset('long');
  const plan = trackPlan(p, 5);
  assert.equal(plan.cycles, 30);
  assert.equal(plan.breath, 300);
  assert.equal(plan.total, LEAD + 300 + TAIL);
  assert.equal(trackPlan(p, 5, { cycles: 2, lead: 1, tail: 2 }).total, 1 + 20 + 2);
});

for (const style of STYLES) {
  test(`piste « ${style} » : bonne durée, discrète, sans claquement, silencieuse aux extrémités`, async () => {
    const p = preset('long');
    const { pcm, rate, plan } = await renderTrack({ preset: p, cycles: 4, style });
    assert.equal(rate, TRACK_RATE);
    assert.equal(pcm.length, Math.round(plan.total * rate));
    const peak = peakOf(pcm);
    assert.ok(peak > 0.2 && peak <= maxPeak(style), `niveau ${peak}`);
    assert.ok(Math.abs(pcm[0]) < 60 && Math.abs(pcm[pcm.length - 1]) < 60, 'départ et fin dans le silence');
    // Un claquement serait un saut anormal à la jonction de deux cycles : on le compare à des endroits voisins de même niveau.
    const maxJump = (t, w = 0.01) => {
      let m = 0;
      for (let i = Math.floor((t - w) * rate) + 1; i < Math.floor((t + w) * rate); i++) m = Math.max(m, Math.abs(pcm[i] - pcm[i - 1]) / 32768);
      return m;
    };
    for (let c = 1; c < plan.cycles; c++) {
      const seam = plan.lead + c * plan.len;
      const baseline = Math.max(maxJump(seam - 0.5), maxJump(seam + 0.5));
      assert.ok(maxJump(seam) <= 2 * baseline + 1e-4, `jonction ${c} : saut ${maxJump(seam)} contre ${baseline} alentour`);
    }
    for (const t of [plan.lead - 0.5, plan.lead + plan.breath + 0.5]) assert.ok(maxJump(t) < peak * 0.3, 'pas de saut à l’installation ni à la retombée');
    // Pas de décalage continu (sinon claquement au démarrage et à l'arrêt).
    let sum = 0;
    for (const v of pcm) sum += v;
    assert.ok(Math.abs(sum / pcm.length / 32768) < 0.005);
  });
}

test('piste : fabrication identique à chaque fois (tests reproductibles)', async () => {
  const a = await renderTrack({ preset: preset('long'), cycles: 2, style: 'bol' });
  const b = await renderTrack({ preset: preset('long'), cycles: 2, style: 'bol' });
  assert.deepEqual(a.pcm, b.pcm);
});

test('piste « repères » : une note qui monte pour inspirer, une qui descend pour expirer', async () => {
  const p = preset('long');
  const { pcm, rate, plan } = await renderTrack({ preset: p, cycles: 2, style: 'reperes' });
  const freq = (t, w = 0.1) => {
    const a = Math.floor((t - w / 2) * rate);
    const b = Math.floor((t + w / 2) * rate);
    let n = 0;
    for (let i = a + 1; i < b; i++) if (pcm[i - 1] < 0 !== pcm[i] < 0) n++;
    return n / 2 / w;
  };
  const inhale = plan.lead; // début de la 1re inspiration
  assert.ok(freq(inhale + 1.0) > freq(inhale + 0.2) + 60, 'monte');
  const exhale = plan.lead + p.inhale + p.hold1;
  assert.ok(freq(exhale + 0.2) > freq(exhale + 1.3) + 60, 'descend');
  // Silence entre les deux : rien pendant la fin de l'expiration.
  assert.ok(rmsAt(pcm, rate, plan.lead + 9.5) < 0.01);
});

test('piste : dix minutes se fabriquent vite, pour un fichier raisonnable', async () => {
  const t0 = performance.now();
  const { pcm } = await renderTrack({ preset: preset('long'), minutes: 10, style: 'bol' });
  const ms = performance.now() - t0;
  assert.ok(ms < 4000, `${Math.round(ms)} ms`);
  assert.ok(pcm.byteLength < 16e6, `${(pcm.byteLength / 1e6).toFixed(1)} Mo`);
});

test('piste : fichier WAV valide', async () => {
  const { pcm, rate } = await renderTrack({ preset: preset('long'), cycles: 1, style: 'bol' });
  const blob = wavBlob(pcm, rate);
  const buf = new DataView(await blob.arrayBuffer());
  const text = (o, n) => String.fromCharCode(...new Uint8Array(buf.buffer, o, n));
  assert.equal(blob.size, 44 + pcm.length * 2);
  assert.equal(text(0, 4), 'RIFF');
  assert.equal(text(8, 4), 'WAVE');
  assert.equal(text(36, 4), 'data');
  assert.equal(buf.getUint32(24, true), rate);
  assert.equal(buf.getUint32(40, true), pcm.length * 2);
  for (const i of [0, 5000, 20000, pcm.length - 1]) assert.equal(buf.getInt16(44 + i * 2, true), pcm[i]);
  assert.ok(cycleLength(preset('long')) === 10);
});

for (const style of STYLES) {
  test(`piste en boucle « ${style} » : un nombre rond de cycles, sans installation, et la jonction est invisible`, async () => {
    const p = preset('long');
    const { pcm, rate, plan } = await renderTrack({ preset: p, style, loop: true });
    assert.equal(plan.loop, true);
    assert.equal(plan.lead, 0);
    assert.equal(plan.tail, 0);
    assert.equal(pcm.length, plan.cycles * plan.len * rate);
    assert.ok(pcm.length / rate > 150 && pcm.length / rate < 330, `quelques minutes : ${pcm.length / rate} s`);
    // La fin enchaîne sur le début comme n'importe quelle jonction de cycles : aucun saut plus grand qu'ailleurs.
    const jump = (i) => Math.abs(pcm[(i + pcm.length) % pcm.length] - pcm[(i - 1 + pcm.length) % pcm.length]) / 32768;
    const around = (center, w = 80) => {
      let m = 0;
      for (let i = center - w; i < center + w; i++) m = Math.max(m, jump(i));
      return m;
    };
    const seam = around(0);
    const baseline = Math.max(around(Math.round(plan.len * rate * 5)), around(Math.round(plan.len * rate * 7)));
    assert.ok(seam <= 2 * baseline + 1e-4, `jonction de la boucle : ${seam} contre ${baseline}`);
    assert.ok(peakOf(pcm) <= maxPeak(style));
  });
}

test('piste en boucle : parfaitement périodique (un cycle est identique au suivant)', async () => {
  const p = preset('long');
  const { pcm, rate, plan } = await renderTrack({ preset: p, style: 'bol', loop: true });
  const period = plan.len * rate;
  const a = 2 * period | 0; // loin des jonctions
  for (const i of [a, a + 1234, a + 20000, a + 50000]) assert.equal(pcm[i], pcm[i + period], 'même échantillon un cycle plus tard');
});

test('piste en boucle : un 4-7-8 donne aussi un tour d’environ quatre minutes', () => {
  const n = loopCycles(preset('478'));
  assert.ok(n * 19 > 150 && n * 19 < 330);
});

for (const style of STYLES) {
  test(`séance longue « ${style} » : la retombée est courte, finit dans le silence et n'ajoute pas de claquement`, async () => {
    const p = preset('long');
    const { pcm, rate, plan } = await renderTrack({ preset: p, cycles: 0, lead: 0, style });
    assert.equal(plan.cycles, 0);
    assert.equal(plan.total, TAIL);
    assert.equal(pcm.length, TAIL * rate);
    assert.ok(Math.abs(pcm[pcm.length - 1]) < 60, 'finit dans le silence');
    const peak = peakOf(pcm);
    assert.ok(peak > 0.02 && peak <= maxPeak(style), `niveau ${peak}`);
    let jump = 0;
    for (let i = 1; i < pcm.length; i++) jump = Math.max(jump, Math.abs(pcm[i] - pcm[i - 1]) / 32768);
    assert.ok(jump < peak * 0.5, `saut ${jump} pour un niveau de ${peak}`);
  });
}

test('1 h : une durée de plus, lisible, qui compte pour la série comme les autres', () => {
  assert.deepEqual(DURATIONS, [1, 3, 5, 10, 60, 0]);
  assert.equal(durationLabel(60), '1 h');
  assert.equal(durationLabel(10), '10 min');
  assert.equal(durationLabel(0), 'sans limite');
  const long = preset('long');
  assert.deepEqual(sessionPlan(long, 60), { cycles: 360, totalSeconds: 3600 });
  const p478 = preset('478'); // 19 s par cycle : on finit sur une expiration complète, au plus près de l'heure
  const plan = sessionPlan(p478, 60);
  assert.ok(Math.abs(plan.totalSeconds - 3600) <= 19);
});

// ---------- Bol ----------

test('guidages : le bol est celui par défaut, Repères reste disponible (Vague et Nappe n’existent plus)', () => {
  assert.equal(DEFAULT_GUIDE, 'bol');
  assert.deepEqual(GUIDE_STYLES.map((g) => g.id), ['bol', 'reperes']);
});

test('convolution par FFT : même résultat que le calcul direct', () => {
  const x = Float32Array.from({ length: 37 }, (_, i) => Math.sin(i * 0.7) + (i % 5) * 0.1);
  const h = Float32Array.from({ length: 11 }, (_, i) => Math.exp(-i / 3) * (i % 2 ? -1 : 1));
  const direct = new Float64Array(x.length + h.length - 1);
  for (let i = 0; i < x.length; i++) for (let j = 0; j < h.length; j++) direct[i + j] += x[i] * h[j];
  const fast = convolve(x, h);
  assert.equal(fast.length, direct.length);
  for (let i = 0; i < direct.length; i++) assert.ok(Math.abs(fast[i] - direct[i]) < 1e-4, `échantillon ${i}`);
});

// Amplitude de la sinusoïde de fréquence `hz` dans pcm[t0, t1] (fenêtre de Hann), cherchée à ±1,5 % pour tolérer l'arrondi.
const toneAt = (pcm, rate, hz, t0, t1) => {
  const a = Math.floor(t0 * rate);
  const n = Math.floor((t1 - t0) * rate);
  let best = 0;
  for (const k of [0.985, 0.9925, 1, 1.0075, 1.015]) {
    const w = (2 * Math.PI * hz * k) / rate;
    let re = 0;
    let im = 0;
    let wsum = 0;
    for (let i = 0; i < n; i++) {
      const h = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
      const v = (pcm[a + i] / 32768) * h;
      re += v * Math.cos(w * i);
      im -= v * Math.sin(w * i);
      wsum += h;
    }
    best = Math.max(best, (2 * Math.hypot(re, im)) / wsum);
  }
  return best;
};
const SI = 493.88;
const RE = 293.66;

for (const id of ['long', '478', 'calm']) {
  test(`bol « ${id} » : une frappe aiguë (si) au début de l’inspiration, une grave (ré) au début de l’expiration`, async () => {
    const p = preset(id);
    const { pcm, rate, plan } = await renderTrack({ preset: p, cycles: 3, style: 'bol' });
    for (let c = 0; c < 3; c++) {
      const inhale = plan.lead + c * plan.len;
      const exhale = inhale + p.inhale + p.hold1;
      assert.ok(toneAt(pcm, rate, SI, inhale + 0.05, inhale + 0.5) > 3 * toneAt(pcm, rate, RE, inhale + 0.05, inhale + 0.5), `inspiration ${c + 1} : le si domine`);
      assert.ok(toneAt(pcm, rate, RE, exhale + 0.05, exhale + 0.5) > 3 * toneAt(pcm, rate, SI, exhale + 0.05, exhale + 0.5), `expiration ${c + 1} : le ré domine`);
      // Une frappe est une montée franche : juste après, bien plus fort que juste avant.
      assert.ok(rmsAt(pcm, rate, inhale + 0.1) > 1.5 * rmsAt(pcm, rate, inhale - 0.1), 'attaque de l’inspiration');
      assert.ok(rmsAt(pcm, rate, exhale + 0.1) > 1.5 * rmsAt(pcm, rate, exhale - 0.1), 'attaque de l’expiration');
    }
  });
}

test('bol : l’ouverture et la clôture n’utilisent aucune note de respiration (rien à confondre)', async () => {
  const p = preset('long');
  const { pcm, rate, plan } = await renderTrack({ preset: p, cycles: 1, style: 'bol' });
  const small = 0.03; // de l'ordre du bruit de fond d'une résonance qui s'éteint
  // Ouverture : avant la première inspiration, ni si ni ré (ni leurs octaves).
  for (const hz of [SI, RE, SI * 2, RE * 2]) assert.ok(toneAt(pcm, rate, hz, 0.3, 4.4) < small * peakOf(pcm), `ouverture : ${hz} Hz`);
  // Clôture : une fois la dernière résonance du bol éteinte.
  const end = plan.lead + plan.breath;
  for (const hz of [SI, RE, SI * 2, RE * 2]) assert.ok(toneAt(pcm, rate, hz, end + 1.8, end + 4.5) < small * peakOf(pcm), `clôture : ${hz} Hz`);
  // Et ce sont bien des sons : de la musique, pas le silence, plus grave que la fin du carillon d’origine.
  assert.ok(rmsAt(pcm, rate, 1.5, 1.5) > 0.03 && rmsAt(pcm, rate, end + 1.5, 1.5) > 0.03);
  // Témoin : sur les frappes du bol, la même mesure est élevée.
  assert.ok(toneAt(pcm, rate, SI, plan.lead + 0.05, plan.lead + 0.5) > 0.1 * peakOf(pcm));
});

test('bol : ouverture, cycles et clôture au même niveau perçu', async () => {
  const { pcm, rate, plan } = await renderTrack({ preset: preset('long'), cycles: 3, style: 'bol' });
  const win = (a, b) => rmsAt(pcm, rate, (a + b) / 2, b - a);
  const intro = win(0, plan.lead);
  const mid = win(plan.lead + plan.len, plan.lead + 3 * plan.len);
  const outro = win(plan.lead + plan.breath, plan.total - 0.5);
  assert.ok(intro / mid > 0.7 && intro / mid < 1.4, `ouverture ${intro} / cycles ${mid}`);
  assert.ok(outro / mid > 0.7 && outro / mid < 1.4, `clôture ${outro} / cycles ${mid}`);
});

test('bol : même niveau perçu que Repères', async () => {
  const r = await renderTrack({ preset: preset('long'), cycles: 3, style: 'reperes' });
  const b = await renderTrack({ preset: preset('long'), cycles: 3, style: 'bol' });
  const a = rmsAt(r.pcm, r.rate, r.plan.lead + 20, 20);
  const c = rmsAt(b.pcm, b.rate, b.plan.lead + 20, 20);
  assert.ok(c / a > 0.85 && c / a < 1.15, `bol ${c} / repères ${a}`);
});

test('bol : l’aperçu d’une respiration (installation de 1 s) n’a ni ouverture ni clôture', async () => {
  const { pcm, rate } = await renderTrack({ preset: preset('long'), cycles: 1, lead: 1, tail: 2, style: 'bol' });
  assert.ok(rmsAt(pcm, rate, 0.5, 1) < 0.002, 'rien avant la première inspiration');
  assert.ok(toneAt(pcm, rate, SI, 1.05, 1.5) > 0.05 * peakOf(pcm), 'la frappe est là');
});

test('bol : la retombée d’une longue séance reprend la résonance de la boucle sans coupure', async () => {
  const p = preset('long');
  const loop = await renderTrack({ preset: p, style: 'bol', loop: true });
  const outro = await renderTrack({ preset: p, cycles: 0, lead: 0, style: 'bol' });
  const end = loop.pcm.length;
  // Saut entre le dernier échantillon de la boucle et le premier de la retombée, comparé aux sauts habituels de la boucle.
  const gap = Math.abs(outro.pcm[0] - loop.pcm[end - 1]);
  let usual = 0;
  for (let i = end - 3000; i < end; i++) usual = Math.max(usual, Math.abs(loop.pcm[i] - loop.pcm[i - 1]));
  assert.ok(gap <= 2 * usual + 40, `saut ${gap} contre ${usual} d’ordinaire`);
  // Pas de creux au raccord (un fondu d'entrée sur la retombée en ferait un) : même niveau juste avant et juste après.
  const before = rmsAt(loop.pcm, loop.rate, end / loop.rate - 0.02, 0.04);
  const after = rmsAt(outro.pcm, outro.rate, 0.02, 0.04);
  assert.ok(before > 0.002, 'la boucle sonne encore à sa fin (la résonance se prolonge)');
  assert.ok(after / before > 0.8 && after / before < 1.25, `niveau avant ${before}, après ${after}`);
  assert.ok(Math.abs(outro.pcm[outro.pcm.length - 1]) < 60, 'finit dans le silence');
});

test('bol : le premier son se prépare une fois, puis les pistes se fabriquent presque instantanément', async () => {
  await renderTrack({ preset: preset('long'), cycles: 1, style: 'bol' });
  const t0 = performance.now();
  await renderTrack({ preset: preset('long'), minutes: 10, style: 'bol' });
  assert.ok(performance.now() - t0 < 1500, `${Math.round(performance.now() - t0)} ms`);
});
