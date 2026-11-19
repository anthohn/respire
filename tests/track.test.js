import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTrack, trackPlan, wavBlob, GUIDE_STYLES, TRACK_RATE, LEAD, TAIL } from '../js/track.js';
import { PRESETS, phaseAt, cycleLength } from '../js/breath.js';

const preset = (id) => PRESETS.find((p) => p.id === id);
const peakOf = (pcm) => pcm.reduce((m, v) => Math.max(m, Math.abs(v) / 32768), 0);
const rmsAt = (pcm, rate, t, w = 0.1) => {
  const a = Math.max(0, Math.floor((t - w / 2) * rate));
  const b = Math.min(pcm.length, Math.floor((t + w / 2) * rate));
  let s = 0;
  for (let i = a; i < b; i++) s += (pcm[i] / 32768) ** 2;
  return Math.sqrt(s / Math.max(1, b - a));
};
const corr = (xs, ys) => {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
};

test('piste : plan = installation + respirations + retombée', () => {
  const p = preset('long');
  const plan = trackPlan(p, 5);
  assert.equal(plan.cycles, 30);
  assert.equal(plan.breath, 300);
  assert.equal(plan.total, LEAD + 300 + TAIL);
  assert.equal(trackPlan(p, 5, { cycles: 2, lead: 1, tail: 2 }).total, 1 + 20 + 2);
});

for (const style of GUIDE_STYLES.map((g) => g.id)) {
  test(`piste « ${style} » : bonne durée, discrète, sans claquement, silencieuse aux extrémités`, async () => {
    const p = preset('long');
    const { pcm, rate, plan } = await renderTrack({ preset: p, cycles: 4, style });
    assert.equal(rate, TRACK_RATE);
    assert.equal(pcm.length, Math.round(plan.total * rate));
    const peak = peakOf(pcm);
    assert.ok(peak > 0.2 && peak <= 0.5, `niveau ${peak}`);
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
  const a = await renderTrack({ preset: preset('long'), cycles: 2, style: 'vague' });
  const b = await renderTrack({ preset: preset('long'), cycles: 2, style: 'vague' });
  assert.deepEqual(a.pcm, b.pcm);
});

for (const style of ['vague', 'nappe']) {
  test(`piste « ${style} » : le volume suit le souffle (monte en inspirant, redescend en expirant)`, async () => {
    const p = preset('long');
    const { pcm, rate, plan } = await renderTrack({ preset: p, cycles: 3, style });
    const ts = [];
    for (let t = 0; t < 3 * plan.len; t += 0.25) ts.push(t);
    const env = ts.map((t) => rmsAt(pcm, rate, plan.lead + t));
    const br = ts.map((t) => phaseAt(p, t).breath);
    assert.ok(corr(env, br) > 0.93, `corrélation ${corr(env, br)}`);
    // Poumons pleins nettement plus fort que poumons vides, mais le fond ne disparaît jamais.
    const full = rmsAt(pcm, rate, plan.lead + 4);
    const empty = rmsAt(pcm, rate, plan.lead + 0.05 + plan.len);
    assert.ok(full > empty * 2.5, `plein ${full} / vide ${empty}`);
    assert.ok(empty > 0.005, 'le fond reste audible : on sait que ça joue');
  });
}

test('piste : pendant la rétention du 4-7-8, le son reste plein', async () => {
  const p = preset('478');
  const { pcm, rate, plan } = await renderTrack({ preset: p, cycles: 2, style: 'nappe' });
  const full = rmsAt(pcm, rate, plan.lead + 4.5);
  const held = rmsAt(pcm, rate, plan.lead + 9);
  const end = rmsAt(pcm, rate, plan.lead + 18.5);
  assert.ok(held > full * 0.9, 'la rétention garde le niveau');
  assert.ok(end < full * 0.5, 'la fin d’expiration est bien plus douce');
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
  const { pcm } = await renderTrack({ preset: preset('long'), minutes: 10, style: 'vague' });
  const ms = performance.now() - t0;
  assert.ok(ms < 4000, `${Math.round(ms)} ms`);
  assert.ok(pcm.byteLength < 16e6, `${(pcm.byteLength / 1e6).toFixed(1)} Mo`);
});

test('piste : fichier WAV valide', async () => {
  const { pcm, rate } = await renderTrack({ preset: preset('long'), cycles: 1, style: 'nappe' });
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

import { loopCycles } from '../js/track.js';

for (const style of ['vague', 'nappe', 'reperes']) {
  test(`piste en boucle « ${style} » : un nombre rond de cycles, sans installation, et la jonction est invisible`, async () => {
    const p = preset('long');
    const { pcm, rate, plan } = await renderTrack({ preset: p, style, loop: true });
    assert.equal(plan.loop, true);
    assert.equal(plan.lead, 0);
    assert.equal(plan.tail, 0);
    assert.equal(plan.cycles % 3, 0, 'multiple de 3 : les variantes de bruit reviennent dans l’ordre');
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
    assert.ok(peakOf(pcm) <= 0.5);
  });
}

test('piste en boucle : parfaitement périodique (un tour de trois cycles est identique au suivant)', async () => {
  const p = preset('long');
  const { pcm, rate, plan } = await renderTrack({ preset: p, style: 'vague', loop: true });
  const period = 3 * plan.len * rate;
  const a = 2 * period / 3 | 0; // loin des jonctions
  for (const i of [a, a + 1234, a + 20000, a + 50000]) assert.equal(pcm[i], pcm[i + period], 'même échantillon un tour de trois cycles plus tard');
});

test('piste en boucle : un 4-7-8 donne aussi un tour d’environ quatre minutes', () => {
  const n = loopCycles(preset('478'));
  assert.equal(n % 3, 0);
  assert.ok(n * 19 > 150 && n * 19 < 330);
});

import { sessionPlan, DURATIONS, durationLabel } from '../js/breath.js';

for (const style of ['vague', 'nappe', 'reperes']) {
  test(`séance longue « ${style} » : la retombée est courte, finit dans le silence et n'ajoute pas de claquement`, async () => {
    const p = preset('long');
    const { pcm, rate, plan } = await renderTrack({ preset: p, cycles: 0, lead: 0, style });
    assert.equal(plan.cycles, 0);
    assert.equal(plan.total, TAIL);
    assert.equal(pcm.length, TAIL * rate);
    assert.ok(Math.abs(pcm[pcm.length - 1]) < 60, 'finit dans le silence');
    const peak = peakOf(pcm);
    assert.ok(peak > 0.02 && peak <= 0.5, `niveau ${peak}`);
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
