// Le cercle : voir, parmi ses proches, qui a respiré aujourd'hui. Anonyme et chiffré de bout en bout.
//
// - Un cercle se rejoint avec un code de 16 chiffres (ou le lien qui le contient), comme la synchronisation mais avec
//   un autre sel : du code on dérive l'adresse du cercle sur le serveur et la clé qui chiffre tout ce qu'on y met.
// - On n'y partage que le minimum : prénom, série, « a respiré aujourd'hui », la semaine en sept points.
//   Jamais de durée, de ressenti, d'historique.
// - Le serveur ne voit que du texte chiffré et des identifiants aléatoires (voir api/circle.js).

import { generateCode, normalizeCode, formatCode, deriveKeys, encryptPayload, decryptPayload } from './sync.js';
import { buildStats, weekKeys, parseKey } from './stats.js';

export { generateCode, normalizeCode, formatCode };

const API = 'api/circle';
const SALT = 'respire-circle-v1'; // distinct de celui de la synchronisation
export const MAX_MEMBERS = 12;
const NAME_MAX = 24;
const REPUBLISH_MS = 6 * 60 * 60 * 1000; // on republie au moins toutes les 6 h, même sans changement (fraîcheur)
const EVENT_LIFE_MS = 3 * 24 * 60 * 60 * 1000; // un signe reçu s'efface de lui-même au bout de 3 jours

export class CircleError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

export const CIRCLE_MESSAGES = {
  invalid: 'Code invalide : il faut 16 chiffres.',
  unknown: 'Aucun cercle ne correspond à ce code. Vérifie les chiffres.',
  full: 'Ce cercle est complet (12 personnes).',
  offline: 'Pas de connexion. Réessaie plus tard.',
  not_configured: 'Les cercles ne sont pas encore activés sur ce serveur.',
  insecure: 'Les cercles demandent une connexion sécurisée (https).',
  name: 'Indique ton prénom pour que tes proches te reconnaissent.',
  too_soon: 'Tu lui as déjà écrit il y a peu. Réessaie plus tard.',
  decrypt: 'Impossible de lire les données de ce cercle.',
  forbidden: 'Ce cercle n’accepte plus cet appareil. Rejoins-le de nouveau avec le code.',
  server: 'Le serveur ne répond pas correctement.',
};

// ---------- Identité, lien d'invitation ----------

const randomHex = (bytes) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Identifiant aléatoire (public dans le cercle) et clé d'écriture (secrète : seule son empreinte est connue du serveur). */
export const newIdentity = () => ({ mid: randomHex(8), key: randomHex(32) });

export const inviteLink = (code, base = `${location.origin}${location.pathname}`) => `${base}#cercle=${code}`;

/** Le code contenu dans une adresse ou une saisie (« …#cercle=1234… », « 1234 5678… »), ou null. */
export function parseInvite(text) {
  const t = String(text ?? '');
  const m = t.match(/cercle=([\d\s.-]+)/i);
  return normalizeCode(m ? m[1] : t);
}

export const cleanName = (value) => String(value ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, NAME_MAX);

// ---------- Statut partagé ----------

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const daysBetween = (a, b) => Math.round((parseKey(a) - parseKey(b)) / 86400000);

/** Ce qui est partagé avec le cercle : rien d'autre que cela. */
export function buildStatus(state, today) {
  const stats = buildStats(state.sessions, today);
  const active = stats.streak.active;
  const last = [...active].filter((k) => k <= today).sort().at(-1) || '';
  return {
    v: 1,
    name: cleanName(state.name),
    cn: cleanName(state.circle?.cn),
    streak: stats.streak.current,
    best: stats.streak.best,
    last, // dernier jour où l'on a respiré
    day: today, // jour de la publication
    week: weekKeys(today).map((k) => (active.has(k) ? '1' : '0')).join(''),
  };
}

/** Ce qu'on reçoit des autres est vérifié et nettoyé avant tout affichage. */
export function parseStatus(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const int = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : 0);
  const day = (v) => (typeof v === 'string' && DAY_RE.test(v) ? v : '');
  const text = (v) => (typeof v === 'string' ? cleanName(v) : '');
  return {
    name: text(raw.name),
    cn: text(raw.cn),
    streak: int(raw.streak, 9999),
    best: int(raw.best, 9999),
    last: day(raw.last),
    day: day(raw.day),
    week: typeof raw.week === 'string' && /^[01]{7}$/.test(raw.week) ? raw.week : '0000000',
  };
}

