// Persistance locale (localStorage). Aucune donnée ne quitte l'appareil.

const KEY = 'respire:v1';

const defaults = () => ({
  onboarded: false,
  name: '',
  sessions: [],
  seenBadges: [],
  prefsAt: 0, // dernière modification des préférences synchronisées
  sync: null, // { code, rev, lastSync } quand la synchronisation est activée
  settings: {
    goalMin: 5,
    presetId: 'long',
    minutes: 5,
    sound: false,
    soundMode: 'glisse',
    soundVolume: 60,
    haptics: true,
    pipAuto: false,
    theme: 'auto',
    reminder: '08:00',
  },
});

export function load() {
  const base = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return base;
    const data = JSON.parse(raw);
    const settings = { ...base.settings, ...(data.settings || {}) };
    // Anciennes ambiances (souffle, vague, carillon) : remplacées par les nouveaux repères discrets.
    if (!['glisse', 'bulle', 'fil'].includes(settings.soundMode)) settings.soundMode = base.settings.soundMode;
    return {
      ...base,
      ...data,
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
