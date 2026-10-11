# PathBlender

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文（香港）](README.zh-Hant.md) | [Español](README.es.md) | **Français** | [Türkçe](README.tr.md) | [Português (Brasil)](README.pt-BR.md) | [עברית](README.he.md)

**Visionneuse de fusion multi-sources de parcours autonomes pour la stratégie d’alliance FRC.**

Fusionne sur un même terrain les fichiers de parcours autonomes exportés par différentes chaînes d’outils : lecture sur une frise chronologique unifiée et détection de collisions, conçue pour les **groupes de stratégie d’alliance** — pas seulement pour l’équipe de programmation. C’est une **visionneuse** : analysez les autonomes que vous avez, trouvez les conflits, corrigez dans l’outil propriétaire du parcours, réimportez, revérifiez.

![Vue 3D du terrain](docs/screenshots/field3d.png)

## Pourquoi

En qualifications et en éliminatoires FRC, les trois robots d’une alliance exécutent leurs programmes autonomes sur le même terrain en même temps. Chaque équipe trace ses parcours dans des outils différents (Choreo, PathPlanner) et personne ne peut voir si les autonomes qui en résultent vont se percuter — jusqu’à ce que ça arrive, en match.

PathBlender comble ce manque :

- **Import multi-outils** — Choreo `.traj`, `.ghostauto` du fork Collaborative de l’équipe 103, et `.path` / `.auto` natifs de PathPlanner (la génération de trajectoire est portée en TypeScript — aucun autre outil web ne fait ça) ;
- **Lecture sur une frise unifiée** — tous les robots sur une même horloge d’autonome (15 s ; 20 s pour la saison 2026), lecture / pause / scrub / vitesse (0,25×–1×) ;
- **Détection de collisions et d’interférences** — recouvrement de rectangles de pare-chocs (OBB) sur toute la frise, avec rapport de conflits (qui, quand, où) et marqueurs de sortie de terrain ;
- **Vue 3D du terrain** — modèles officiels des terrains FRC 2022–2026 (constructions soudée et AndyMark quand elles diffèrent), orbite libre et cadrage en un clic ; les terrains personnalisés importés restent en 2D. La vue 2D offre un style schématique et un style rendu par saison, avec la disposition officielle des AprilTags en surimpression ;
- **Bibliothèque de parcours** — importez tout le dossier deploy d’une équipe : les fichiers étrangers sont ignorés et chaque parcours rejoint une bibliothèque ; un sélecteur à côté de chaque robot change son autonome actif en direct. Les `settings.json` PathPlanner appliquent les vraies dimensions des pare-chocs ;

- **Zéro installation, zéro envoi (web)** — une application web purement statique : les fichiers sont analysés localement dans votre navigateur, et la build web **n’émet aucune requête réseau** ;
- **Aussi une application de bureau** — la même interface dans une enveloppe Tauri légère pour macOS, Windows et Linux, qui ajoute l’enregistrement/ouverture de sessions, la réexportation GIF et le paquet de solution, et les mises à jour intégrées (canal stable ou bêta). Sa seule activité réseau est la vérification de mises à jour que vous déclenchez, qui contacte GitHub Releases.

## Démarrage rapide

1. Obtenez l’application (voir ci-dessous) — ou, sans fichiers sous la main, appuyez sur **Essayer un exemple** sur l’écran d’accueil pour charger une session multi-robots intégrée et voir immédiatement la lecture et la détection de collisions.
2. Importez les fichiers de parcours de chaque partenaire d’alliance — `.traj`, `.ghostauto`, `.path`, `.auto`, mélangés librement (un fichier ou un dossier entier, sur le web comme au bureau ; chaque `.path` référencé par un `.auto` doit arriver dans le même lot). Les fichiers corrompus sont signalés un à un sans bloquer les autres.
3. Appuyez sur **lecture**. Les conflits apparaissent comme des anneaux rouges sur le terrain, des segments rouges sur la frise et des entrées dans le panneau de conflits (qui, quand, où) — cliquez sur l’une pour sauter l’horloge à cet instant.
4. Investiguez : changez le parcours d’un robot depuis la bibliothèque, basculez la vue d’alliance ou avancez l’horloge. Quand vous savez ce qui doit changer, faites-le dans l’outil de l’équipe propriétaire, réexportez, déposez le nouveau fichier — la session se met à jour sur place.
5. **Partagez** le résultat : enregistrez un fichier de session ou exportez un GIF de la vue 2D — plus un paquet de solution avec tout ce qu’il faut pour le partenaire — pour le chat d’alliance (application de bureau).

![Rapport de collisions](docs/screenshots/collision-report.png)

## Formats pris en charge

