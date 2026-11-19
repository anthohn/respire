# Respire

Une application de respiration guidée, très simple, pour **réapprendre à respirer calmement** : par le nez, sans forcer, avec une expiration plus longue que l'inspiration. Quelques minutes par jour, jusqu'à ce que ça redevienne automatique.

L'objectif n'est pas de « faire de la relaxation » de temps en temps, mais d'installer une habitude. L'application est donc pensée autour de la régularité.

## Fonctionnalités

- **Sessions guidées** : une aura qui se gonfle et se dégonfle au rythme choisi, avec consignes discrètes (« par le nez, tout en douceur »), compte à rebours de chaque phase, son doux et vibrations en option.
- **4 rythmes** : Premiers pas (3 · 4), Expiration longue (4 · 6, recommandé), Cohérence (5 · 5), Calme profond (4 · 2 · 6). Durées de 1, 3, 5 ou 10 minutes ; la session se termine toujours sur une expiration complète.
- **Série (streak) indulgente** : une minute par jour suffit. Un jour manqué par semaine est offert (« jour de repos »), deux jours d'affilée cassent la série.
- **Ascension** : un chemin qui monte de 0 à 100 jours, avec des paliers (3, 7, 14, 30, 60, 100) et un marqueur « Tu es ici ».
- **Objectif quotidien**, niveaux (Graine → Océan), trophées, calendrier du mois, graphique de la semaine, historique avec ressenti après chaque session.
- **Un message qui donne envie de revenir** : « Ton 7e jour t'attend », jour de grâce, première session d'une minute, conseils du jour.
- **Une couleur qui suit la journée** : matin, journée, soir, nuit. Thème clair, sombre ou automatique.
- **Application installable (PWA)** et utilisable hors ligne. Toutes les données restent sur l'appareil (aucun compte, aucun serveur).
- **Rappel quotidien** : génère un événement récurrent à ajouter à ton calendrier (fonctionne sur tous les téléphones, sans serveur).

## Lancer en local

Aucune dépendance : il faut seulement Node.js (version 20 ou plus).

```bash
npm start
```

L'application est alors disponible sur <http://localhost:8080>. Pour changer de port : `PORT=3000 npm start`.

## Tests

La logique (séries, niveaux, trophées, rythmes de respiration, chemin d'ascension) est testée.

```bash
npm test
```

## Publier sur GitHub Pages

Le projet est un site statique : il n'y a rien à compiler.

1. Sur GitHub : **Settings → Pages**.
2. **Source** : `Deploy from a branch`, branche `main`, dossier `/ (root)`.
3. L'application est servie sur `https://<utilisateur>.github.io/respire/`.

> Les pages d'un dépôt **privé** nécessitent un compte GitHub qui l'autorise (par exemple GitHub Pro). Le dépôt peut rester privé tout en publiant le site, mais le site lui-même est alors public.

À chaque nouvelle version, incrémente `VERSION` dans `sw.js` pour que les téléphones récupèrent les nouveaux fichiers.

## Structure

```
index.html            page unique
css/style.css         design « Aura »
js/main.js            état, navigation, événements
js/views.js           vues (accueil, progrès, réglages, fin de session…)
js/session.js         session plein écran (intro, respiration, pause, fin)
js/breath.js          rythmes et courbe de respiration
js/stats.js           séries, niveaux, trophées
js/journey.js         géométrie du chemin « Ton ascension »
js/audio.js           son doux généré en direct (Web Audio)
js/store.js           stockage local
js/content.js         textes
sw.js, manifest.webmanifest, icons/   PWA
tests/                tests unitaires
```

## Pistes pour la suite

- Vraies notifications push (nécessite un petit serveur).
- Sessions guidées par la voix.
- Mesure de la respiration au quotidien : un « check-in » rapide dans la journée pour contrôler bouche fermée, respiration légère et épaules calmes.
- Autres langues.

## Important

Respire t'accompagne pour retrouver une respiration calme. Respire sans forcer : si tu ressens des vertiges ou une gêne, reprends une respiration normale. L'application **ne remplace pas un avis médical**, en particulier en cas de problème respiratoire.

## Licences

Police [Nunito](https://github.com/googlefonts/nunito), licence SIL Open Font (voir `fonts/LICENSE-Nunito.txt`).
