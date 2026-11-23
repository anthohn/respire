import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/circle.js';
import { memoryStore } from '../api/_store.js';
import { deriveKeys, encryptPayload, decryptPayload } from '../js/sync.js';
import {
  parseInvite, inviteLink, cleanName, buildStatus, parseStatus, memberView, summarize, sortMembers, canSend,
  createCircle, joinCircle, publish, fetchCircle, sendSign, ackEvents, leaveCircle, CircleError, newIdentity,
} from '../js/circle.js';
import { addDays } from '../js/stats.js';

const TODAY = '2026-11-19'; // jeudi
const sess = (offset, seconds = 300) => ({ id: `s${offset}`, ts: `${addDays(TODAY, offset)}T08:00:00.000Z`, date: addDays(TODAY, offset), seconds, cycles: 30, preset: 'long', completed: true });
const phone = (name, offsets = [], extra = {}) => ({ onboarded: true, name, sessions: offsets.map((o) => sess(o)), settings: {}, circle: null, ...extra });

function installServer(store = memoryStore()) {
  const handler = createHandler(store);
  const seen = [];
  globalThis.fetch = async (_url, opts) => {
    seen.push(opts.body);
    return new Promise((resolve) => {
      const res = { statusCode: 200, setHeader() {}, end(text) { resolve({ status: this.statusCode, json: async () => JSON.parse(text) }); } };
      handler({ method: 'POST', body: JSON.parse(opts.body) }, res);
    });
  };
  return { store, seen };
}

test('invitation : le lien contient le code, qu’on retrouve depuis le lien ou depuis la saisie', () => {
  const link = inviteLink('4821903477162290', 'https://exemple.test/');
  assert.equal(link, 'https://exemple.test/#cercle=4821903477162290');
  assert.equal(parseInvite(link), '4821903477162290');
  assert.equal(parseInvite('#cercle=4821 9034 7716 2290'), '4821903477162290');
  assert.equal(parseInvite('4821-9034-7716-2290'), '4821903477162290');
  assert.equal(parseInvite('#cercle=123'), null);
  assert.equal(parseInvite(''), null);
  assert.equal(parseInvite(undefined), null);
});

test('prénom : nettoyé et limité', () => {
  assert.equal(cleanName('  Léa <b>\n'), 'Léa b');
  assert.equal(cleanName('x'.repeat(60)).length, 24);
  assert.equal(cleanName(null), '');
});

test('statut partagé : le strict minimum, rien d’autre', () => {
  const state = phone('Léa', [0, -1, -2], { circle: { cn: 'Famille' } });
  state.sessions[0].feeling = 'calm'; // ne doit jamais partir
  const s = buildStatus(state, TODAY);
  assert.deepEqual(Object.keys(s).sort(), ['acts', 'best', 'cn', 'day', 'last', 'name', 'since', 'streak', 'v', 'week']);
  assert.match(s.acts, /^[01]{28}$/, 'quatre semaines, oui ou non par jour');
  assert.equal(s.acts.slice(-3), '111');
  assert.equal(s.acts.slice(-5), '00111');
  assert.equal(s.name, 'Léa');
  assert.equal(s.cn, 'Famille');
  assert.equal(s.streak, 3);
  assert.equal(s.last, TODAY);
  assert.equal(s.week, '0001000'.replace('0001000', '0111000')); // jeudi, mercredi, mardi
  assert.ok(!JSON.stringify(s).includes('calm'));
  assert.ok(!JSON.stringify(s).includes('300'), 'pas de durée');
});

test('statut reçu : vérifié et nettoyé avant tout affichage', () => {
  const s = parseStatus({ name: '<img onerror=x> Paul\u0007', cn: 5, streak: -3, best: 1e9, last: 'hier', day: '2026-11-19', week: 'abc' });
  assert.equal(s.name, 'img onerror=x Paul');
  assert.equal(s.cn, '');
  assert.equal(s.streak, 0);
  assert.equal(s.best, 0);
  assert.equal(s.last, '');
  assert.equal(s.day, '2026-11-19');
  assert.equal(s.week, '0000000');
  assert.equal(parseStatus(null), null);
  assert.equal(parseStatus('texte'), null);
});

