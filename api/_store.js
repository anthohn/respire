// Stockage de la synchronisation. Le serveur ne garde que du texte chiffré (voir js/sync.js).
//
// - Production : base Redis « Upstash » (intégration Vercel Marketplace), via son API REST, sans dépendance.
// - Développement local : mémoire du processus (perdue à l'arrêt). Jamais utilisée en production.
// - Production sans base configurée : renvoie null, l'API répond « synchronisation non configurée ».

/** Une fiche sans écriture pendant 400 jours est supprimée. */
const TTL_SECONDS = 60 * 60 * 24 * 400;

export function createStore(env = process.env) {
  const url = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const token = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  if (url && token) return upstashStore(url, token);
  if (!env.VERCEL) return memoryStore();
  return null;
}

export function memoryStore() {
  const map = new Map();
  return {
    async get(key) {
      const v = map.get(key);
      return v ? JSON.parse(v) : null;
    },
    /** Écrit seulement si la révision actuelle est celle que le client a vue (évite d'écraser un autre appareil). */
    async cas(key, expectedRev, record, _ttl) {
      const cur = map.get(key);
      const curRev = cur ? JSON.parse(cur).rev : 0;
      if (curRev !== expectedRev) return { ok: false, current: cur ? JSON.parse(cur) : null };
      map.set(key, JSON.stringify(record));
      return { ok: true };
    },
    async del(key) {
      map.delete(key);
    },
  };
}

// Comparer-et-écrire en une seule opération atomique côté Redis.
const CAS_SCRIPT = `
local cur = redis.call('GET', KEYS[1])
local rev = 0
if cur then rev = tonumber(cjson.decode(cur).rev) end
if rev ~= tonumber(ARGV[1]) then return {0, cur or ''} end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
return {1, ''}`;

function upstashStore(url, token) {
  const run = async (command) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    if (!res.ok) throw new Error(`store ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
  };
  return {
    async get(key) {
      const v = await run(['GET', key]);
      return v ? JSON.parse(v) : null;
    },
    async cas(key, expectedRev, record, ttl = TTL_SECONDS) {
      const [ok, current] = await run(['EVAL', CAS_SCRIPT, '1', key, String(expectedRev), JSON.stringify(record), String(ttl)]);
      return ok === 1 ? { ok: true } : { ok: false, current: current ? JSON.parse(current) : null };
    },
    async del(key) {
      await run(['DEL', key]);
    },
  };
}
