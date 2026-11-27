// API des cercles : voir qui, parmi ses proches, a respiré aujourd'hui. Un seul point d'entrée, en POST.
//
// Anonyme et chiffré de bout en bout, comme la synchronisation : le serveur ne garde que du texte chiffré avec la clé du
// cercle (que seuls les membres connaissent) et des identifiants aléatoires. Il ne sait ni qui est qui, ni ce que
// disent les statuts. Chaque membre a une clé d'écriture : le serveur n'en garde que l'empreinte, et personne
// d'autre qu'un membre ne peut modifier sa fiche.
//
//   { op: 'put',   id, mid, key, blob }          → crée le cercle au besoin, enregistre ou met à jour ma fiche
//   { op: 'get',   id, me? }                     → { rev, members: [{ mid, blob, at }], inbox: [{ f, blob, at }] }
//   { op: 'send',  id, from, key, to, blob }     → dépose un petit message (signe, bravo) dans la boîte de `to`
//   { op: 'ack',   id, mid, key, upTo }          → vide ma boîte jusqu'à cette date
//   { op: 'leave', id, mid, key }                → me retire du cercle (et le supprime s'il est vide)

import { createHash, timingSafeEqual } from 'node:crypto';
import { createStore } from './_store.js';

const ID_RE = /^[0-9a-f]{64}$/; // adresse du cercle : dérivée du code, qui ne peut pas en être retrouvé
const MID_RE = /^[0-9a-f]{16}$/; // identifiant aléatoire d'un membre
const KEY_RE = /^[0-9a-f]{64}$/; // clé d'écriture d'un membre

export const LIMITS = {
  members: 12,
  status: 1600, // taille maximale d'un statut chiffré (iv + texte)
  event: 800, // taille maximale d'un message chiffré
  inbox: 20, // messages gardés par membre
  tooSoonMs: 60 * 60 * 1000, // un même membre ne peut écrire qu'une fois par heure à un autre
  ttlSeconds: 60 * 60 * 24 * 90, // un cercle sans écriture pendant 90 jours disparaît
  staleMs: 45 * 24 * 60 * 60 * 1000, // une fiche muette depuis 45 jours (app désinstallée, doublon abandonné) est retirée
  body: 24 * 1024,
};
const RETRIES = 10;

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > LIMITS.body) throw new Error('trop gros');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const hashKey = (key) => createHash('sha256').update(key).digest('hex');
const sameHash = (a, b) => {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
};
const isStale = (m, now) => now - m.at > LIMITS.staleMs;
/** Retire les fiches muettes depuis trop longtemps (et leur boîte) : elles ne gardent ni une place ni la série. */
const prune = (doc, now) => {
  for (const [mid, m] of Object.entries(doc.members)) {
    if (isStale(m, now)) {
      delete doc.members[mid];
      delete doc.inbox[mid];
    }
  }
};
const validBlob = (b, max) => !!b && typeof b.iv === 'string' && typeof b.ct === 'string' && b.iv.length + b.ct.length <= max && b.iv.length > 0 && b.ct.length > 0;

