// Synchronisation entre appareils, anonyme et chiffrée de bout en bout.
//
// - Le « compte » est un code de 16 chiffres tiré au hasard (comme Mullvad) : pas d'e-mail, pas de mot de passe.
// - Du code on dérive, avec PBKDF2 (lent exprès), un identifiant et une clé de chiffrement AES-GCM.
//   Le serveur ne voit que l'identifiant (qui ne permet pas de retrouver le code) et du texte chiffré.
// - La fusion ne perd jamais rien : les sessions de tous les appareils s'additionnent.

import { getPreset } from './breath.js';
import { sanitizeCircle } from './store.js';

const API = 'api/sync';
const SALT = 'respire-sync-v1';
const ITERATIONS = 600000; // rend chaque essai de code coûteux, même si la base de données fuitait
const CODE_LENGTH = 16;

export class SyncError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const SYNC_MESSAGES = {
  invalid: 'Code invalide : il faut 16 chiffres.',
  unknown: 'Aucune donnée trouvée pour ce code. Vérifie les chiffres.',
  offline: 'Pas de connexion. Réessaie plus tard.',
  not_configured: 'La synchronisation n’est pas encore activée sur ce serveur.',
  insecure: 'La synchronisation demande une connexion sécurisée (https).',
  decrypt: 'Impossible de lire les données de ce code.',
  too_large: 'L’historique est trop volumineux pour être synchronisé.',
  conflict: 'Un autre appareil synchronise en même temps. Réessaie dans un instant.',
  server: 'Le serveur de synchronisation ne répond pas correctement.',
};

// ---------- Code ----------

/** 16 chiffres au hasard (sans biais : on rejette les octets qui déséquilibreraient les chiffres). */
export function generateCode() {
  const digits = [];
  const buf = new Uint8Array(32);
  while (digits.length < CODE_LENGTH) {
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte < 250 && digits.length < CODE_LENGTH) digits.push(byte % 10);
    }
  }
  return digits.join('');
}

/** Accepte les espaces, tirets et points : on ne garde que les 16 chiffres. */
export function normalizeCode(input) {
  const digits = String(input ?? '').replace(/\D/g, '');
  return digits.length === CODE_LENGTH ? digits : null;
}

export const formatCode = (code) => code.replace(/(\d{4})(?=\d)/g, '$1 ');

// ---------- Clés et chiffrement ----------

const keyCache = new Map();

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** `salt` distinct pour un autre usage (les cercles) : le même code ne donne alors jamais les mêmes clés. */
export async function deriveKeys(code, salt = SALT) {
  const cacheKey = `${salt}:${code}`;
  if (keyCache.has(cacheKey)) return keyCache.get(cacheKey);
  if (!globalThis.crypto?.subtle) throw new SyncError('insecure');
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(`respire:${code}`), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: ITERATIONS }, base, 512),
  );
  const keys = {
    id: hex(bits.subarray(0, 32)), // sert d'adresse sur le serveur
    key: await crypto.subtle.importKey('raw', bits.slice(32), 'AES-GCM', false, ['encrypt', 'decrypt']), // ne quitte jamais l'appareil
  };
  keyCache.set(cacheKey, keys);
  return keys;
}

export async function encryptPayload(key, payload) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data));
  return { iv: toBase64(iv), ct: toBase64(ct) };
}

export async function decryptPayload(key, blob) {
  try {
    const data = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(blob.iv) }, key, fromBase64(blob.ct));
    return JSON.parse(new TextDecoder().decode(data));
  } catch {
    throw new SyncError('decrypt');
  }
}

// ---------- Données et fusion ----------
// Seules les données personnelles voyagent. Le thème, le son, les vibrations restent propres à chaque appareil.

export function buildPayload(state) {
  return normalize({
    v: 1,
    prefs: {
      name: state.name || '',
      goalMin: state.settings.goalMin,
      presetId: state.settings.presetId,
      minutes: state.settings.minutes,
      // L'identité dans le cercle suit la synchronisation (chiffrée comme le reste) : même personne sur tous mes appareils.
      circle: state.circle ? { code: state.circle.code, mid: state.circle.mid, key: state.circle.key, cn: state.circle.cn || '', joinedAt: state.circle.joinedAt } : null,
    },
    prefsAt: state.prefsAt || 0,
    onboarded: !!state.onboarded,
    sessions: state.sessions,
  });
}

/** Forme canonique : mêmes données = même texte, quel que soit l'appareil. */
function normalize(p) {
  const byId = new Map();
  for (const s of p.sessions || []) {
    const prev = byId.get(s.id);
    byId.set(s.id, prev ? { ...prev, ...s, feeling: s.feeling || prev.feeling } : { ...s });
  }
  const sessions = [...byId.values()].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.id < b.id ? -1 : 1));
  for (const s of sessions) if (s.feeling === undefined) delete s.feeling;
  return { v: 1, prefs: { ...p.prefs }, prefsAt: p.prefsAt || 0, onboarded: !!p.onboarded, sessions };
}