/**
 * Comment afficher un membre aujourd'hui.
 * state : 'done' (a respiré aujourd'hui) · 'pending' (série vivante, pas encore aujourd'hui) ·
 *         'risk' (hier manqué : sa série tient à un fil) · 'lapsed' (série interrompue) · 'new' (jamais respiré).
 */
export function memberView(status, today) {
  const since = status.last ? daysBetween(today, status.last) : Infinity;
  let state = 'new';
  if (since <= 0) state = 'done';
  else if (since === 1) state = 'pending';
  else if (since === 2) state = 'risk';
  else if (status.last) state = 'lapsed';
  const sameWeek = status.day && weekKeys(today)[0] === weekKeys(status.day)[0];
  return {
    name: status.name || 'Quelqu’un',
    state,
    streak: state === 'lapsed' || state === 'new' ? 0 : status.streak,
    best: status.best,
    // Les sept jours de la semaine en cours ; ceux d'une semaine passée ne disent plus rien.
    week: sameWeek ? [...status.week].map((c) => c === '1') : Array(7).fill(false),
  };
}

export function summarize(members, today) {
  const views = members.map((m) => memberView(m.status, today));
  return { total: views.length, done: views.filter((v) => v.state === 'done').length, views };
}

/** Ordre d'affichage : soi d'abord, puis par série décroissante, puis par prénom. */
export function sortMembers(members, today) {
  return [...members].sort((a, b) => {
    if (a.me !== b.me) return a.me ? -1 : 1;
    const va = memberView(a.status, today);
    const vb = memberView(b.status, today);
    return vb.streak - va.streak || va.name.localeCompare(vb.name, 'fr');
  });
}

// ---------- Petits signes ----------

export const SIGNS = {
  nudge: { emoji: '👋', label: 'Petit signe', text: (from) => `${from} t’a fait un petit signe.` },
  cheer: { emoji: '👏', label: 'Bravo', text: (from) => `${from} t’applaudit.` },
};

/** Un signe de chaque sorte par personne et par jour, pas plus. */
export const canSend = (circle, mid, kind, today) => circle?.sent?.[`${mid}:${kind}`] !== today;

// ---------- Réseau ----------

async function call(body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal, cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  } catch {
    throw new CircleError('offline');
  } finally {
    clearTimeout(timer);
  }
}

function fail(res) {
  const code = res.data?.error;
  if (res.status === 503) throw new CircleError('not_configured');
  if (res.status === 403) throw new CircleError(code === 'full' ? 'full' : 'forbidden');
  if (res.status === 404) throw new CircleError('unknown');
  if (res.status === 429) throw new CircleError('too_soon');
  throw new CircleError('server');
}

const need = (state) => {
  if (!state.circle?.code) throw new CircleError('invalid');
  return state.circle;
};

/** Publie mon statut (et m'inscrit au cercle la première fois). Ne fait rien si rien n'a changé depuis peu. */
export async function publish(state, today, { force = false } = {}) {
  const c = need(state);
  const status = buildStatus(state, today);
  const text = JSON.stringify(status);
  if (!force && c.published?.text === text && Date.now() - (c.published?.at || 0) < REPUBLISH_MS) return { skipped: true };
  const { id, key } = await deriveKeys(c.code, SALT);
  const res = await call({ op: 'put', id, mid: c.mid, key: c.key, blob: await encryptPayload(key, status) });
  if (res.status !== 200) fail(res);
  c.published = { text, at: Date.now() };
  return { count: res.data.count };
}

/** Récupère le cercle : les membres (statuts déchiffrés et vérifiés) et les signes reçus. */
export async function fetchCircle(state) {
  const c = need(state);
  const { id, key } = await deriveKeys(c.code, SALT);
  const res = await call({ op: 'get', id, me: c.mid });
  if (res.status !== 200) fail(res);
  const members = [];
  for (const m of res.data.members) {
    try {
      const status = parseStatus(await decryptPayload(key, m.blob));
      if (status) members.push({ mid: m.mid, status, at: m.at, me: m.mid === c.mid });
    } catch {
      /* fiche illisible (un autre code, un message corrompu) : on l'ignore */
    }
  }
  const events = [];
  for (const e of res.data.inbox) {
    try {
      const body = await decryptPayload(key, e.blob);
      const sender = members.find((m) => m.mid === e.f);
      if (SIGNS[body?.k] && Date.now() - e.at < EVENT_LIFE_MS) events.push({ from: e.f, name: cleanName(body.n) || sender?.status.name || 'Quelqu’un', kind: body.k, at: e.at });
    } catch {
      /* message illisible */
    }
  }
  return { members, events, rev: res.data.rev };
}

