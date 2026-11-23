import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createHandler, LIMITS } from '../api/circle.js';
import { memoryStore } from '../api/_store.js';

const hex = (n, seed) => createHash('sha256').update(String(seed)).digest('hex').slice(0, n);
const ID = hex(64, 'a');
const member = (n) => ({ mid: hex(16, String(n)), key: hex(64, `k${n}`) });
const blob = (text = 'x') => ({ iv: 'aXY=', ct: Buffer.from(text).toString('base64') });

function setup(store = memoryStore()) {
  const handler = createHandler(store);
  const call = (body, method = 'POST') =>
    new Promise((resolve) => {
      const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(text) { resolve({ status: this.statusCode, body: JSON.parse(text) }); } };
      handler({ method, body }, res);
    });
  return { store, call };
}

test('cercle : le premier membre le crée, les autres le rejoignent, tous se voient', async () => {
  const { call } = setup();
  const [a, b] = [member(1), member(2)];
  assert.equal((await call({ op: 'get', id: ID })).status, 404, 'cercle inconnu');
  assert.deepEqual((await call({ op: 'put', id: ID, ...a, blob: blob('statut A') })).body, { ok: true, count: 1 });
  assert.deepEqual((await call({ op: 'put', id: ID, ...b, blob: blob('statut B') })).body, { ok: true, count: 2 });
  const got = (await call({ op: 'get', id: ID })).body;
  assert.equal(got.members.length, 2);
  assert.deepEqual(got.members.map((m) => m.mid).sort(), [a.mid, b.mid].sort());
  assert.ok(got.members.every((m) => m.blob.iv && m.blob.ct && m.at > 0));
  assert.ok(!JSON.stringify(got).includes(a.key), 'la clé d’écriture ne ressort jamais');
});

test('cercle : seul un membre peut modifier sa fiche (clé d’écriture)', async () => {
  const { call } = setup();
  const [a, b] = [member(1), member(2)];
  await call({ op: 'put', id: ID, ...a, blob: blob('A') });
  await call({ op: 'put', id: ID, ...b, blob: blob('B') });
  // B tente d'écraser la fiche de A : avec sa propre clé, avec une clé quelconque
  assert.equal((await call({ op: 'put', id: ID, mid: a.mid, key: b.key, blob: blob('piraté') })).status, 403);
  assert.equal((await call({ op: 'put', id: ID, mid: a.mid, key: hex(64, 'z'), blob: blob('piraté') })).status, 403);
  const got = (await call({ op: 'get', id: ID })).body.members.find((m) => m.mid === a.mid);
  assert.equal(Buffer.from(got.blob.ct, 'base64').toString(), 'A', 'la fiche de A est intacte');
  // A met à jour la sienne
  assert.equal((await call({ op: 'put', id: ID, ...a, blob: blob('A2') })).status, 200);
  const after = (await call({ op: 'get', id: ID })).body.members.find((m) => m.mid === a.mid);
  assert.equal(Buffer.from(after.blob.ct, 'base64').toString(), 'A2');
});

test('cercle : le serveur ne garde que l’empreinte de la clé d’écriture', async () => {
  const { call, store } = setup();
  const a = member(1);
  await call({ op: 'put', id: ID, ...a, blob: blob() });
  const doc = JSON.stringify(await store.get(`respire:circle:${ID}`));
  assert.ok(!doc.includes(a.key), 'pas de clé en clair');
  assert.ok(doc.includes(a.mid));
});

test('cercle : douze membres au plus, les membres existants continuent à écrire', async () => {
  const { call } = setup();
  for (let i = 1; i <= LIMITS.members; i++) assert.equal((await call({ op: 'put', id: ID, ...member(i), blob: blob() })).status, 200);
  const full = await call({ op: 'put', id: ID, ...member(99), blob: blob() });
  assert.equal(full.status, 403);
  assert.equal(full.body.error, 'full');
  assert.equal((await call({ op: 'put', id: ID, ...member(3), blob: blob('encore') })).status, 200);
});

test('cercle : écritures simultanées, personne n’est perdu', async () => {
  const { call } = setup();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => call({ op: 'put', id: ID, ...member(i + 1), blob: blob(`m${i}`) })));
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(results.map((r) => r.status)));
  assert.equal((await call({ op: 'get', id: ID })).body.members.length, 8);
});

