// Rythmes de respiration et calcul de la phase à un instant donné.

export const PRESETS = [
  {
    id: 'first',
    name: 'Premiers pas',
    tagline: 'Doux et court, pour s’habituer',
    inhale: 3, hold1: 0, exhale: 4, hold2: 0,
  },
  {
    id: 'long',
    name: 'Expiration longue',
    tagline: 'Le rythme idéal pour réapprendre à respirer',
    inhale: 4, hold1: 0, exhale: 6, hold2: 0,
    recommended: true,
  },
  {
    id: 'coherence',
    name: 'Cohérence',
    tagline: 'Régulier et apaisant, 6 respirations par minute',
    inhale: 5, hold1: 0, exhale: 5, hold2: 0,
  },
  {
    id: 'calm',
    name: 'Calme profond',
    tagline: 'Avec une courte pause avant d’expirer',
    inhale: 4, hold1: 2, exhale: 6, hold2: 0,
  },
];

export const DURATIONS = [1, 3, 5, 10];

export const getPreset = (id) => PRESETS.find((p) => p.id === id) || PRESETS[1];

export const cycleLength = (p) => p.inhale + p.hold1 + p.exhale + p.hold2;

/** Écriture compacte du rythme : « 4 · 6 » ou « 4 · 2 · 6 ». */
export function patternLabel(p) {
  const parts = [p.inhale];
  if (p.hold1) parts.push(p.hold1);
  parts.push(p.exhale);
  if (p.hold2) parts.push(p.hold2);
  return parts.join(' · ');
}

/** Nombre de cycles entiers pour approcher la durée demandée (la session finit sur une expiration complète). */
export function sessionPlan(preset, minutes) {
  const len = cycleLength(preset);
  const cycles = Math.max(1, Math.round((minutes * 60) / len));
  return { cycles, totalSeconds: cycles * len };
}

const easeInOutSine = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(1, Math.max(0, x)));

/**
 * État de la respiration à l'instant `t` (secondes depuis le début).
 * `breath` va de 0 (poumons vidés) à 1 (poumons pleins).
 */
export function phaseAt(preset, t) {
  const len = cycleLength(preset);
  const cycle = Math.floor(t / len);
  let local = t - cycle * len;

  const steps = [
    ['inhale', preset.inhale],
    ['hold1', preset.hold1],
    ['exhale', preset.exhale],
    ['hold2', preset.hold2],
  ];
  for (const [phase, dur] of steps) {
    if (dur <= 0) continue;
    if (local < dur) {
      let breath;
      if (phase === 'inhale') breath = easeInOutSine(local / dur);
      else if (phase === 'exhale') breath = 1 - easeInOutSine(local / dur);
      else breath = phase === 'hold1' ? 1 : 0;
      return { phase, phaseT: local, phaseDur: dur, breath, cycle };
    }
    local -= dur;
  }
  return { phase: 'hold2', phaseT: 0, phaseDur: 0, breath: 0, cycle };
}

/** Niveau de respiration seul (utile pour les ondulations décalées dans le temps). */
export const breathAt = (preset, t) => (t <= 0 ? 0 : phaseAt(preset, t).breath);
