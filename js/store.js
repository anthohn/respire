// Persistance locale (localStorage). Aucune donnée ne quitte l'appareil.

import { getPreset } from './breath.js';
import { GUIDE_STYLES, DEFAULT_GUIDE } from './track.js';

const KEY = 'respire:v1';

const defaults = () => ({
  onboarded: false,
  name: '',
  sessions: [],
  seenBadges: [],
  prefsAt: 0, // dernière modification des préférences synchronisées
  sync: null, // { code, rev, lastSync } quand la synchronisation est activée
  circle: null, // { code, mid, key, cn, ... } quand on est dans un cercle de proches (voir circle.js)
  circleHint: false, // l'invitation à créer un cercle, sur l'accueil, a été fermée
  settings: {
    goalMin: 5,
    presetId: 'long',
    minutes: 5,
    sound: true, // le guidage sonore est aussi l'horloge de la session : activé par défaut, on peut le couper en séance
    soundStyle: DEFAULT_GUIDE,
    haptics: true,
    pipAuto: false,
    theme: 'auto',
    reminder: '08:00',
  },
});

/** Un cercle n'est gardé que s'il est complet et bien formé (sinon, on repart sans cercle plutôt que de planter). */
export function sanitizeCircle(c) {
  if (!c || typeof c !== 'object') return null;
  if (!/^\d{16}$/.test(c.code) || !/^[0-9a-f]{16}$/.test(c.mid) || !/^[0-9a-f]{64}$/.test(c.key)) return null;
  return {
    code: c.code,
    mid: c.mid,
    key: c.key,
    cn: typeof c.cn === 'string' ? c.cn.slice(0, 24) : '',
    joinedAt: Number.isFinite(c.joinedAt) ? c.joinedAt : Date.now(),
    sent: c.sent && typeof c.sent === 'object' ? c.sent : {},
    cache: c.cache && typeof c.cache === 'object' ? c.cache : null,
    published: c.published && typeof c.published === 'object' ? c.published : null,
  };
}

export function load() {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const data = JSON.parse(raw);
    const settings = { ...base.settings, ...(data.settings || {}) };
    const stored = data.settings || {};
    // Réglages d'avant le guidage sonore : on l'active, en gardant le style déjà choisi s'il existe.
    if (!('soundStyle' in stored)) {
      settings.sound = true;
      settings.soundStyle = stored.audioStyle;
    }
    if (!GUIDE_STYLES.some((g) => g.id === settings.soundStyle)) settings.soundStyle = DEFAULT_GUIDE;
    for (const old of ['soundMode', 'soundVolume', 'audioMode', 'audioStyle']) delete settings[old];
    settings.presetId = getPreset(settings.presetId).id;
    return {
      ...base,
      ...data,
      circle: sanitizeCircle(data.circle),
      settings,
      sessions: Array.isArray(data.sessions) ? data.sessions : [],
      seenBadges: Array.isArray(data.seenBadges) ? data.seenBadges : [],
    };
  } catch {
    return base;
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function reset() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* stockage indisponible : rien à effacer */
  }
  return defaults();
}