| Format | Source | Remarques |
|---|---|---|
| `.traj` | Choreo (SleipnirGroup, BSD-3) | Toutes les versions de schéma connues ; états échantillonnés dans le temps |
| `.ghostauto` | Fork Collaborative de PathPlanner (FRC 103, MIT) | Inclut la géométrie des pare-chocs et le nom d’équipe |
| `.path` | PathPlanner (MIT) | Trajectoire générée localement — algorithme de PathPlannerLib porté |
| `.auto` | PathPlanner (MIT) | Séquences de parcours avec sémantique d’attentes et de commandes |
| `settings.json` | PathPlanner (MIT) | Dimensions des pare-chocs des robots de ce projet |
| `.pb` | Ce projet | Fichier de session : tous les robots + réglages + terrain (le `.ghpb.json` d’avant le renommage s’ouvre encore) |

Terrains : FRC 2022–2026 intégrés, plus l’import de terrains personnalisés avec calibrage et un JSON de disposition AprilTags WPILib/PhotonVision (utile pour toute autre saison ou un terrain d’entraînement).

## Où l’obtenir

- **macOS** (macOS 13+ ; une seule build Universal pour Apple Silicon et Intel) — `PathBlender_<version>_universal.dmg` depuis [GitHub Releases](https://github.com/LYT259/pathblender/releases) : ouvrez-le et glissez PathBlender dans Applications.
- **Windows** (x86_64) — l’installateur `*_x64-setup.exe` de la même page.
- **Linux** (x86_64) — paquets DEB, AppImage et RPM de la même page. Les mises à jour intégrées passent par l’AppImage ; les utilisateurs de DEB/RPM mettent à jour en installant le nouveau paquet par-dessus l’ancien.
- Mises à jour : menu **PathBlender → Rechercher des mises à jour…** (en bêta : activez d’abord le canal bêta dans **Préférences → Mises à jour**). Les autres fichiers de la page (`.tar.gz`, `.sig`, `.json`) relèvent du moteur de mise à jour — vous n’en avez pas besoin.
- **Application web** (build visionneuse : les mêmes imports que l’application — fichiers et dossiers entiers — plus lecture et détection ; sans enregistrement de session ni export GIF ou paquet de solution) — [pathblender.pages.dev](https://pathblender.pages.dev).

## Confidentialité

Les fichiers de parcours sont analysés **entièrement sur votre machine**. Pas de backend, pas de compte, pas de télémétrie, pas d’analytique. La build web n’émet aucun appel réseau ; l’application de bureau ne touche au réseau que pour la vérification de mises à jour que vous déclenchez (GitHub Releases) — les fichiers de parcours ne quittent jamais l’application.

Sont aussi inclus : une vue d’alliance rouge/bleu par session, les annotations de numéro d’équipe par robot, les terrains de saison ci-dessus avec les AprilTags officiels en surimpression, et une interface en **43 langues** — liste complète dans le menu de langue — en thèmes clair et sombre (suit le système).

Guide complet par outil et FAQ (en anglais et chinois) :
[English](docs/user-guide.en.md) ·
[简体中文](docs/user-guide.zh.md).

## Retours

Bugs, signalements de dérive de format et problèmes de terrains de saison sont exactement les retours dont nous avons besoin. Ouvrez un ticket sur
[github.com/LYT259/pathblender/issues](https://github.com/LYT259/pathblender/issues) —
le [modèle de retour](docs/community/feedback-template.md) montre quoi inclure (on ne vous demandera jamais de publier vos fichiers de parcours). La discussion communautaire se trouve dans le fil d’annonce du projet sur Chief Delphi.

## État

Le périmètre de visionneuse décrit ci-dessus est implémenté et couvert par des tests de régression. Les builds de bureau sont publiées sur [GitHub Releases](https://github.com/LYT259/pathblender/releases).

## Licence et attribution

**Apache-2.0** — voir [LICENSE](./LICENSE) et [NOTICE.md](./NOTICE.md).
PathPlanner (MIT), Choreo (BSD-3), les ressources AdvantageScope (BSD-3) et WPILib (BSD-3) restent sous leurs licences respectives et sont crédités dans NOTICE.

Les illustrations de terrains et les noms de jeux appartiennent à FIRST et sont utilisés à des fins non commerciales de stratégie d’équipe conformément à la politique de marques et de documents protégés de FIRST, revérifiée avant chaque publication publique :

> FIRST®, FIRST® Robotics Competition et FIRST® Tech Challenge sont des marques déposées de FIRST® (www.firstinspires.org), qui ne supervise pas, ne participe pas à et n’est pas responsable de cette activité, de ce produit ou de ce service.