export async function sendSign(state, toMid, kind, today) {
  const c = need(state);
  if (!SIGNS[kind]) throw new CircleError('server');
  const { id, key } = await deriveKeys(c.code, SALT);
  const res = await call({ op: 'send', id, from: c.mid, key: c.key, to: toMid, blob: await encryptPayload(key, { k: kind, n: cleanName(state.name), day: today }) });
  if (res.status !== 200) fail(res);
  c.sent = { ...(c.sent || {}), [`${toMid}:${kind}`]: today };
}

/** J'ai vu mes signes : on vide ma boîte (jusqu'au plus récent que j'ai reçu). */
export async function ackEvents(state, upTo) {
  const c = need(state);
  const { id } = await deriveKeys(c.code, SALT);
  const res = await call({ op: 'ack', id, mid: c.mid, key: c.key, upTo });
  if (res.status !== 200 && res.status !== 404) fail(res);
}

/** Un coup d'œil avant de rejoindre : le nom du cercle et qui s'y trouve (sans s'inscrire). */
export async function peekCircle(rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) throw new CircleError('invalid');
  if (!globalThis.crypto?.subtle) throw new CircleError('insecure');
  const { id, key } = await deriveKeys(code, SALT);
  const res = await call({ op: 'get', id });
  if (res.status === 404) throw new CircleError('unknown');
  if (res.status !== 200) fail(res);
  const names = [];
  let cn = '';
  for (const m of res.data.members) {
    try {
      const status = parseStatus(await decryptPayload(key, m.blob));
      if (!status) continue;
      if (status.name) names.push(status.name);
      if (!cn && status.cn) cn = status.cn;
    } catch {
      /* fiche illisible : on l'ignore */
    }
  }
  return { cn, names, full: res.data.members.length >= MAX_MEMBERS };
}

/** Crée un cercle : un nouveau code, et moi dedans. */
export async function createCircle(state, { name, circleName }, today) {
  if (!cleanName(name)) throw new CircleError('name');
  if (!globalThis.crypto?.subtle) throw new CircleError('insecure');
  state.name = cleanName(name);
  state.circle = { code: generateCode(), ...newIdentity(), cn: cleanName(circleName), joinedAt: Date.now(), sent: {}, cache: null, published: null };
  try {
    await publish(state, today, { force: true });
  } catch (e) {
    state.circle = null;
    throw e;
  }
}

/** Rejoint un cercle avec son code. Le cercle doit exister et ne pas être complet. */
export async function joinCircle(state, rawCode, { name }, today) {
  const code = normalizeCode(rawCode);
  if (!code) throw new CircleError('invalid');
  if (!cleanName(name)) throw new CircleError('name');
  if (!globalThis.crypto?.subtle) throw new CircleError('insecure');
  const { id } = await deriveKeys(code, SALT);
  const seen = await call({ op: 'get', id });
  if (seen.status === 404) throw new CircleError('unknown');
  if (seen.status !== 200) fail(seen);
  state.name = cleanName(name);
  state.circle = { code, ...newIdentity(), cn: '', joinedAt: Date.now(), sent: {}, cache: null, published: null };
  try {
    await publish(state, today, { force: true });
  } catch (e) {
    state.circle = null;
    throw e;
  }
}

/**
 * Quitte le cercle : ma fiche disparaît du serveur, puis de l'appareil.
 * Sans réseau, on ne fait rien (sinon ta fiche resterait visible des autres) ; `force` quitte quand même.
 */
export async function leaveCircle(state, { force = false } = {}) {
  const c = need(state);
  try {
    const { id } = await deriveKeys(c.code, SALT);
    const res = await call({ op: 'leave', id, mid: c.mid, key: c.key });
    if (res.status !== 200 && res.status !== 404 && res.status !== 403) fail(res); // déjà parti : tant mieux
  } catch (e) {
    if (!force) throw e;
  }
  state.circle = null;
}
