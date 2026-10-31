# PathBlender

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文（香港）](README.zh-Hant.md) | [Español](README.es.md) | **Français** | [Türkçe](README.tr.md) | [Português (Brasil)](README.pt-BR.md) | [עברית](README.he.md)

**Voyez ensemble les parcours autonomes de votre alliance. Trouvez les conflits avant le match.**

[**Essayez-le dans votre navigateur**](https://pathblender.pages.dev) ·
[Téléchargez l’application de bureau](https://github.com/LYT259/pathblender/releases) ·
[Premier contrôle de parcours](docs/user-guide.en.md#try-it-without-files) ·
[Star sur GitHub](https://github.com/LYT259/pathblender)

PathBlender réunit les parcours de Choreo et de PathPlanner sur un même terrain et une même horloge pour la stratégie d’alliance FRC. Rejouez les robots ensemble, trouvez un conflit et comparez un horaire de départ différent avant d’arrêter un plan.

![Une session d’entraînement synthétique : localiser un recouvrement, décaler B et rejouer le plan modifié](docs/screenshots/first-check.gif)

*Parcours d’enseignement originaux sur un terrain d’entraînement, pas un vrai match. Faites votre propre contrôle depuis l’écran d’accueil — sans fichiers, sans installation et sans compte.*

- **Réunit des outils différents :** importez des fichiers Choreo, PathPlanner et `.ghostauto` de Collaborative.
- **Rend la temporisation visible :** lecture partagée, contrôles de collision et comparaison des heures de départ au niveau de la session.
- **Garde les parcours sur votre machine :** l’analyse et la vérification se font en local.

Si PathBlender vous est utile ou intéressant, **mettez une Star au dépôt** pour soutenir le projet et le retrouver plus tard.

## Pourquoi

En qualifications et en éliminatoires FRC, les trois robots d’une alliance exécutent leurs programmes autonomes sur le même terrain en même temps. Chaque équipe trace ses parcours dans des outils différents (Choreo, PathPlanner) et comparer des exports séparés rend plus difficile de repérer les recouvrements avant le match.

PathBlender comble ce manque :

- **Import multi-outils** — Choreo `.traj`, `.ghostauto` du fork Collaborative de l’équipe 103, et `.path` / `.auto` natifs de PathPlanner (la génération de trajectoire est portée en TypeScript) ;
- **Lecture sur une frise unifiée** — tous les robots sur une même horloge d’autonome (15 s ; 20 s pour la saison 2026), lecture / pause / scrub / vitesse (0,25×–1×) ;
- **Détection de collisions et d’interférences** — recouvrement de rectangles de pare-chocs (OBB) sur toute la frise, avec rapport de conflits (qui, quand, où) et marqueurs de sortie de terrain ;
- **Vue 3D du terrain** — modèles officiels des terrains FRC 2022–2026 (constructions soudée et AndyMark quand elles diffèrent), orbite libre et cadrage en un clic ; les terrains personnalisés importés restent en 2D. La vue 2D offre un style schématique et un style rendu par saison, avec la disposition officielle des AprilTags en surimpression ;
- **Bibliothèque de parcours** — importez tout le dossier deploy d’une équipe : les fichiers étrangers sont ignorés et chaque parcours rejoint une bibliothèque ; un sélecteur à côté de chaque robot change son autonome actif en direct. Les `settings.json` PathPlanner appliquent les vraies dimensions des pare-chocs ;

- **Zéro installation, zéro envoi (web)** — une application web statique : les fichiers de parcours sont analysés et vérifiés localement dans votre navigateur ;
- **Aussi une application de bureau** — la même interface dans une enveloppe Tauri légère pour macOS, Windows et Linux, qui ajoute l’enregistrement/ouverture de sessions, la réexportation GIF et le paquet de solution, et les mises à jour intégrées (canal stable ou bêta). Les vérifications de mises à jour du bureau contactent GitHub Releases.

## Démarrage rapide

1. Obtenez l’application (voir ci-dessous) — ou appuyez sur **Essayez votre premier contrôle de parcours** sur l’écran d’accueil pour suivre un exercice guidé avec trois parcours synthétiques. **Essayer un exemple** ouvre à part la session multi-robots intégrée.
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

- **macOS** (macOS 13+ ; actuellement Apple Silicon uniquement) — téléchargez le fichier `*_aarch64.dmg` depuis [GitHub Releases](https://github.com/LYT259/pathblender/releases), ouvrez-le et glissez PathBlender dans Applications. Une build Universal pour Apple Silicon et Intel est prévue pour une future version.
- **Windows** (x86_64) — aucun installateur n’est encore publié ; `*_x64-setup.exe` est prévu pour une future version.
- **Linux** (x86_64) — les paquets DEB, AppImage et RPM ne sont pas encore publiés. Lorsqu’ils seront disponibles, les mises à jour intégrées passeront par l’AppImage ; les utilisateurs de DEB/RPM mettront à jour en installant le nouveau paquet par-dessus l’ancien.
- Mises à jour : menu **PathBlender → Rechercher des mises à jour…** (en bêta : activez d’abord le canal bêta dans **Préférences → Mises à jour**). Les autres fichiers de la page (`.tar.gz`, `.sig`, `.json`) relèvent du moteur de mise à jour — vous n’en avez pas besoin.
- **Application web** (build visionneuse : les mêmes imports que l’application — fichiers et dossiers entiers — plus lecture et détection ; sans enregistrement de session ni export GIF ou paquet de solution) — [pathblender.pages.dev](https://pathblender.pages.dev).

## Confidentialité

Les fichiers de parcours sont analysés **entièrement sur votre machine**. Pas de backend, pas de compte, pas de télémétrie, pas d’analytique. Le navigateur télécharge l’application et ses ressources ; les vérifications de mises à jour du bureau contactent GitHub Releases. Les fichiers de parcours ne sont pas envoyés. Les liens externes ouvrent leur destination lorsque vous les sélectionnez.

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
Swerve Drive Specialties (SDS) a donné son autorisation écrite expresse pour utiliser et distribuer avec PathBlender les ressources de visualisation dérivées du CAD de SDS MK5i ; cette autorisation ne couvre ni la géométrie Kraken X60 de WCP ni le châssis construit par l’utilisateur. Voir NOTICE pour plus de détails.

Les illustrations de terrains et les noms de jeux appartiennent à FIRST et sont utilisés à des fins non commerciales de stratégie d’équipe conformément à la politique de marques et de documents protégés de FIRST, revérifiée avant chaque publication publique :

> FIRST®, FIRST® Robotics Competition et FIRST® Tech Challenge sont des marques déposées de FIRST® (www.firstinspires.org), qui ne supervise pas, ne participe pas à et n’est pas responsable de cette activité, de ce produit ou de ce service.

> FIRST®, FIRST® Robotics Competition, and FIRST® Tech Challenge, are registered trademarks of FIRST® (www.firstinspires.org) which is not overseeing, involved with, or responsible for this activity, product, or service.

For the FIRST copyrighted materials included in PathBlender:

> ©2025 For Inspiration and Recognition of Science and Technology (FIRST). Used by special permission. All rights reserved. FIRST is not overseeing, involved with, or responsible for this activity, product, or service.