test('affichage : fait aujourd’hui, en attente, à risque, interrompue, jamais commencé', () => {
  const st = (over) => parseStatus({ name: 'A', streak: 12, best: 20, last: TODAY, day: TODAY, week: '0111000', ...over });
  assert.equal(memberView(st({}), TODAY).state, 'done');
  assert.equal(memberView(st({}), TODAY).streak, 12);
  assert.equal(memberView(st({ last: addDays(TODAY, -1) }), TODAY).state, 'pending');
  assert.equal(memberView(st({ last: addDays(TODAY, -1) }), TODAY).streak, 12, 'sa série tient encore');
  assert.equal(memberView(st({ last: addDays(TODAY, -2) }), TODAY).state, 'risk');
  const lapsed = memberView(st({ last: addDays(TODAY, -5) }), TODAY);
  assert.equal(lapsed.state, 'lapsed');
  assert.equal(lapsed.streak, 0, 'série interrompue : on ne montre pas un faux chiffre');
  assert.equal(memberView(st({ last: '', streak: 0 }), TODAY).state, 'new');
  // Même date de publication un autre jour de la même semaine : les points restent ; semaine passée : ils s'effacent.
  assert.deepEqual(memberView(st({ day: addDays(TODAY, -1) }), TODAY).week, [false, true, true, true, false, false, false]);
  assert.deepEqual(memberView(st({ day: addDays(TODAY, -7) }), TODAY).week, Array(7).fill(false));
});

test('cercle : soi d’abord, puis par série', () => {
  const m = (name, streak, me = false) => ({ mid: name, me, status: parseStatus({ name, streak, best: streak, last: TODAY, day: TODAY, week: '0000000' }) });
  const sorted = sortMembers([m('Paul', 3), m('Léa', 12), m('Moi', 1, true), m('Zoé', 12)], TODAY);
  assert.deepEqual(sorted.map((x) => x.status.name), ['Moi', 'Léa', 'Zoé', 'Paul']);
  const sum = summarize([m('A', 1), { ...m('B', 1), status: parseStatus({ name: 'B', streak: 1, last: addDays(TODAY, -1), day: TODAY }) }], TODAY);
  assert.deepEqual([sum.total, sum.done], [2, 1]);
});

test('cercle : la clé d’un cercle n’ouvre pas une synchronisation, même avec le même code', async () => {
  const sync = await deriveKeys('1111222233334444');
  const circle = await deriveKeys('1111222233334444', 'respire-circle-v1');
  assert.notEqual(sync.id, circle.id);
  const blob = await encryptPayload(circle.key, { secret: 1 });
  await assert.rejects(() => decryptPayload(sync.key, blob));
});

test('cercle de bout en bout : créer, rejoindre, se voir, s’écrire, quitter', async () => {
  const { seen } = installServer();
  const lea = phone('Léa', [0, -1, -2]);
  const paul = phone('Paul', [-1]);

  await assert.rejects(() => createCircle(lea, { name: '  ', circleName: 'x' }, TODAY), (e) => e instanceof CircleError && e.code === 'name');
  assert.equal(lea.circle, null, 'rien n’est créé sans prénom');
  await createCircle(lea, { name: 'Léa', circleName: 'La famille' }, TODAY);
  assert.match(lea.circle.code, /^\d{16}$/);

  await assert.rejects(() => joinCircle(paul, '0000 0000 0000 0000', { name: 'Paul' }, TODAY), (e) => e.code === 'unknown');
  await assert.rejects(() => joinCircle(paul, '123', { name: 'Paul' }, TODAY), (e) => e.code === 'invalid');
  assert.equal(paul.circle, null);
  await joinCircle(paul, lea.circle.code, { name: 'Paul' }, TODAY);
  assert.notEqual(paul.circle.mid, lea.circle.mid);

  const forLea = await fetchCircle(lea);
  assert.deepEqual(forLea.members.map((m) => m.status.name).sort(), ['Léa', 'Paul']);
  assert.equal(forLea.members.find((m) => m.me).status.name, 'Léa');
  assert.equal(forLea.members.find((m) => m.status.name === 'Paul').status.streak, 1);
  assert.ok(forLea.members.every((m) => m.status.cn === '' || m.status.cn === 'La famille'));

  // Paul fait sa séance : son statut change, Léa le voit
  paul.sessions.push(sess(0));
  assert.equal((await publish(paul, TODAY)).count, 2);
  const view = memberView((await fetchCircle(lea)).members.find((m) => m.status.name === 'Paul').status, TODAY);
  assert.deepEqual([view.state, view.streak], ['done', 2]);
  // Rien n'a changé : on ne republie pas
  assert.equal((await publish(paul, TODAY)).skipped, true);

  // Léa fait un bravo à Paul, une seule fois par jour
  assert.ok(canSend(lea.circle, paul.circle.mid, 'cheer', TODAY));
  await sendSign(lea, paul.circle.mid, 'cheer', TODAY);
  assert.ok(!canSend(lea.circle, paul.circle.mid, 'cheer', TODAY));
  assert.ok(canSend(lea.circle, paul.circle.mid, 'nudge', TODAY), 'un autre signe reste possible');
  const got = await fetchCircle(paul);
  assert.deepEqual(got.events.map((e) => [e.name, e.kind]), [['Léa', 'cheer']]);
  assert.equal((await fetchCircle(lea)).events.length, 0);
  await ackEvents(paul, got.events[0].at);
  assert.equal((await fetchCircle(paul)).events.length, 0);

  // Le serveur n'a rien vu en clair : ni prénoms, ni séries, ni code
  const all = seen.join('\n');
  for (const secret of ['Léa', 'Paul', 'La famille', lea.circle.code, 'streak', 'cheer']) assert.ok(!all.includes(secret), `« ${secret} » ne doit pas voyager en clair`);

  // Paul part : il disparaît du cercle de Léa
  await leaveCircle(paul);
  assert.equal(paul.circle, null);
  assert.deepEqual((await fetchCircle(lea)).members.map((m) => m.status.name), ['Léa']);
  await leaveCircle(lea);
  await assert.rejects(() => fetchCircle({ circle: { code: lea.circle?.code || '0', mid: 'x' } }), () => true);
});