test('signes : déposés dans la boîte du destinataire seulement, un par heure et par expéditeur', async () => {
  const { call } = setup();
  const [a, b, c] = [member(1), member(2), member(3)];
  for (const m of [a, b, c]) await call({ op: 'put', id: ID, ...m, blob: blob() });
  assert.equal((await call({ op: 'send', id: ID, from: a.mid, key: a.key, to: b.mid, blob: blob('👋') })).status, 200);
  assert.equal((await call({ op: 'send', id: ID, from: a.mid, key: a.key, to: b.mid, blob: blob('re') })).status, 429, 'trop tôt');
  assert.equal((await call({ op: 'send', id: ID, from: c.mid, key: c.key, to: b.mid, blob: blob('👏') })).status, 200, 'un autre expéditeur passe');
  const inboxB = (await call({ op: 'get', id: ID, me: b.mid })).body.inbox;
  assert.deepEqual(inboxB.map((e) => e.f).sort(), [a.mid, c.mid].sort());
  assert.equal((await call({ op: 'get', id: ID, me: a.mid })).body.inbox.length, 0, 'la boîte de A est vide');
  assert.equal((await call({ op: 'get', id: ID })).body.inbox.length, 0, 'sans « me », pas de boîte');
});

test('signes : refusés sans clé valide, vers un inconnu ou vers soi-même', async () => {
  const { call } = setup();
  const [a, b] = [member(1), member(2)];
  await call({ op: 'put', id: ID, ...a, blob: blob() });
  await call({ op: 'put', id: ID, ...b, blob: blob() });
  assert.equal((await call({ op: 'send', id: ID, from: a.mid, key: b.key, to: b.mid, blob: blob() })).status, 403);
  assert.equal((await call({ op: 'send', id: ID, from: a.mid, key: a.key, to: member(9).mid, blob: blob() })).status, 404);
  assert.equal((await call({ op: 'send', id: ID, from: member(9).mid, key: member(9).key, to: b.mid, blob: blob() })).status, 404, 'expéditeur inconnu');
  assert.equal((await call({ op: 'send', id: ID, from: a.mid, key: a.key, to: a.mid, blob: blob() })).status, 400);
});

test('signes : la boîte garde les plus récents, et « ack » la vide', async () => {
  const { call, store } = setup();
  const target = member(1);
  await call({ op: 'put', id: ID, ...target, blob: blob() });
  const senders = Array.from({ length: LIMITS.inbox + 5 }, (_, i) => member(i + 2));
  // On écrit directement dans la fiche (douze membres au plus par l'API) pour tester le plafond de la boîte.
  const key = `respire:circle:${ID}`;
  const doc = await store.get(key);
  doc.inbox[target.mid] = senders.map((s, i) => ({ f: s.mid, blob: blob(`e${i}`), at: 1000 + i }));
  await store.cas(key, doc.rev, { ...doc, rev: doc.rev + 1 });
  await call({ op: 'put', id: ID, ...member(40), blob: blob() });
  assert.equal((await call({ op: 'send', id: ID, from: member(40).mid, key: member(40).key, to: target.mid, blob: blob('dernier') })).status, 200);
  const box = (await call({ op: 'get', id: ID, me: target.mid })).body.inbox;
  assert.equal(box.length, LIMITS.inbox, 'plafonnée');
  assert.equal(Buffer.from(box.at(-1).blob.ct, 'base64').toString(), 'dernier');
  // ack : seulement avec la bonne clé, et seulement jusqu'à la date donnée
  assert.equal((await call({ op: 'ack', id: ID, mid: target.mid, key: member(40).key, upTo: Date.now() })).status, 403);
  assert.equal((await call({ op: 'ack', id: ID, mid: target.mid, key: target.key, upTo: box[3].at })).status, 200);
  assert.equal((await call({ op: 'get', id: ID, me: target.mid })).body.inbox.length, LIMITS.inbox - 4);
  await call({ op: 'ack', id: ID, mid: target.mid, key: target.key, upTo: Date.now() + 10 });
  assert.equal((await call({ op: 'get', id: ID, me: target.mid })).body.inbox.length, 0);
});

test('quitter : retire la fiche et les messages envoyés ; le dernier membre supprime le cercle', async () => {
  const { call, store } = setup();
  const [a, b] = [member(1), member(2)];
  await call({ op: 'put', id: ID, ...a, blob: blob() });
  await call({ op: 'put', id: ID, ...b, blob: blob() });
  await call({ op: 'send', id: ID, from: a.mid, key: a.key, to: b.mid, blob: blob('👋') });
  assert.equal((await call({ op: 'leave', id: ID, mid: a.mid, key: b.key })).status, 403, 'pas à la place d’un autre');
  assert.equal((await call({ op: 'leave', id: ID, mid: a.mid, key: a.key })).status, 200);
  const got = (await call({ op: 'get', id: ID, me: b.mid })).body;
  assert.deepEqual(got.members.map((m) => m.mid), [b.mid]);
  assert.equal(got.inbox.length, 0, 'ses signes disparaissent avec lui');
  assert.equal((await call({ op: 'leave', id: ID, mid: b.mid, key: b.key })).status, 200);
  assert.equal(await store.get(`respire:circle:${ID}`), null, 'cercle vide = supprimé');
  assert.equal((await call({ op: 'get', id: ID })).status, 404);
});

