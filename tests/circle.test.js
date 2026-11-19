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
  assert.deepEqual(Object.keys(s).sort(), ['best', 'cn', 'day', 'last', 'name', 'streak', 'v', 'week']);
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
  const identity = { code: '1234567890123456', mid: 'a'.repeat(16), key: 'b'.repeat(64), cn: 'La famille' };
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
