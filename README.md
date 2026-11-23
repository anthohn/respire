# Respire

Une application de respiration guidée, très simple, pour **réapprendre à respirer calmement** : par le nez, sans forcer, avec une expiration plus longue que l'inspiration. Quelques minutes par jour, jusqu'à ce que ça redevienne automatique.

L'objectif n'est pas de « faire de la relaxation » de temps en temps, mais d'installer une habitude. L'application est donc pensée autour de la régularité.

## Fonctionnalités

- **Sessions guidées** : une aura qui se gonfle et se dégonfle au rythme choisi, avec consignes discrètes (« par le nez, tout en douceur »), compte à rebours de chaque phase et vibrations en option (là où le navigateur les permet : pas sur iPhone, où Apple ne les autorise pas aux applications web ; le réglage n'apparaît alors pas). **Le son et l'écran ne font qu'un** : la séance entière est fabriquée en une piste audio (en une fraction de seconde) et lue comme un podcast. La bulle s'y cale ; si tu verrouilles ton téléphone, le son continue (écouteurs, Bluetooth, voiture), l'écran de verrouillage et la voiture peuvent la mettre en pause, et au déverrouillage tout est déjà au bon endroit. Deux guidages au choix dans Réglages : « Bol » (par défaut : un bol chantant, le si pour inspirer, le ré pour expirer, avec une réverbération de salle ; un carillon grave, do · fa · la · do, monte à l'ouverture et redescend à la clôture, dans un autre timbre et sans aucune des notes de respiration pour ne rien confondre ; une séance sans limite n'a pas d'ouverture, une longue séance a sa clôture) et « Repères » (le guidage d'origine : un glissé qui monte pour inspirer, un qui descend pour expirer). Le bouton son de la séance coupe ou rétablit le son sans l'interrompre. Si la lecture est refusée, la séance continue à l'horloge, sans le son. La lecture écran verrouillé dans une application installée sur l'écran d'accueil d'un iPhone est à vérifier sur l'appareil.
- **4 rythmes** : Expiration longue (4 · 6, recommandé), Cohérence (5 · 5), Calme profond (4 · 2 · 6), 4-7-8 (inspire 4, retiens 7, expire 8). Durées de 1, 3, 5, 10 minutes ou **1 h** (au-delà de 15 minutes, le son est une piste en boucle de quelques minutes plus une courte retombée à la fin, pour ne pas charger la mémoire du téléphone) ; la session se termine toujours sur une expiration complète. **Libre** : une session sans limite, que l'on laisse tourner (par exemple dans la fenêtre flottante pendant qu'on travaille) et qu'on arrête quand on veut ; le temps compte vers le haut, le son tourne en boucle sans coupure, et la session s'enregistre dès qu'elle dépasse une minute. Le choix se fait un rythme à la fois : une bulle respire en direct au rythme (et à la couleur) choisi ; on balaie, on touche les points ou on utilise les flèches du clavier.
- **Cercle de proches** (onglet « Cercle ») : on voit, à plusieurs, qui a respiré aujourd'hui. Un cercle se crée en un geste et se rejoint avec un **lien**, un **QR code** (à scanner avec l'appareil photo d'un proche qui est à côté de toi ; il est calculé sur l'appareil, sans service extérieur) ou un code de 16 chiffres (jusqu'à 12 personnes ; on voit le nom du cercle et ses membres avant de rejoindre). **Série du cercle** : le nombre de jours d'affilée où *tout le monde* a respiré, avec la semaine en sept anneaux (un anneau se remplit à mesure que le cercle respire, et devient ✓ quand tous l'ont fait) ; elle s'affiche en tête du cercle, sur l'accueil (« Il manque Paul ») et à la fin de chaque session (« Jour du cercle validé ✨ »). Celui qui arrive ne compte pas contre les jours d'avant son arrivée ni avant sa première séance, et quelqu'un qui n'a pas respiré depuis 14 jours passe « en pause » : il ne compte plus dans la série (une fiche abandonnée ou en double ne la bloque donc jamais) et la retrouve en reprenant, sans casser ce qui s'est passé sans lui. Le serveur efface de lui-même les fiches muettes depuis 45 jours, ce qui libère leur place ; celui qui revient se réinscrit tout seul. Chacun apparaît avec son prénom, sa série, sa semaine et un état (« A respiré aujourd'hui », « Pas encore », « Dernière séance il y a 6 j »). On peut s'envoyer un **petit signe** 👋 ou un **bravo** 👏 (un de chaque par personne et par jour). **Anonyme et chiffré de bout en bout** comme la synchronisation : pas de compte ni d'e-mail, rien n'est partagé tant qu'on ne rejoint pas un cercle, et on n'y met que le prénom, la série et les jours où l'on a respiré (oui ou non, sur quatre semaines), **jamais** durées, ressentis ni détail des séances. Le serveur ne voit que du texte chiffré avec la clé du cercle (dérivée du code, avec un sel distinct de la synchronisation) et des identifiants aléatoires ; chaque membre a sa propre clé d'écriture, personne ne peut modifier la fiche d'un autre. Quitter le cercle supprime sa fiche. L'identité dans le cercle suit la synchronisation entre appareils.
- **Série (streak) indulgente** : une minute par jour suffit. Un jour manqué par semaine est offert (« jour de repos »), deux jours d'affilée cassent la série.
- **Ascension** : un chemin qui monte de 0 à 100 jours, avec des paliers (3, 7, 14, 30, 60, 100) et un marqueur « Tu es ici ».
- **Objectif quotidien**, niveaux (Graine → Océan), trophées, calendrier du mois, graphique de la semaine, historique avec ressenti après chaque session.
- **Un message qui donne envie de revenir** : « Ton 7e jour t'attend », jour de grâce, première session d'une minute, conseils du jour.
- **Une couleur qui suit la journée** : matin, journée, soir, nuit. Thème clair, sombre ou automatique.
- **Respirer en travaillant (ordinateur)** : la session continue quand tu changes d'onglet (le titre de l'onglet affiche la phase et le temps restant). Dans Chrome et Edge, un bouton ouvre en plus une **fenêtre flottante** toujours visible, comme une vidéo en Picture-in-Picture ; un réglage permet de l'ouvrir automatiquement au lancement. Firefox et Safari ne proposent pas cette fenêtre : la session y continue simplement en arrière-plan. Sous Linux avec GNOME (Wayland), un navigateur ne peut pas forcer une fenêtre à rester au premier plan : il faut l'extension GNOME « PiP on top », qui reconnaît la fenêtre flottante à son titre exact (« Picture-in-Picture »). Respire donne ce titre à la fenêtre quand elle est ouverte depuis un onglet du navigateur ; dans l'application installée, Chromium impose le nom de l'application comme titre, et l'extension ne la reconnaît pas. Sans extension, le menu de la fenêtre (Alt+Espace) propose « Toujours au premier plan ».
- **Un visuel vivant** : un fond fluide aux couleurs du moment de la journée (shader WebGL, avec grain) et une bulle de savon irisée qui gonfle avec le souffle ; des ondes partent à chaque changement de phase. Sans WebGL, l'application garde un orbe simple.
- **Des mouvements doux, jamais gratuits** : en changeant d'onglet, le nouvel écran arrive tout de suite, du côté où l'on va (sans attente), pendant que la pastille de la barre du bas glisse ; la bulle WebGL de l'accueil est créée une seule fois et simplement replacée, pour ne rien recompiler à chaque onglet ; tout ce qui se touche s'enfonce un peu ; les chiffres comptent jusqu'à leur valeur (la première fois, ou quand ils ont changé) et les anneaux, les barres et les jours de la semaine se remplissent à l'arrivée ; la bulle de l'accueil grandit vers celle de la séance, puis la séance s'efface en fondu à la sortie ; un signe envoyé rebondit (et fait vibrer sur les téléphones qui le permettent, si les vibrations sont activées). Tout s'arrête quand l'appareil demande de réduire les animations.
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

