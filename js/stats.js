// Logique pure (aucun accès au DOM) : dates, séries, niveaux, trophées.
// Toutes les dates sont des clés locales "AAAA-MM-JJ".

/** Une journée compte pour la série dès 1 minute de pratique cumulée. */
export const MIN_SECONDS = 60;

export function dayKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key, n) {
  const date = parseKey(key);
  date.setDate(date.getDate() + n);
  return dayKey(date);
}

/** Les 7 jours (lundi → dimanche) de la semaine qui contient `today`. */
export function weekKeys(today = dayKey()) {
  const dow = (parseKey(today).getDay() + 6) % 7; // lundi = 0
  const monday = addDays(today, -dow);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

export function secondsPerDay(sessions) {
  const map = new Map();
  for (const s of sessions) map.set(s.date, (map.get(s.date) || 0) + s.seconds);
  return map;
}

export function activeDays(sessions) {
  const active = new Set();
  for (const [key, sec] of secondsPerDay(sessions)) if (sec >= MIN_SECONDS) active.add(key);
  return active;
}

/**
 * Remonte le temps à partir de `startKey` en comptant les jours actifs.
 * Un jour manqué est « offert » (jour de repos) s'il est précédé d'un jour actif
 * et qu'aucun autre jour de repos n'a été utilisé dans les 7 derniers jours.
 * Deux jours manqués d'affilée cassent la série.
 */
export function walkStreak(active, startKey) {
  let count = 0;
  let idx = 0;
  let lastRest = null;
  const rest = [];
  let key = startKey;
  for (;;) {
    if (active.has(key)) {
      count++;
    } else {
      const olderActive = active.has(addDays(key, -1));
      const restAllowed = lastRest === null || idx - lastRest >= 7;
      if (!olderActive || !restAllowed) break;
      rest.push(key);
      lastRest = idx;
    }
    key = addDays(key, -1);
    idx++;
  }
  return { count, rest };
}

export function streakInfo(sessions, today = dayKey()) {
  const active = activeDays(sessions);
  const todayDone = active.has(today);
  // Tant qu'aujourd'hui n'est pas fini, on part d'hier : la journée n'est pas perdue.
  const start = todayDone ? today : addDays(today, -1);
  const cur = walkStreak(active, start);
  let best = cur.count;
  for (const key of active) best = Math.max(best, walkStreak(active, key).count);
  return {
    current: cur.count,
    best,
    todayDone,
    atRisk: !todayDone && cur.count > 0,
    yesterdayRest: cur.rest.includes(addDays(today, -1)),
    rest: new Set(cur.rest),
    active,
  };
}

export function totals(sessions) {
  const seconds = sessions.reduce((sum, s) => sum + s.seconds, 0);
  return { seconds, minutes: Math.floor(seconds / 60), count: sessions.length };
}

export function minutesOn(sessions, key) {
  return (secondsPerDay(sessions).get(key) || 0) / 60;
}

export function buildStats(sessions, today = dayKey()) {
  const streak = streakInfo(sessions, today);
  const t = totals(sessions);
  return {
    sessions: t.count,
    totalSeconds: t.seconds,
    totalMinutes: t.minutes,
    current: streak.current,
    best: streak.best,
    streak,
  };
}

// ---------- Niveaux ----------

export const LEVELS = [
  { name: 'Graine', minutes: 0, blurb: 'Tout commence ici.' },
  { name: 'Pousse', minutes: 15, blurb: 'Le souffle se réveille.' },
  { name: 'Souffle', minutes: 45, blurb: 'Ta respiration devient plus lente.' },
  { name: 'Brise', minutes: 100, blurb: 'Ton souffle devient plus ample.' },
  { name: 'Vague', minutes: 200, blurb: 'Le rythme s’installe.' },
  { name: 'Marée', minutes: 400, blurb: 'Une habitude solide.' },
  { name: 'Océan', minutes: 800, blurb: 'Respirer calmement te devient naturel.' },
];

export function levelInfo(totalMinutes) {
  let index = 0;
  LEVELS.forEach((lvl, i) => {
    if (totalMinutes >= lvl.minutes) index = i;
  });
  const level = LEVELS[index];
  const next = LEVELS[index + 1] || null;
  const progress = next ? (totalMinutes - level.minutes) / (next.minutes - level.minutes) : 1;
  return { index, level, next, progress, toNext: next ? next.minutes - totalMinutes : 0 };
}

// ---------- Trophées ----------

export const BADGES = [
  { id: 'first', glyph: '1', title: 'Premier souffle', desc: 'Terminer ta première session', test: (s) => s.sessions >= 1 },
  { id: 'streak-3', glyph: '3', unit: 'jours', title: 'Trois jours', desc: '3 jours de suite', test: (s) => Math.max(s.best, s.current) >= 3 },
  { id: 'streak-7', glyph: '7', unit: 'jours', title: 'Une semaine', desc: '7 jours de suite', test: (s) => Math.max(s.best, s.current) >= 7 },
  { id: 'streak-14', glyph: '14', unit: 'jours', title: 'Deux semaines', desc: '14 jours de suite', test: (s) => Math.max(s.best, s.current) >= 14 },
  { id: 'streak-30', glyph: '30', unit: 'jours', title: 'Un mois', desc: '30 jours de suite', test: (s) => Math.max(s.best, s.current) >= 30 },
  { id: 'streak-60', glyph: '60', unit: 'jours', title: 'Deux mois', desc: '60 jours de suite', test: (s) => Math.max(s.best, s.current) >= 60 },
  { id: 'streak-100', glyph: '100', unit: 'jours', title: 'Cent jours', desc: '100 jours de suite', test: (s) => Math.max(s.best, s.current) >= 100 },
  { id: 'min-60', glyph: '1 h', title: 'Une heure', desc: '1 heure de respiration au total', test: (s) => s.totalMinutes >= 60 },
  { id: 'min-300', glyph: '5 h', title: 'Cinq heures', desc: '5 heures de respiration au total', test: (s) => s.totalMinutes >= 300 },
  { id: 'min-600', glyph: '10 h', title: 'Dix heures', desc: '10 heures de respiration au total', test: (s) => s.totalMinutes >= 600 },
  { id: 'min-1200', glyph: '20 h', title: 'Vingt heures', desc: '20 heures de respiration au total', test: (s) => s.totalMinutes >= 1200 },
];

export function earnedBadgeIds(stats) {
  return BADGES.filter((b) => b.test(stats)).map((b) => b.id);
}

// ---------- Formats ----------

export function formatDuration(seconds) {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) {
    const rest = s % 60;
    return rest && m < 10 ? `${m} min ${String(rest).padStart(2, '0')}` : `${m} min`;
  }
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')}`;
}

export function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