test('cercle : douze personnes au plus', async () => {
  installServer();
  const first = phone('Un');
  await createCircle(first, { name: 'Un', circleName: '' }, TODAY);
  for (let i = 2; i <= 12; i++) await joinCircle(phone(`P${i}`), first.circle.code, { name: `P${i}` }, TODAY);
  const late = phone('Treize');
  await assert.rejects(() => joinCircle(late, first.circle.code, { name: 'Treize' }, TODAY), (e) => e.code === 'full');
  assert.equal(late.circle, null);
});

test('cercle : sans réseau, on ne quitte pas à moitié ; « quitter quand même » force', async () => {
  installServer();
  const a = phone('A');
  await createCircle(a, { name: 'A', circleName: '' }, TODAY);
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('hors ligne'); };
  await assert.rejects(() => leaveCircle(a), (e) => e.code === 'offline');
  assert.ok(a.circle, 'toujours dans le cercle');
  await leaveCircle(a, { force: true });
  assert.equal(a.circle, null);
  globalThis.fetch = real;
});

test('identité : identifiants aléatoires, au bon format', () => {
  const a = newIdentity();
  assert.match(a.mid, /^[0-9a-f]{16}$/);
  assert.match(a.key, /^[0-9a-f]{64}$/);
  assert.notEqual(a.mid, newIdentity().mid);
});

import { buildPayload, applyPayload, mergePayloads } from '../js/sync.js';
import { sanitizeCircle } from '../js/store.js';

test('synchronisation : l’identité du cercle suit mes appareils, pas ce qui est propre à chacun', () => {
  const identity = { code: '1234567890123456', mid: 'a'.repeat(16), key: 'b'.repeat(64), cn: 'La famille', joinedAt: 1763500000000 };
  const a = phone('Léa', [0], { prefsAt: 100, settings: { goalMin: 5, presetId: 'long', minutes: 5 }, circle: { ...identity, sent: { 'x:nudge': TODAY }, cache: { at: 1, members: [] }, published: { text: 't', at: 1 } } });
  const p = buildPayload(a);
  assert.deepEqual(p.prefs.circle, identity, 'seule l’identité voyage, pas le cache ni les signes envoyés');
  // Un second appareil l'adopte
  const b = phone('', [], { settings: { goalMin: 5, presetId: 'long', minutes: 5 } });
  applyPayload(b, p);
  assert.equal(b.circle.mid, identity.mid);
  assert.equal(b.circle.code, identity.code);
  assert.deepEqual(b.circle.sent, {});
  // Même cercle déjà connu : on garde ce qui est propre à l'appareil
  b.circle.sent = { 'y:cheer': TODAY };
  applyPayload(b, p);
  assert.deepEqual(b.circle.sent, { 'y:cheer': TODAY });
  // Quitter le cercle sur un appareil (plus récent) le fait quitter partout
  const left = buildPayload({ ...a, circle: null, prefsAt: 200 });
  assert.equal(mergePayloads(p, left).prefs.circle, null);
  applyPayload(b, mergePayloads(p, left));
  assert.equal(b.circle, null);
});

