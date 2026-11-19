import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, streakInfo, weekKeys, levelInfo, earnedBadgeIds, buildStats, formatDuration, formatClock } from '../js/stats.js';
import { PRESETS, sessionPlan, phaseAt, cycleLength, getPreset } from '../js/breath.js';

const TODAY = '2026-11-19'; // jeudi
const s = (date, seconds = 300) => ({ date, seconds });
const days = (...offsets) => offsets.map((n) => s(addDays(TODAY, n)));

test('série : jours consécutifs, aujourd’hui compris', () => {
  const info = streakInfo(days(0, -1, -2), TODAY);
  assert.equal(info.current, 3);
  assert.equal(info.todayDone, true);
  assert.equal(info.atRisk, false);
});

test('série : aujourd’hui pas encore fait ne casse pas la série', () => {
  const info = streakInfo(days(-1, -2, -3), TODAY);
  assert.equal(info.current, 3);
  assert.equal(info.todayDone, false);
  assert.equal(info.atRisk, true);
});

test('série : un jour de repos est offert', () => {
  // aujourd'hui, (hier manqué), avant-hier, il y a 3 jours
  const info = streakInfo(days(0, -2, -3), TODAY);
  assert.equal(info.current, 3);
  assert.deepEqual([...info.rest], [addDays(TODAY, -1)]);
});

test('série : deux jours manqués d’affilée cassent la série', () => {
  const info = streakInfo(days(0, -3, -4), TODAY);
  assert.equal(info.current, 1);
});

test('série : un seul jour de repos par fenêtre de 7 jours', () => {
  // actifs : 0, -2 (repos -1), -4 (repos -3 refusé car trop proche)
  const info = streakInfo(days(0, -2, -4), TODAY);
  assert.equal(info.current, 2);
});

test('série : deux jours de repos espacés de 7 jours sont acceptés', () => {
  const offsets = [0, -2, -3, -4, -5, -6, -7, -8, -10];
  const info = streakInfo(days(...offsets), TODAY);
  assert.equal(info.current, 9);
  assert.equal(info.rest.size, 2);
});

test('série : hier en repos, aujourd’hui à faire = série vivante mais fragile', () => {
  const info = streakInfo(days(-2, -3), TODAY);
  assert.equal(info.current, 2);
  assert.equal(info.yesterdayRest, true);
  assert.equal(info.atRisk, true);
});

test('série : moins d’une minute ne compte pas', () => {
  const info = streakInfo([s(TODAY, 40)], TODAY);
  assert.equal(info.current, 0);
  assert.equal(info.todayDone, false);
});

test('série : plusieurs petites sessions le même jour s’additionnent', () => {
  const info = streakInfo([s(TODAY, 35), s(TODAY, 35)], TODAY);
  assert.equal(info.todayDone, true);
  assert.equal(info.current, 1);
});

test('meilleure série conservée après une coupure', () => {
  const info = streakInfo(days(0, -1, -20, -21, -22, -23, -24), TODAY);
  assert.equal(info.current, 2);
  assert.equal(info.best, 5);
});

test('semaine : du lundi au dimanche', () => {
  const week = weekKeys(TODAY);
  assert.equal(week.length, 7);
  assert.equal(week[0], '2026-11-16');
  assert.equal(week[6], '2026-11-22');
});

test('niveaux : progression', () => {
  assert.equal(levelInfo(0).level.name, 'Graine');
  assert.equal(levelInfo(14).level.name, 'Graine');
  assert.equal(levelInfo(15).level.name, 'Pousse');
  assert.equal(levelInfo(15).toNext, 30);
  assert.equal(levelInfo(5000).next, null);
  assert.equal(levelInfo(5000).progress, 1);
});

test('trophées', () => {
  const stats = buildStats(days(0, -1, -2), TODAY);
  const ids = earnedBadgeIds(stats);
  assert.ok(ids.includes('first'));
  assert.ok(ids.includes('streak-3'));
  assert.ok(!ids.includes('streak-7'));
});

test('formats de durée', () => {
  assert.equal(formatDuration(45), '45 s');
  assert.equal(formatDuration(60), '1 min');
  assert.equal(formatDuration(125), '2 min 05');
  assert.equal(formatDuration(600), '10 min');
  assert.equal(formatDuration(3900), '1 h 05');
  assert.equal(formatDuration(3600), '1 h');
  assert.equal(formatDuration(7200), '2 h');
  assert.equal(formatClock(61.2), '1:02');
  assert.equal(formatClock(0), '0:00');
});