/** Les sessions s'additionnent ; pour les préférences, la modification la plus récente gagne. */
export function mergePayloads(a, b) {
  const newer = (b.prefsAt || 0) > (a.prefsAt || 0) ? b : a;
  return normalize({
    prefs: newer.prefs,
    prefsAt: Math.max(a.prefsAt || 0, b.prefsAt || 0),
    onboarded: a.onboarded || b.onboarded,
    sessions: [...(a.sessions || []), ...(b.sessions || [])],
  });
}

export const samePayload = (a, b) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));

/** Applique une fusion à cet appareil. Renvoie l'identité de cercle abandonnée au passage, s'il y en a une (à retirer du serveur). */
export function applyPayload(state, p) {
  let abandoned = null;
  state.name = p.prefs.name || '';
  state.settings.goalMin = p.prefs.goalMin ?? state.settings.goalMin;
  state.settings.presetId = getPreset(p.prefs.presetId ?? state.settings.presetId).id;
  state.settings.minutes = p.prefs.minutes ?? state.settings.minutes;
  if ('circle' in p.prefs) {
    const incoming = sanitizeCircle(p.prefs.circle);
    const same = incoming && state.circle && incoming.code === state.circle.code && incoming.mid === state.circle.mid;
    // L'identité qu'on remplace ne servira plus nulle part : à retirer du serveur, sinon c'est une fiche fantôme.
    if (state.circle && !same) abandoned = { code: state.circle.code, mid: state.circle.mid, key: state.circle.key };
    // Même cercle : on garde ce qui est propre à cet appareil (signes envoyés, cache). Sinon, on adopte (ou on quitte).
    state.circle = same ? { ...state.circle, cn: incoming.cn } : incoming;
  }
  state.prefsAt = p.prefsAt;
  state.onboarded = state.onboarded || p.onboarded;
  state.sessions = p.sessions;
  return { abandoned };
}

// ---------- Réseau ----------

async function call(body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch {
    throw new SyncError('offline');
  } finally {
    clearTimeout(timer);
  }
}

function checkStatus(status) {
  if (status === 503) throw new SyncError('not_configured');
  if (status !== 200 && status !== 404) throw new SyncError('server');
}

/**
 * Récupère, fusionne, renvoie. Peut être appelée aussi souvent qu'on veut : si rien n'a changé, rien n'est écrit.
 * Renvoie { changed, abandoned } : `changed` est vrai si des données d'un autre appareil sont arrivées ; `abandoned`
 * liste les identités de cercle que cette fusion a remplacées (à libérer sur le serveur).
 */
export async function syncNow(state) {
  const sync = state.sync;
  if (!sync?.code) return { changed: false, abandoned: [] };
  const { id, key } = await deriveKeys(sync.code);
  let changed = false;
  const abandoned = []; // identités de cercle remplacées par la fusion

  for (let attempt = 0; attempt < 4; attempt++) {
    const got = await call({ op: 'get', id });
    checkStatus(got.status);
    const remote = got.status === 200 ? got.data : null;

    const local = buildPayload(state);
    const remotePayload = remote ? await decryptPayload(key, remote.blob) : null;
    const merged = remotePayload ? mergePayloads(local, remotePayload) : local;
    if (!samePayload(merged, local)) {
      const r = applyPayload(state, merged);
      if (r.abandoned) abandoned.push(r.abandoned);
      changed = true;
    }
    if (remotePayload && samePayload(merged, remotePayload)) {
      sync.rev = remote.rev;
      sync.lastSync = Date.now();
      return { changed, abandoned };
    }

    const put = await call({ op: 'put', id, rev: remote?.rev ?? 0, blob: await encryptPayload(key, merged) });
    if (put.status === 200) {
      sync.rev = put.data.rev;
      sync.lastSync = Date.now();
      return { changed, abandoned };
    }
    if (put.status === 409) continue; // un autre appareil a écrit entre-temps : on recommence avec sa version
    if (put.status === 413) throw new SyncError('too_large');
    checkStatus(put.status === 503 ? 503 : 500);
  }
  throw new SyncError('conflict');
}

/** Active la synchronisation sur cet appareil avec un nouveau code. Renvoie le code. */
export async function enableSync(state) {
  state.sync = { code: generateCode(), rev: 0, lastSync: 0 };
  try {
    await syncNow(state);
  } catch (e) {
    state.sync = null;
    throw e;
  }
  return state.sync.code;
}

/** Rejoint un compte existant avec son code : jamais de création (une faute de frappe ne crée rien). */
export async function joinWithCode(state, rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) throw new SyncError('invalid');
  const { id } = await deriveKeys(code);
  const got = await call({ op: 'get', id });
  checkStatus(got.status);
  if (got.status === 404) throw new SyncError('unknown');
  state.sync = { code, rev: 0, lastSync: 0 };
  try {
    return await syncNow(state);
  } catch (e) {
    state.sync = null;
    throw e;
  }
}

/** Supprime la fiche du serveur (les données restent sur cet appareil). */
export async function deleteRemote(state) {
  if (!state.sync?.code) return;
  const { id } = await deriveKeys(state.sync.code);
  const res = await call({ op: 'delete', id });
  if (res.status === 503) throw new SyncError('not_configured');
  if (res.status !== 200) throw new SyncError('server');
}