test('réglages : un cercle abîmé est ignoré au lieu de faire planter l’app', () => {
  assert.equal(sanitizeCircle(null), null);
  assert.equal(sanitizeCircle({ code: '1', mid: 'x', key: 'y' }), null);
  assert.equal(sanitizeCircle('texte'), null);
  const ok = sanitizeCircle({ code: '1234567890123456', mid: 'a'.repeat(16), key: 'b'.repeat(64), cn: 5, sent: 'oups' });
  assert.equal(ok.cn, '');
  assert.deepEqual(ok.sent, {});
});

import { peekCircle } from '../js/circle.js';

test('invitation : on voit le cercle et ses membres avant de le rejoindre, sans s’y inscrire', async () => {
  installServer();
  const lea = phone('Léa');
  await createCircle(lea, { name: 'Léa', circleName: 'La famille' }, TODAY);
  const paul = phone('Paul');
  await joinCircle(paul, lea.circle.code, { name: 'Paul' }, TODAY);
  const peek = await peekCircle(lea.circle.code);
  assert.equal(peek.cn, 'La famille');
  assert.deepEqual(peek.names.sort(), ['Léa', 'Paul']);
  assert.equal(peek.full, false);
  assert.equal((await fetchCircle(lea)).members.length, 2, 'regarder n’inscrit personne');
  await assert.rejects(() => peekCircle('0000000000000000'), (e) => e.code === 'unknown');
  await assert.rejects(() => peekCircle('12'), (e) => e.code === 'invalid');
});

import { circleSeries, weekOverview, missingText, seriesLine, sinceLabel, dayActive } from '../js/circle.js';

// Un cercle de test : chacun avec ses jours de pratique (décalages par rapport à aujourd'hui) et sa date d'arrivée.
const person = (name, offs, { since = -30, me = false } = {}) => ({
  mid: name, me,
  status: parseStatus(buildStatus({ name, sessions: offs.map((o) => sess(o)), circle: { joinedAt: Date.parse(`${addDays(TODAY, since)}T12:00:00`) } }, TODAY)),
});

test('série du cercle : un jour compte quand tout le monde a respiré, la série compte les jours d’affilée', () => {
  const both = (...offs) => [person('Léa', offs, { me: true }), person('Paul', offs)];
  const s = circleSeries(both(0, -1, -2), TODAY);
  assert.equal(s.days, 3);
  assert.equal(s.todayValid, true);
  assert.deepEqual([s.done, s.total, s.missing.length], [2, 2, 0]);
  // Un seul manque à l'appel aujourd'hui : la série tient, mais aujourd'hui n'est pas validé
  const one = circleSeries([person('Léa', [0, -1, -2], { me: true }), person('Paul', [-1, -2])], TODAY);
  assert.equal(one.days, 2, 'aujourd’hui n’est pas encore perdu : on compte depuis hier');
  assert.equal(one.todayValid, false);
  assert.deepEqual(one.missing, [{ name: 'Paul', me: false }]);
  // Un jour manqué par l'un d'eux casse la série là
  const gap = circleSeries([person('Léa', [0, -1, -2, -3], { me: true }), person('Paul', [0, -1, -3])], TODAY);
  assert.equal(gap.days, 2);
  assert.equal(circleSeries([person('Léa', [0], { me: true })], TODAY), null, 'seul : pas de série du cercle');
  // Au plus quatre semaines
  const long = Array.from({ length: 40 }, (_, i) => -i);
  assert.equal(circleSeries(both(...long), TODAY).days, 28);
});

