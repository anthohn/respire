import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../api/sync.js';
import { memoryStore } from '../api/_store.js';
import {
  generateCode, normalizeCode, formatCode, deriveKeys, encryptPayload, decryptPayload,
  buildPayload, mergePayloads, samePayload, syncNow, enableSync, joinWithCode, deleteRemote, SyncError,
} from '../js/sync.js';

// Un « serveur » en mémoire, branché sur fetch : les deux appareils parlent à la même API, sans réseau.
function installServer(store = memoryStore()) {
  const handler = createHandler(store);
  const seen = []; // tout ce que le serveur reçoit
  globalThis.fetch = async (_url, opts) => {
    const body = JSON.parse(opts.body);
    seen.push(opts.body);
    return await new Promise((resolve) => {
      const res = {
        statusCode: 200,
        headers: {},
        setHeader(k, v) { this.headers[k] = v; },
        end(text) { resolve({ status: this.statusCode, json: async () => JSON.parse(text) }); },
      };
      handler({ method: 'POST', body }, res);
    });
  };
  return { store, seen };
}

const session = (id, extra = {}) => ({ id, ts: `2026-11-${id.slice(1).padStart(2, '0')}T08:00:00.000Z`, date: `2026-11-${id.slice(1).padStart(2, '0')}`, seconds: 300, cycles: 30, preset: 'long', completed: true, ...extra });
const device = (over = {}) => ({
  onboarded: true, name: '', sessions: [], seenBadges: [], prefsAt: 0, sync: null,
  settings: { goalMin: 5, presetId: 'long', minutes: 5, sound: false, theme: 'auto' }, ...over,
});

test('code : 16 chiffres au hasard, lisible et tolérant à la saisie', () => {
  const a = generateCode();
  assert.match(a, /^\d{16}$/);
  assert.notEqual(a, generateCode());
  assert.equal(formatCode('4821903477162290'), '4821 9034 7716 2290');
  assert.equal(normalizeCode('4821 9034 7716 2290'), '4821903477162290');
  assert.equal(normalizeCode('4821-9034-7716-2290'), '4821903477162290');
  assert.equal(normalizeCode('4821 9034 7716 229'), null);
  assert.equal(normalizeCode('abcd'), null);
});

test('chiffrement : aller-retour, et le mauvais code ne déchiffre rien', async () => {
  const { key } = await deriveKeys('1111222233334444');
  const blob = await encryptPayload(key, { secret: 'respiration', n: 3 });
  assert.ok(!blob.ct.includes('respiration'));
  assert.deepEqual(await decryptPayload(key, blob), { secret: 'respiration', n: 3 });
  const other = await deriveKeys('1111222233334445');
  await assert.rejects(() => decryptPayload(other.key, blob), (e) => e instanceof SyncError && e.code === 'decrypt');
});

test('fusion : les sessions s’additionnent, sans doublon, et le ressenti est conservé', () => {
  const a = { ...buildPayload(device({ sessions: [session('s1'), session('s2')] })) };
  const b = { ...buildPayload(device({ sessions: [session('s2', { feeling: 'calm' }), session('s3')] })) };
  const m = mergePayloads(a, b);
  assert.deepEqual(m.sessions.map((s) => s.id), ['s1', 's2', 's3']);
  assert.equal(m.sessions[1].feeling, 'calm');
  assert.ok(samePayload(mergePayloads(m, a), m), 'fusionner deux fois ne change rien');
});

test('fusion : pour les préférences, la plus récente gagne', () => {
  const a = buildPayload(device({ name: 'Ancien', prefsAt: 100, settings: { goalMin: 5, presetId: 'long', minutes: 5 } }));
  const b = buildPayload(device({ name: 'Nouveau', prefsAt: 200, settings: { goalMin: 10, presetId: 'calm', minutes: 3 } }));
  for (const m of [mergePayloads(a, b), mergePayloads(b, a)]) {
    assert.equal(m.prefs.name, 'Nouveau');
    assert.equal(m.prefs.goalMin, 10);
    assert.equal(m.prefsAt, 200);
  }
});