test('séance : nombre de cycles et durée réelle', () => {
  const long = PRESETS.find((p) => p.id === 'long');
  assert.deepEqual(sessionPlan(long, 5), { cycles: 30, totalSeconds: 300 });
  const calm = PRESETS.find((p) => p.id === 'calm'); // cycle de 12 s
  assert.deepEqual(sessionPlan(calm, 1), { cycles: 5, totalSeconds: 60 });
});

test('respiration : la courbe monte, tient, redescend', () => {
  const calm = PRESETS.find((p) => p.id === 'calm'); // 4 / 2 / 6
  assert.equal(cycleLength(calm), 12);
  assert.equal(phaseAt(calm, 0).phase, 'inhale');
  assert.equal(phaseAt(calm, 0).breath, 0);
  assert.equal(phaseAt(calm, 4).phase, 'hold1');
  assert.equal(phaseAt(calm, 5).breath, 1);
  assert.equal(phaseAt(calm, 6).phase, 'exhale');
  assert.ok(Math.abs(phaseAt(calm, 9).breath - 0.5) < 1e-9);
  assert.equal(phaseAt(calm, 12).phase, 'inhale');
  assert.equal(phaseAt(calm, 12).cycle, 1);
});

import { journeyLayout, STEPS } from '../js/journey.js';

test('ascension : le marqueur suit la série', () => {
  const start = journeyLayout(0);
  assert.equal(start.marker.x, start.pts[0].x);
  assert.equal(start.marker.y, start.pts[0].y);
  assert.equal(start.done, `M ${start.pts[0].x.toFixed(1)} ${start.pts[0].y.toFixed(1)}`);

  const onStep = journeyLayout(3);
  assert.ok(Math.abs(onStep.marker.y - onStep.pts[1].y) < 1e-9);

  const mid = journeyLayout(5); // entre 3 et 7
  assert.ok(mid.marker.y < onStep.pts[1].y && mid.marker.y > onStep.pts[2].y);

  const summit = journeyLayout(250);
  assert.equal(summit.marker.y, summit.pts[STEPS.length - 1].y);
  assert.equal(summit.done, summit.full);
});

test('4-7-8 : inspire 4, retiens 7, expire 8', () => {
  const p = PRESETS.find((x) => x.id === '478');
  assert.ok(p);
  assert.equal(cycleLength(p), 19);
  assert.deepEqual([phaseAt(p, 0).phase, phaseAt(p, 3.9).phase, phaseAt(p, 4).phase, phaseAt(p, 10.9).phase, phaseAt(p, 11).phase, phaseAt(p, 18.9).phase, phaseAt(p, 19).phase],
    ['inhale', 'inhale', 'hold1', 'hold1', 'exhale', 'exhale', 'inhale']);
  assert.equal(phaseAt(p, 6).breath, 1, 'poumons pleins pendant la pause');
  assert.equal(phaseAt(p, 7).phaseDur, 7);
  assert.equal(phaseAt(p, 11).phaseDur, 8);
});

test('une session compte toujours pour la série (au moins 60 s), quel que soit le rythme', () => {
  for (const p of PRESETS) {
    for (const minutes of [1, 3, 5, 10]) {
      const { totalSeconds } = sessionPlan(p, minutes);
      assert.ok(totalSeconds >= 60, `${p.name} ${minutes} min → ${totalSeconds} s`);
      assert.ok(Math.abs(totalSeconds - minutes * 60) <= Math.max(cycleLength(p), 20), `${p.name} ${minutes} min trop éloigné : ${totalSeconds} s`);
    }
  }
  assert.deepEqual(sessionPlan(PRESETS.find((x) => x.id === '478'), 1), { cycles: 4, totalSeconds: 76 });
});

test('rythmes : 4 au choix, et un rythme retiré retombe sur le recommandé', () => {
  assert.deepEqual(PRESETS.map((p) => p.id), ['long', 'coherence', 'calm', '478']);
  assert.equal(getPreset('first').id, 'long', 'ancien réglage « Premiers pas »');
  assert.equal(getPreset(undefined).id, 'long');
  assert.equal(getPreset('478').id, '478');
});

import { renderCue, SAMPLE_RATE } from '../js/audio.js';

