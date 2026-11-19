# Respire

Une application de respiration guidée, très simple, pour **réapprendre à respirer calmement** : par le nez, sans forcer, avec une expiration plus longue que l'inspiration. Quelques minutes par jour, jusqu'à ce que ça redevienne automatique.

L'objectif n'est pas de « faire de la relaxation » de temps en temps, mais d'installer une habitude. L'application est donc pensée autour de la régularité.

## Fonctionnalités

- **Sessions guidées** : une aura qui se gonfle et se dégonfle au rythme choisi, avec consignes discrètes (« par le nez, tout en douceur »), compte à rebours de chaque phase, repères sonores très discrets et vibrations en option (le son monte quand tu inspires, descend quand tu expires ; trois styles : « Glissés » par défaut, « Bulles », « Fil » ; volume réglable ; tout est généré en direct).
- **4 rythmes** : Premiers pas (3 · 4), Expiration longue (4 · 6, recommandé), Cohérence (5 · 5), Calme profond (4 · 2 · 6). Durées de 1, 3, 5 ou 10 minutes ; la session se termine toujours sur une expiration complète.
- **Série (streak) indulgente** : une minute par jour suffit. Un jour manqué par semaine est offert (« jour de repos »), deux jours d'affilée cassent la série.
- **Ascension** : un chemin qui monte de 0 à 100 jours, avec des paliers (3, 7, 14, 30, 60, 100) et un marqueur « Tu es ici ».
- **Objectif quotidien**, niveaux (Graine → Océan), trophées, calendrier du mois, graphique de la semaine, historique avec ressenti après chaque session.
- **Un message qui donne envie de revenir** : « Ton 7e jour t'attend », jour de grâce, première session d'une minute, conseils du jour.
- **Une couleur qui suit la journée** : matin, journée, soir, nuit. Thème clair, sombre ou automatique.
- **Respirer en travaillant (ordinateur)** : la session continue quand tu changes d'onglet (le titre de l'onglet affiche la phase et le temps restant). Dans Chrome et Edge, un bouton ouvre en plus une **fenêtre flottante** toujours visible, comme une vidéo en Picture-in-Picture ; un réglage permet de l'ouvrir automatiquement au lancement. Firefox et Safari ne proposent pas cette fenêtre : la session y continue simplement en arrière-plan. Sous Linux avec GNOME (Wayland), un navigateur ne peut pas forcer une fenêtre à rester au premier plan : il faut l'extension GNOME « PiP on top », qui reconnaît la fenêtre flottante à son titre exact (« Picture-in-Picture »). Respire donne ce titre à la fenêtre quand elle est ouverte depuis un onglet du navigateur ; dans l'application installée, Chromium impose le nom de l'application comme titre, et l'extension ne la reconnaît pas. Sans extension, le menu de la fenêtre (Alt+Espace) propose « Toujours au premier plan ».
- **Un visuel vivant** : un fond fluide aux couleurs du moment de la journée (shader WebGL, avec grain) et une bulle de savon irisée qui gonfle avec le souffle ; des ondes partent à chaque changement de phase. Sans WebGL, l'application garde un orbe simple.
- **Application installable (PWA)** et utilisable hors ligne. Toutes les données restent sur l'appareil (aucun compte, aucun serveur).
- **Rappel quotidien** : génère un événement récurrent à ajouter à ton calendrier (fonctionne sur tous les téléphones, sans serveur).

## Synchronisation entre appareils (anonyme)

Dans Réglages → Synchronisation : « Activer » crée un **code de 16 chiffres** (à ranger dans un gestionnaire de mots de passe) ; sur un autre appareil, « J'ai un code » le retrouve.

- **Presque automatique avec ton gestionnaire de mots de passe** (Apple Mots de passe, Proton Pass, 1Password, Bitwarden, Brave…) : les écrans sont de vrais formulaires, avec un seul champ : le code (comme Mullvad, sans identifiant). À l'activation, la demande d'enregistrement part toute seule ; sur l'autre appareil, le champ est déjà actif, et dès que les 16 chiffres sont remplis la connexion se fait sans autre geste.
- **Aucun compte, aucun e-mail.** Du code on dérive, sur l'appareil, un identifiant et une clé de chiffrement (PBKDF2 à 600 000 tours, AES-GCM). Le serveur ne reçoit que du texte chiffré : il ne peut lire ni l'historique ni le prénom, et ne connaît pas le code.
- **Rien ne se perd** : les sessions de tous les appareils s'additionnent. Pour le prénom, l'objectif, le rythme et la durée, la modification la plus récente gagne. Le thème, le son et les vibrations restent propres à chaque appareil.
- **Un code mal saisi ne crée jamais de compte** (rejoindre ne fait que retrouver une fiche existante).
- **Perdre le code = perdre l'accès** aux données synchronisées (elles restent sur les appareils déjà connectés). L'export JSON ne contient jamais le code.
- Limites actuelles : pas de limitation de débit sur l'API ; fiche supprimée après 400 jours sans écriture ; ~2 500 sessions au maximum par code.

### Mise en place sur Vercel (une fois)

L'API (`api/sync.js`) stocke les données chiffrées dans une base Redis.

1. Dans le projet Vercel : **Storage → Create / Marketplace → Upstash (Redis)**, gratuit, puis le **connecter au projet**.
2. Vercel ajoute les variables d'environnement tout seul (`KV_REST_API_URL` et `KV_REST_API_TOKEN`, ou `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`, les deux sont reconnues).
3. **Redéployer** le projet, puis tester dans Réglages → Synchronisation → Activer.

Sans base configurée, l'API répond « synchronisation non activée sur ce serveur » ; en local (`npm start`), elle utilise la mémoire du processus (perdue à l'arrêt).

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
js/sync.js            synchronisation (code, chiffrement, fusion)
api/sync.js           API de synchronisation (Vercel), api/_store.js : stockage
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