test('deux appareils : activer, rejoindre avec le code, puis rester à jour', async () => {
  const { seen } = installServer();
  const phone = device({ name: 'Anthony', prefsAt: 50, sessions: [session('s1'), session('s2')] });
  const code = await enableSync(phone);
  assert.match(code, /^\d{16}$/);
  assert.equal(phone.sync.rev, 1);

  const laptop = device({ sessions: [session('s9')] });
  const res = await joinWithCode(laptop, formatCode(code));
  assert.equal(res.changed, true);
  assert.deepEqual(laptop.sessions.map((s) => s.id), ['s1', 's2', 's9']);
  assert.equal(laptop.name, 'Anthony');

  // le téléphone récupère la session de l'ordinateur
  const back = await syncNow(phone);
  assert.equal(back.changed, true);
  assert.deepEqual(phone.sessions.map((s) => s.id), ['s1', 's2', 's9']);

  // une nouvelle session sur le téléphone arrive sur l'ordinateur
  phone.sessions.push(session('s10'));
  await syncNow(phone);
  await syncNow(laptop);
  assert.ok(laptop.sessions.some((s) => s.id === 's10'));

  // rien de lisible côté serveur : ni les sessions, ni le prénom, ni le code
  const all = seen.join('');
  assert.ok(!all.includes('Anthony') && !all.includes('"seconds"') && !all.includes(code));
});

test('synchroniser sans changement n’écrit rien', async () => {
  installServer();
  const d = device({ sessions: [session('s1')] });
  await enableSync(d);
  const rev = d.sync.rev;
  await syncNow(d);
  await syncNow(d);
  assert.equal(d.sync.rev, rev);
});

test('un code inconnu ou mal saisi ne crée jamais de compte', async () => {
  const { store } = installServer();
  const d = device();
  await assert.rejects(() => joinWithCode(d, '1234 5678 9012 3456'), (e) => e.code === 'unknown');
  await assert.rejects(() => joinWithCode(d, '123'), (e) => e.code === 'invalid');
  assert.equal(d.sync, null);
  const { id } = await deriveKeys('1234567890123456');
  assert.equal(await store.get(`respire:sync:${id}`), null);
});

test('écritures simultanées : le conflit est résolu sans rien perdre', async () => {
  installServer();
  const a = device({ sessions: [session('s1')] });
  const code = await enableSync(a);
  const b = device();
  await joinWithCode(b, code);
  a.sessions.push(session('s2'));
  b.sessions.push(session('s3'));
  await Promise.all([syncNow(a), syncNow(b)]);
  await syncNow(a);
  await syncNow(b);
  assert.deepEqual(a.sessions.map((s) => s.id), ['s1', 's2', 's3']);
  assert.deepEqual(b.sessions.map((s) => s.id), ['s1', 's2', 's3']);
});

test('supprimer côté serveur : le code ne retrouve plus rien', async () => {
  installServer();
  const a = device({ sessions: [session('s1')] });
  const code = await enableSync(a);
  await deleteRemote(a);
  await assert.rejects(() => joinWithCode(device(), code), (e) => e.code === 'unknown');
});

test('API : refuse les identifiants invalides, les mauvaises méthodes et les blobs trop gros', async () => {
  const handler = createHandler(memoryStore());
  const call = (req) => new Promise((resolve) => {
    const res = { statusCode: 200, setHeader() {}, end(t) { resolve({ status: this.statusCode, body: JSON.parse(t) }); } };
    handler(req, res);
  });
  const id = 'a'.repeat(64);
  assert.equal((await call({ method: 'GET' })).status, 405);
  assert.equal((await call({ method: 'POST', body: { op: 'get', id: 'x' } })).status, 400);
  assert.equal((await call({ method: 'POST', body: { op: 'get', id } })).status, 404);
  assert.equal((await call({ method: 'POST', body: { op: 'put', id, rev: 0, blob: { iv: 'a', ct: 'b'.repeat(600000) } } })).status, 413);
  assert.equal((await call({ method: 'POST', body: { op: 'put', id, rev: 0, blob: { iv: 'a', ct: 'b' } } })).status, 200);
  assert.equal((await call({ method: 'POST', body: { op: 'put', id, rev: 0, blob: { iv: 'a', ct: 'c' } } })).status, 409);
  const noStore = createHandler(null);
  const r = await new Promise((resolve) => noStore({ method: 'POST', body: { op: 'get', id } }, { statusCode: 200, setHeader() {}, end(t) { resolve({ status: this.statusCode }); } }));
  assert.equal(r.status, 503);
});