// Fréquence autour de l'instant t (en s), par passages à zéro.
const freqAt = (x, t, w = 0.1) => {
  const a = Math.floor((t - w / 2) * SAMPLE_RATE);
  const b = Math.floor((t + w / 2) * SAMPLE_RATE);
  let crossings = 0;
  for (let i = a + 1; i < b; i++) if (x[i - 1] < 0 !== x[i] < 0) crossings++;
  return crossings / 2 / w;
};
const GLISSE_IN = ['glide', 330, 494, 1.3, 0.06, 2000];
const GLISSE_OUT = ['glide', 440, 294, 1.7, 0.05, 1300];

test('repères : l’inspiration monte, l’expiration descend', () => {
  const up = renderCue(GLISSE_IN, 60);
  assert.ok(freqAt(up, 1.0) > freqAt(up, 0.2) + 60, `monte : ${freqAt(up, 0.2)} → ${freqAt(up, 1.0)} Hz`);
  const down = renderCue(GLISSE_OUT, 60);
  assert.ok(freqAt(down, 0.2) > freqAt(down, 1.3) + 60, `descend : ${freqAt(down, 0.2)} → ${freqAt(down, 1.3)} Hz`);
});

test('repères : discrets, sans claquement, qui commence et finit dans le silence', () => {
  for (const spec of [GLISSE_IN, GLISSE_OUT, ['bubble', 300, 640, 0.17, 0.08], ['glide', 392, 262, 2.6, 0.05, 1200]]) {
    const x = renderCue(spec, 100);
    const peak = Math.max(...x.map(Math.abs));
    assert.ok(peak > 0.005 && peak < 0.2, `niveau ${peak}`); // même à 100 %, bien en dessous de la pleine échelle
    assert.ok(Math.abs(x[0]) < 1e-4 && Math.abs(x[x.length - 1]) < 1e-4, 'départ et fin à zéro');
    let jump = 0;
    for (let i = 1; i < x.length; i++) jump = Math.max(jump, Math.abs(x[i] - x[i - 1]));
    // Un sinus de ~1 kHz à 22 kHz d'échantillonnage saute d'au plus ~0,3× son niveau ; un claquement approcherait 1×.
    assert.ok(jump < peak * 0.4, `saut maximal ${jump} pour un niveau de ${peak}`);
  }
  assert.ok(renderCue(GLISSE_IN, 0).every((v) => v === 0), 'volume 0 = silence');
  const quiet = Math.max(...renderCue(GLISSE_IN, 30).map(Math.abs));
  const loud = Math.max(...renderCue(GLISSE_IN, 90).map(Math.abs));
  assert.ok(loud > quiet * 1.5, 'le volume joue sur le niveau (iOS ignore le volume des éléments audio)');
});

import { load } from '../js/store.js';

const withStored = (obj) => {
  globalThis.localStorage = { getItem: () => (obj ? JSON.stringify(obj) : null), setItem() {} };
  return load().settings;
};

test('réglages : le guidage sonore est actif par défaut, y compris pour les anciens réglages', () => {
  assert.equal(withStored(null).sound, true);
  assert.equal(withStored(null).soundStyle, 'vague');
  // Avant le guidage sonore : le son était coupé par défaut et avait d'autres réglages.
  const old = withStored({ settings: { sound: false, soundMode: 'fil', soundVolume: 40, presetId: 'long' } });
  assert.equal(old.sound, true);
  assert.equal(old.soundStyle, 'vague');
  for (const k of ['soundMode', 'soundVolume', 'audioMode', 'audioStyle']) assert.ok(!(k in old), `${k} retiré`);
  // Le style choisi pendant la phase « mode audio » est gardé.
  assert.equal(withStored({ settings: { audioStyle: 'nappe', audioMode: true } }).soundStyle, 'nappe');
  // Ensuite, le choix de l'utilisateur est respecté.
  const mine = withStored({ settings: { sound: false, soundStyle: 'reperes' } });
  assert.equal(mine.sound, false);
  assert.equal(mine.soundStyle, 'reperes');
  assert.equal(withStored({ settings: { sound: true, soundStyle: 'inconnu' } }).soundStyle, 'vague');
});

import { isUnlimited, UNLIMITED, DURATIONS } from '../js/breath.js';

test('durée libre : pas de fin, un choix de plus à côté des durées', () => {
  assert.ok(isUnlimited(UNLIMITED));
  assert.ok(DURATIONS.includes(UNLIMITED));
  assert.ok(!isUnlimited(5));
  const plan = sessionPlan(PRESETS.find((p) => p.id === 'long'), UNLIMITED);
  assert.equal(plan.totalSeconds, Infinity);
  assert.equal(plan.cycles, Infinity);
});