test('validation : adresses, tailles, méthode, base absente', async () => {
  const { call } = setup();
  const a = member(1);
  assert.equal((await call({ op: 'put', id: 'court', ...a, blob: blob() })).status, 400);
  assert.equal((await call({ op: 'put', id: ID, mid: 'zz', key: a.key, blob: blob() })).status, 400);
  assert.equal((await call({ op: 'put', id: ID, mid: a.mid, key: 'zz', blob: blob() })).status, 400);
  assert.equal((await call({ op: 'put', id: ID, ...a, blob: { iv: 'a', ct: 'b'.repeat(LIMITS.status) } })).status, 400, 'statut trop gros');
  assert.equal((await call({ op: 'put', id: ID, ...a, blob: { iv: 'a' } })).status, 400);
  assert.equal((await call({ op: 'inconnue', id: ID })).status, 400);
  assert.equal((await call({ op: 'get', id: ID }, 'GET')).status, 405);
  const none = createHandler(null);
  const res = await new Promise((resolve) => {
    const r = { statusCode: 200, setHeader() {}, end(t) { resolve({ status: r.statusCode, body: JSON.parse(t) }); } };
    none({ method: 'POST', body: { op: 'get', id: ID } }, r);
  });
  assert.equal(res.body.error, 'not_configured');
});

test('fiches muettes : retirées après 45 jours (elles ne gardent ni une place ni la série), et un retour se réinscrit', async (t) => {
  const { call } = setup();
  const DAY = 24 * 60 * 60 * 1000;
  const T0 = Date.now();
  let now = T0;
  t.mock.method(Date, 'now', () => now);
  const [a, b, c] = [member(1), member(2), member(3)];
  await call({ op: 'put', id: ID, ...a, blob: blob('A') });
  now = T0 + 30 * DAY;
  await call({ op: 'put', id: ID, ...b, blob: blob('B') });
  now = T0 + 44 * DAY;
  assert.equal((await call({ op: 'get', id: ID })).body.members.length, 2, 'à 44 jours, A est encore là');
  now = T0 + 46 * DAY;
  const got = (await call({ op: 'get', id: ID })).body;
  assert.deepEqual(got.members.map((m) => m.mid), [b.mid], 'à 46 jours, la fiche de A ne s’affiche plus');
  // Une écriture la retire pour de bon, et libère sa place.
  await call({ op: 'put', id: ID, ...c, blob: blob('C') });
  assert.deepEqual((await call({ op: 'get', id: ID })).body.members.map((m) => m.mid).sort(), [b.mid, c.mid].sort());
  // A revient (il rouvre l'application) : il se réinscrit avec la même clé.
  assert.equal((await call({ op: 'put', id: ID, ...a, blob: blob('A de retour') })).status, 200);
  assert.equal((await call({ op: 'get', id: ID })).body.members.length, 3);
});

test('fiches muettes : elles libèrent leur place dans un cercle complet, et leur boîte avec', async (t) => {
  const { call } = setup();
  const DAY = 24 * 60 * 60 * 1000;
  const T0 = Date.now();
  let now = T0;
  t.mock.method(Date, 'now', () => now);
  for (let i = 1; i <= LIMITS.members; i++) await call({ op: 'put', id: ID, ...member(i), blob: blob(`M${i}`) });
  const extra = member(99);
  assert.equal((await call({ op: 'put', id: ID, ...extra, blob: blob('X') })).status, 403, 'complet');
  const [a, b] = [member(1), member(2)];
  await call({ op: 'send', id: ID, from: b.mid, key: b.key, to: a.mid, blob: blob('signe de B à A') });
  now = T0 + 40 * DAY;
  await call({ op: 'put', id: ID, ...b, blob: blob('B actif') }); // B reste actif, les autres se taisent
  now = T0 + 50 * DAY;
  assert.equal((await call({ op: 'put', id: ID, ...extra, blob: blob('X') })).status, 200, 'les fiches muettes ont libéré des places');
  const got = (await call({ op: 'get', id: ID, me: b.mid })).body;
  assert.deepEqual(got.members.map((m) => m.mid).sort(), [b.mid, extra.mid].sort());
  const store = await call({ op: 'get', id: ID, me: a.mid });
  assert.equal(store.body.inbox.length, 0, 'la boîte de la fiche retirée a disparu avec elle');
});