export function createHandler(store) {
  return async function handler(req, res) {
    const send = (status, body) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify(body));
    };
    if (req.method !== 'POST') return send(405, { error: 'method' });
    if (!store) return send(503, { error: 'not_configured' });

    let body = req.body;
    try {
      if (body === undefined) body = await readJson(req);
      else if (typeof body === 'string') body = JSON.parse(body);
    } catch {
      return send(400, { error: 'json' });
    }
    if (!body || typeof body !== 'object') return send(400, { error: 'body' });

    const { op, id } = body;
    if (typeof id !== 'string' || !ID_RE.test(id)) return send(400, { error: 'id' });
    const dbKey = `respire:circle:${id}`;

    /** Lit, modifie et réécrit la fiche du cercle de façon atomique ; réessaie si quelqu'un a écrit entre-temps. */
    const mutate = async (change) => {
      for (let i = 0; i < RETRIES; i++) {
        const rec = await store.get(dbKey);
        const doc = rec ?? { rev: 0, members: {}, inbox: {} };
        prune(doc, Date.now());
        const out = change(doc);
        if (out.error) return send(out.error[0], { error: out.error[1] });
        if (out.remove) {
          await store.del(dbKey);
          return send(200, out.result);
        }
        const next = { rev: doc.rev + 1, members: doc.members, inbox: doc.inbox };
        const result = await store.cas(dbKey, doc.rev, next, LIMITS.ttlSeconds);
        if (result.ok) return send(200, out.result);
        await new Promise((r) => setTimeout(r, 4 + Math.random() * 12 * (i + 1))); // chacun son tour : on évite de se heurter à nouveau
      }
      return send(409, { error: 'conflict' });
    };
    const auth = (doc, mid, key) => {
      const m = doc.members[mid];
      if (!m) return [404, 'unknown_member'];
      return sameHash(m.h, hashKey(key)) ? null : [403, 'forbidden'];
    };
    const idsOk = (...pairs) => pairs.every(([v, re]) => typeof v === 'string' && re.test(v));

    try {
      if (op === 'get') {
        const rec = await store.get(dbKey);
        if (!rec) return send(404, { error: 'not_found' });
        const me = typeof body.me === 'string' && MID_RE.test(body.me) ? body.me : null;
        const now = Date.now();
        const live = Object.entries(rec.members).filter(([, m]) => !isStale(m, now)); // les fiches muettes ne s'affichent plus
        return send(200, {
          rev: rec.rev,
          members: live.map(([mid, m]) => ({ mid, blob: m.blob, at: m.at })),
          inbox: me ? rec.inbox[me] ?? [] : [],
        });
      }

      if (op === 'put') {
        const { mid, key, blob } = body;
        if (!idsOk([mid, MID_RE], [key, KEY_RE])) return send(400, { error: 'ids' });
        if (!validBlob(blob, LIMITS.status)) return send(400, { error: 'blob' });
        return mutate((doc) => {
          const known = doc.members[mid];
          if (known) {
            const bad = auth(doc, mid, key);
            if (bad) return { error: bad };
          } else if (Object.keys(doc.members).length >= LIMITS.members) {
            return { error: [403, 'full'] };
          }
          doc.members[mid] = { h: known ? known.h : hashKey(key), blob: { iv: blob.iv, ct: blob.ct }, at: Date.now() };
          return { result: { ok: true, count: Object.keys(doc.members).length } };
        });
      }

      if (op === 'send') {
        const { from, key, to, blob } = body;
        if (!idsOk([from, MID_RE], [key, KEY_RE], [to, MID_RE])) return send(400, { error: 'ids' });
        if (from === to) return send(400, { error: 'self' });
        if (!validBlob(blob, LIMITS.event)) return send(400, { error: 'blob' });
        return mutate((doc) => {
          const bad = auth(doc, from, key);
          if (bad) return { error: bad };
          if (!doc.members[to]) return { error: [404, 'unknown_member'] };
          const now = Date.now();
          const box = doc.inbox[to] ?? [];
          if (box.some((e) => e.f === from && now - e.at < LIMITS.tooSoonMs)) return { error: [429, 'too_soon'] };
          box.push({ f: from, blob: { iv: blob.iv, ct: blob.ct }, at: now });
          doc.inbox[to] = box.slice(-LIMITS.inbox);
          return { result: { ok: true } };
        });
      }

      if (op === 'ack') {
        const { mid, key, upTo } = body;
        if (!idsOk([mid, MID_RE], [key, KEY_RE]) || !Number.isFinite(upTo)) return send(400, { error: 'ids' });
        return mutate((doc) => {
          const bad = auth(doc, mid, key);
          if (bad) return { error: bad };
          doc.inbox[mid] = (doc.inbox[mid] ?? []).filter((e) => e.at > upTo);
          if (!doc.inbox[mid].length) delete doc.inbox[mid];
          return { result: { ok: true } };
        });
      }

      if (op === 'leave') {
        const { mid, key } = body;
        if (!idsOk([mid, MID_RE], [key, KEY_RE])) return send(400, { error: 'ids' });
        return mutate((doc) => {
          const bad = auth(doc, mid, key);
          if (bad) return { error: bad };
          delete doc.members[mid];
          delete doc.inbox[mid];
          for (const box of Object.values(doc.inbox)) for (let i = box.length - 1; i >= 0; i--) if (box[i].f === mid) box.splice(i, 1);
          return Object.keys(doc.members).length ? { result: { ok: true } } : { remove: true, result: { ok: true } };
        });
      }

      return send(400, { error: 'op' });
    } catch (e) {
      console.error('circle: erreur de stockage :', e?.message); // visible dans les journaux Vercel (sans données)
      return send(502, { error: 'store' });
    }
  };
}

export default createHandler(createStore());
