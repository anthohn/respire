// Textes de l'application (français).

export const TIPS = [
  {
    title: 'Ça devient naturel',
    text: 'Au début, suivre le rythme demande un effort : c’est normal, ton corps a pris d’autres habitudes. En le faisant consciemment, tu l’installes peu à peu, jusqu’à ce que tu n’y penses plus.',
  },
  {
    title: 'Le nez, d’abord',
    text: 'Le nez filtre, réchauffe et humidifie l’air avant qu’il n’arrive aux poumons. Bouche fermée, langue posée contre le palais : c’est la position de repos.',
  },
  {
    title: 'Laisse le corps faire',
    text: 'Pas besoin de choisir quel muscle utiliser ni où envoyer l’air : ton corps sait respirer. Ton rôle est seulement de ralentir, de rester léger et silencieux, et de laisser l’air entrer et sortir sans effort.',
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
    text: 'Dans la journée, vérifie de temps en temps : bouche fermée ? souffle léger et silencieux ? corps détendu ? C’est ce réflexe qui, petit à petit, devient automatique.',
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
    text: 'Une session avant de dormir aide à relâcher la journée. Essaie de la faire au lit, allongé, bien installé.',
  },
  {
    title: 'Associe-la à un geste',
    text: 'Après le café, avant de te brosser les dents, en arrivant au bureau : accrocher la session à un geste du quotidien rend l’habitude beaucoup plus facile.',
  },
];

export const HINTS = {
  inhale: ['Par le nez, tout en douceur', 'Léger et silencieux', 'Sans effort, l’air entre tout seul'],
  exhale: ['Lentement, laisse tout se relâcher', 'Relâche les épaules et la mâchoire', 'Laisse l’air sortir tout seul'],
  hold1: ['Reste détendu', 'Sans crispation'],
  hold2: ['Reste détendu', 'Sans crispation'],
};

/** Affiché une fois, à la deuxième expiration, pendant les premières sessions. */
export const BEGINNER_HINT = 'Tu manques d’air ? C’est normal. Respire comme tu veux, puis reprends le fil.';

export const PHASE_LABEL = {
  inhale: 'Inspire',
  hold1: 'Retiens',
  exhale: 'Expire',
  hold2: 'Pause',
};

export const POSTURE = [
  'Installe-toi confortablement, sans rien forcer',
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
