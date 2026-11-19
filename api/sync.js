// API de synchronisation : un seul point d'entrée, en POST, qui ne manipule que du texte chiffré.
// Aucun secret dans l'adresse (tout est dans le corps de la requête) : l'identifiant n'apparaît pas dans les journaux.
//
//   { op: 'get',    id }                → 200 { rev, blob, at } | 404
//   { op: 'put',    id, rev, blob }     → 200 { rev } | 409 { rev, blob } si un autre appareil a écrit entre-temps
//   { op: 'delete', id }                → 200 { ok: true }

import { createStore } from './_store.js';

const MAX_BYTES = 512 * 1024;
const ID_RE = /^[0-9a-f]{64}$/;

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BYTES + 4096) throw new Error('trop gros');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

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
    const key = `respire:sync:${id}`;

    try {
      if (op === 'get') {
        const rec = await store.get(key);
        return rec ? send(200, rec) : send(404, { error: 'not_found' });
      }
      if (op === 'put') {
        const { rev, blob } = body;
        if (!Number.isInteger(rev) || rev < 0) return send(400, { error: 'rev' });
        if (!blob || typeof blob.iv !== 'string' || typeof blob.ct !== 'string') return send(400, { error: 'blob' });
        if (blob.iv.length + blob.ct.length > MAX_BYTES) return send(413, { error: 'too_large' });
        const next = { rev: rev + 1, blob: { iv: blob.iv, ct: blob.ct }, at: Date.now() };
        const result = await store.cas(key, rev, next);
        if (result.ok) return send(200, { rev: next.rev });
        return send(409, { error: 'conflict', rev: result.current?.rev ?? 0, blob: result.current?.blob ?? null });
      }
      if (op === 'delete') {
        await store.del(key);
        return send(200, { ok: true });
      }
      return send(400, { error: 'op' });
    } catch (e) {
      console.error('sync: erreur de stockage :', e?.message); // visible dans les journaux Vercel (sans données)
      return send(502, { error: 'store' });
    }
  };
}

export default createHandler(createStore());