test('série du cercle : quelqu’un qui arrive ne compte pas contre les jours d’avant son arrivée', () => {
  const lea = person('Léa', [0, -1, -2, -3], { me: true, since: -10 });
  const nouveau = person('Nina', [0, -1], { since: -1 }); // arrivée hier
  const s = circleSeries([lea, nouveau], TODAY);
  assert.equal(s.days, 2, 'hier et aujourd’hui, à deux ; avant, Nina n’était pas là (et Léa seule ne fait pas un jour du cercle)');
  assert.equal(s.total, 2);
});

test('série du cercle : une version plus ancienne (sans les 28 jours) ne fausse rien', () => {
  const old = { mid: 'Vieux', me: false, status: parseStatus({ name: 'Vieux', streak: 5, last: TODAY, day: TODAY, week: '0111000' }) }; // jeudi, mercredi, mardi
  assert.equal(dayActive(old.status, TODAY), true);
  assert.equal(dayActive(old.status, addDays(TODAY, -1)), true);
  assert.equal(dayActive(old.status, addDays(TODAY, -3)), false, 'lundi : le point de la semaine dit non');
  assert.equal(dayActive(old.status, addDays(TODAY, -10)), null, 'avant la semaine : on ne sait pas');
  const s = circleSeries([person('Léa', [0, -1, -2, -3, -4, -5], { me: true }), old], TODAY);
  assert.equal(s.days, 3, 'on s’arrête là où l’on ne sait plus (mardi, mercredi, jeudi)');
});

test('semaine du cercle : la part qui a respiré chaque jour, validé quand tous', () => {
  const week = weekOverview([person('Léa', [0, -1, -2], { me: true }), person('Paul', [0, -2])], TODAY);
  assert.equal(week.length, 7);
  const byKey = Object.fromEntries(week.map((d) => [d.key, d]));
  assert.deepEqual([byKey[TODAY].valid, byKey[TODAY].fill, byKey[TODAY].today], [true, 1, true]);
  assert.deepEqual([byKey[addDays(TODAY, -1)].valid, byKey[addDays(TODAY, -1)].fill], [false, 0.5], 'un sur deux hier');
  assert.deepEqual([byKey[addDays(TODAY, -2)].valid, byKey[addDays(TODAY, -2)].fill], [true, 1]);
  assert.ok(byKey[addDays(TODAY, 1)].future);
  assert.equal(byKey[addDays(TODAY, 1)].fill, 0);
});

test('phrases : qui manque, en parlant à la personne concernée', () => {
  assert.equal(missingText([{ name: 'Dorina', me: false }]), 'il manque Dorina');
  assert.equal(missingText([{ name: 'Anthony', me: true }]), 'il ne manque que toi');
  assert.equal(missingText([{ name: 'Dorina', me: false }, { name: 'Anthony', me: true }]), 'il manque Dorina et toi');
  assert.equal(missingText([{ name: 'A', me: false }, { name: 'B', me: false }, { name: 'C', me: false }]), 'il manque 3 personnes');
  const base = { days: 3, todayValid: false, done: 1, total: 2, missing: [{ name: 'Dorina', me: false }] };
  assert.equal(seriesLine(base), 'Série du cercle : 3 jours · il manque Dorina');
  assert.equal(seriesLine({ ...base, todayValid: true, missing: [] }), 'Série du cercle : 3 jours ✨');
  assert.equal(seriesLine({ ...base, days: 0 }), 'Il manque Dorina pour lancer la série du cercle');
  assert.equal(seriesLine({ ...base, days: 1, todayValid: true, missing: [] }), 'Jour validé ✨ La série du cercle démarre');
  assert.equal(seriesLine(null), '');
});

test('dernière séance : hier, il y a 6 j', () => {
  assert.equal(sinceLabel(TODAY, TODAY), 'aujourd’hui');
  assert.equal(sinceLabel(addDays(TODAY, -1), TODAY), 'hier');
  assert.equal(sinceLabel(addDays(TODAY, -6), TODAY), 'il y a 6 j');
  assert.equal(sinceLabel('', TODAY), '');
});

// ---------- Les fantômes ne bloquent jamais la série ----------

import { PAUSE_DAYS, todayLine, memberView as viewOf } from '../js/circle.js';

const run = (...offs) => offs;
const daily = Array.from({ length: 30 }, (_, i) => -i);

