// Textes de l'application (français).

export const TIPS = [
  {
    title: 'Le nez, d’abord',
    text: 'Le nez filtre, réchauffe et humidifie l’air avant qu’il n’arrive aux poumons. Bouche fermée, langue posée contre le palais : c’est la position de repos.',
  },
  {
    title: 'Le ventre, pas la poitrine',
    text: 'Le diaphragme est ton principal muscle respiratoire. Quand tu inspires, c’est le ventre qui se gonfle doucement, pas les épaules qui montent.',
  },
  {
    title: 'Expirer plus longtemps',
    text: 'Une expiration plus longue que l’inspiration envoie au corps un signal de repos. C’est pour ça que le rythme 4 · 6 est un bon point de départ.',
  },
  {
    title: 'Petit mais régulier',
    text: 'Une habitude se reconstruit par la répétition. Cinq minutes chaque jour valent bien mieux qu’une heure une fois par semaine.',
  },
  {
    title: 'Relâche la mâchoire',
    text: 'Épaules, mâchoire, langue : ces zones se crispent sans qu’on s’en rende compte. Pendant une session, laisse-les tomber à chaque expiration.',
  },
  {
    title: 'Pense à ta respiration',
    text: 'Dans la journée, vérifie de temps en temps : bouche fermée ? ventre ou poitrine ? C’est ce réflexe qui, petit à petit, devient automatique.',
  },
  {
    title: 'Sans forcer',
    text: 'Respirer calmement ne veut pas dire respirer fort. Si tu manques d’air, prends une respiration normale puis reprends le fil. Doucement.',
  },
  {
    title: 'Un rythme lent',
    text: 'Autour de 6 respirations par minute, le cœur et la respiration se synchronisent. Beaucoup de gens y trouvent un vrai calme.',
  },
  {
    title: 'Le soir aussi',
    text: 'Une session avant de dormir aide à relâcher la journée. Essaie de la faire au lit, allongé, une main sur le ventre.',
  },
  {
    title: 'Associe-la à un geste',
    text: 'Après le café, avant de te brosser les dents, en arrivant au bureau : accrocher la session à un geste du quotidien rend l’habitude beaucoup plus facile.',
  },
];

export const HINTS = {
  inhale: ['Par le nez, le ventre se gonfle', 'Laisse le ventre s’ouvrir', 'Doucement, sans forcer'],
  exhale: ['Lentement, le ventre se vide', 'Relâche les épaules', 'Laisse l’air sortir tout seul'],
  hold1: ['Reste détendu', 'Sans crispation'],
  hold2: ['Reste détendu', 'Sans crispation'],
};

export const PHASE_LABEL = {
  inhale: 'Inspire',
  hold1: 'Retiens',
  exhale: 'Expire',
  hold2: 'Pause',
};

export const POSTURE = [
  'Une main sur le ventre, l’autre sur la poitrine',
  'Bouche fermée, langue contre le palais',
  'Épaules relâchées, mâchoire détendue',
];

export const FEELINGS = [
  { id: 'tense', emoji: '😣', label: 'Tendu' },
  { id: 'neutral', emoji: '😐', label: 'Neutre' },
  { id: 'calm', emoji: '🙂', label: 'Calme' },
  { id: 'serene', emoji: '😌', label: 'Apaisé' },
];

export const DAY_LETTERS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const WEEKDAYS_SHORT = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];

export function greeting(hour) {
  if (hour >= 5 && hour < 12) return 'Bonjour';
  if (hour >= 12 && hour < 18) return 'Bon après-midi';
  return 'Bonsoir';
}

export function moment(hour) {
  if (hour >= 5 && hour < 12) return 'Commence la journée par un souffle calme.';
  if (hour >= 12 && hour < 18) return 'Une petite pause pour respirer ?';
  return 'Relâche la journée, un souffle à la fois.';
}

export const tipOfTheDay = (dayNumber) => TIPS[((dayNumber % TIPS.length) + TIPS.length) % TIPS.length];

export function finishMessage({ streak, streakIncreased, goalReached, firstEver }) {
  if (firstEver) return 'Ta première session est faite. Le plus dur est derrière toi : revenir demain.';
  if (streakIncreased && streak >= 30) return 'Un mois de souffle. Ton corps a pris le pli.';
  if (streakIncreased && streak >= 7) return 'Une semaine entière. C’est comme ça que l’habitude s’installe.';
  if (streakIncreased) return `${streak} jours de suite. Continue, ça compte à chaque fois.`;
  if (goalReached) return 'Objectif du jour atteint. Ton souffle te dit merci.';
  return 'Chaque minute compte. Tu peux en refaire une quand tu veux.';
}