Les API (`api/sync.js` pour la synchronisation, `api/circle.js` pour les cercles de proches) stockent des données chiffrées dans la même base Redis : rien de plus à configurer pour les cercles. Un cercle sans écriture pendant 90 jours est supprimé.

1. Dans le projet Vercel : **Storage → Create / Marketplace → Upstash (Redis)**, gratuit, puis le **connecter au projet**.
2. Vercel ajoute les variables d'environnement tout seul (`KV_REST_API_URL` et `KV_REST_API_TOKEN`, ou `UPSTASH_REDIS_REST_URL` et `UPSTASH_REDIS_REST_TOKEN`, les deux sont reconnues).
3. **Redéployer** le projet, puis tester dans Réglages → Synchronisation → Activer (et, pour les cercles, dans l'onglet Cercle → Créer mon cercle).

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
js/track.js           la piste audio d'une séance (trois guidages), fabriquée d'un coup
js/guide.js           lecture de la piste : horloge de la séance, écran de verrouillage, Bluetooth
js/audio.js           notes de base des « Repères », vibrations
js/store.js           stockage local
js/sync.js            synchronisation (code, chiffrement, fusion)
api/sync.js           API de synchronisation (Vercel), api/_store.js : stockage
api/circle.js         API des cercles de proches (même base que la synchronisation)
js/circle.js          cercle : clés, statut partagé, affichage, appels
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

Encodeur de QR code [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator) de Kazuhiko Arase, licence MIT (gardé tel quel dans `js/vendor/qrcode.mjs`, avec son en-tête de licence). « QR Code » est une marque déposée de DENSO WAVE INCORPORATED.