test('fantômes : une fiche qui n’a jamais respiré (un doublon, quelqu’un parti) ne bloque pas la série', () => {
  const members = [person('Léa', daily, { me: true }), person('Paul', daily), person('Fantôme', [], { since: -5 })];
  const s = circleSeries(members, TODAY);
  assert.equal(s.days, 28, 'la série continue sans lui');
  assert.equal(s.todayValid, true);
  assert.deepEqual([s.done, s.total], [2, 2], 'il n’est pas compté dans le cercle du jour');
  assert.equal(viewOf(members[2].status, TODAY).paused, true);
  assert.equal(viewOf(members[0].status, TODAY).paused, false);
});

test('fantômes : sans séance depuis plus de 14 jours, on est en pause ; avant, on compte encore', () => {
  const lea = person('Léa', daily, { me: true });
  const paul = person('Paul', daily);
  const tired = (ago) => person('Max', Array.from({ length: 5 }, (_, i) => -(ago + i)));
  // 10 jours sans respirer : il compte, et il manque
  const recent = circleSeries([lea, paul, tired(10)], TODAY);
  assert.equal(recent.days, 0, 'il a manqué hier : la série du cercle est cassée');
  assert.ok(recent.missing.some((m) => m.name === 'Max'));
  assert.equal(viewOf(tired(10).status, TODAY).paused, false);
  // 20 jours : en pause, la série ne le compte plus
  const gone = tired(PAUSE_DAYS + 6);
  assert.equal(viewOf(gone.status, TODAY).paused, true);
  const s = circleSeries([lea, paul, gone], TODAY);
  assert.equal(s.todayValid, true);
  assert.equal(s.days, 7, 'tant qu’il comptait encore (jusqu’à 14 jours après sa dernière séance), la série était cassée : elle repart d’il y a 6 jours');
  assert.deepEqual(s.missing, []);
});

test('fantômes : quelqu’un qui arrive ne gêne rien avant sa première séance, ni après (il ne casse pas le passé)', () => {
  const base = [person('Léa', daily, { me: true }), person('Paul', daily)];
  const alone = circleSeries(base, TODAY).days;
  // Il vient de rejoindre et n'a encore rien fait : la série ne bouge pas.
  const newcomer = person('Nina', [], { since: -2 });
  assert.equal(circleSeries([...base, newcomer], TODAY).days, alone);
  // Première séance aujourd'hui : il compte aujourd'hui, mais n'a pas cassé les jours d'avant.
  const first = person('Nina', [0], { since: -2 });
  const s = circleSeries([...base, first], TODAY);
  assert.equal(s.days, alone);
  assert.equal(s.total, 3);
  // Il respire un jour sur deux : dès le lendemain d'un jour manqué, la série du cercle casse comme pour tout le monde.
  const spotty = person('Nina', [0, -2], { since: -4 });
  assert.equal(circleSeries([...base, spotty], addDays(TODAY, 0)).days, 1, 'hier manqué par quelqu’un qui compte : on repart d’aujourd’hui');
});

test('fantômes : quelqu’un qui revient après une longue absence ne casse pas la série qui a continué sans lui', () => {
  // Max a respiré il y a 25 à 30 jours, puis revient aujourd'hui.
  const max = person('Max', [0, -25, -26, -27, -28, -29, -30], { since: -40 });
  const s = circleSeries([person('Léa', daily, { me: true }), person('Paul', daily), max], TODAY);
  assert.equal(s.todayValid, true);
  assert.equal(s.days, 12, 'de -11 à aujourd’hui : avant, Max comptait encore (14 jours après sa dernière séance) et manquait');
});

test('fantômes : seul avec des fiches en pause, la série attend quelqu’un d’autre (pas de « il manque 0 personne »)', () => {
  const s = circleSeries([person('Léa', [0, -1], { me: true }), person('Fantôme', [], { since: -3 })], TODAY);
  assert.equal(s.total, 1);
  assert.equal(s.todayValid, false);
  assert.deepEqual(s.missing, []);
  assert.equal(todayLine(s), 'La série démarre dès que quelqu’un d’autre respire');
  assert.equal(seriesLine(s), 'La série du cercle démarre dès que quelqu’un d’autre respire');
});

test('fantômes : une fiche d’une ancienne version (sans les 28 jours) n’est pas écartée à tort', () => {
  const p = person('Vieux', [-20], { since: -40 });
  p.status.acts = ''; // ancienne application : seulement la semaine en cours
  assert.equal(viewOf(p.status, TODAY).paused, false, 'on ne sait pas : on ne l’écarte pas');
});
