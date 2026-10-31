# NOTICE — Attribution

PathBlender is an independent project. It is not affiliated with FIRST,
Choreo, PathPlanner, Team 103, FRC Designs, Swerve Drive Specialties (SDS),
or WestCoast Products (WCP). Product names identify the source or depicted
product; they do not imply endorsement, certification, or sponsorship.

## License scope and asset boundaries

Apache-2.0 applies to PathBlender's own code made available under that license.
It does not grant rights in third-party models, artwork, trademarks, or route
files beyond the permissions actually held. Third-party material remains subject
to its applicable terms. A public repository, a download, a conversion to GLB,
or this notice does not by itself establish an unrestricted asset license.

This project references, adapts, or bundles the following works and assets.
The entries distinguish published licenses from limited statements or permissions;
they are not a representation that every bundled asset is open source:

- **PathPlanner / PathPlannerLib** (MIT) — https://github.com/mjansen4857/pathplanner
  Trajectory generation algorithms ported to TypeScript in Phase 2 must carry
  source attribution in code comments and release notes.
- **Choreo / ChoreoLib** (BSD-3-Clause) — https://github.com/SleipnirGroup/Choreo
  Referenced for `.traj` file format behavior.
- **Collaborative PathPlanner fork (FRC Team 103, Cybersonics)** (MIT derivative
  of PathPlanner) — https://github.com/Cybersonics/Collaborative_Pathplanner_103_Fork
  The `.ghostauto` format facts implemented here are uncopyrightable facts; any
  code reference requires a license check of that repository first (see
  docs/releasing.md).
- **AdvantageScopeAssets** (BSD-3-Clause) —
  https://github.com/Mechanical-Advantage/AdvantageScopeAssets
  The bundled 3D field models (`public/fields3d/`, FRC 2022–2026 incl.
  the 2025 welded/AndyMark variants) originate from this repository and
  are redistributed under its BSD-3-Clause terms; the models themselves
  derive from FIRST field CAD (see the FIRST section below). The 2025
  2D field sheets (`assets/fields/reefscape2025-{welded,andymark}.png`,
  Field2d_2025FRCFieldWeldedV3 / …AndyMarkV3) come from the same
  repository under the same terms, unmodified.
- **WPILib** (BSD-3-Clause) — https://github.com/wpilibsuite/allwpilib
  Red/blue alliance transform semantics follow the official WPILib
  coordinate conventions, and the built-in 2022–2026 AprilTag layouts
  (welded + AndyMark variants, including full pose quaternions) are the
  official field layouts from allwpilib's `fields` resources (field-fact
  data; attribution also carried in `packages/core/src/field.ts`).
- **AprilTag (apriltag2, tag36h11)** — © 2013-2016 The Regents of The
  University of Michigan (Edwin Olson, APRIL Robotics Lab), BSD-2-Clause,
  as vendored by wpilib's apriltag thirdparty. The 36h11 code words and
  bit layout reproduced in `packages/web/src/april-tag-texture.ts` are
  that project's published reference tables, used to render authentic
  tag faces in the 3D view.
- **FRC Designs / FRCDesignApp — MK5i swerve module** —
  https://github.com/frcdesign/FRCDesignApp
  The FRCDesignApp GitHub repository is MIT-licensed. Its complete MIT license
  text is preserved in `licenses/FRCDesignApp-MIT.txt`, with copyright (c) 2026
  FRCDesign.org.
  The bundled MK5i module geometry (`packages/web/public/models/mk5i-module.glb`)
  and its 2D top-view rendering (`assets/robots/mk5i-module-top.png`) derive
  from FRC Designs' public Onshape SDS MK5i assembly in the Swerve document,
  version V235, with Kraken X60 motors. The geometry was exported and adapted
  to GLB and rendered for 2D display. For that Onshape model, FRC Designs
  separately stated in Discord that it does not object to use for educational
  purposes. The project interprets its current use as consistent with that
  statement; this is the project's interpretation, not an itemized confirmation
  of public-repository distribution, GLB conversion, installer redistribution,
  or downstream terms. "Free" alone is not treated as proof of educational use.
  SDS, WCP, the Kraken X60 geometry, and other third-party rights are not
  confirmed by that reply.
  Source document: https://cad.onshape.com/documents/698e922b5304f1d6a2b06339/v/7815f8c0be3f57e66c7598ce/e/a9dfc0b156f7686b0772ad5c
  The request in https://github.com/frcdesign/FRCDesignApp/issues/61#issuecomment-6033731974 explicitly
  described GLB conversion, 2D rendering, website/desktop distribution, and
  a public Git repository including historical commits and tags. The Discord
  screenshot supplied by the maintainer shows Alex Kempen directly replying
  to that request on 2026-10-09 (displayed date; timezone unverified).
  This context supports the project's interpretation of the educational-use
  statement. It is not an MIT grant for all model geometry or permission from
  SDS/WCP; the reply expressly leaves their licensing to them.
  The library is FRCDesignLib; FRCDesignApp is its insertion tool. Obtaining
  geometry through that tool does not establish who authored every component.
  The separately maintained frame files `mk5i-frame.glb` and
  `mk5i-frame-30.glb` are recorded as the maintainer's own frame assemblies;
  they are not attributed to FRC Designs by this entry.
- **Swerve Drive Specialties (SDS) — SDS MK5i CAD-derived visualization assets** —
  SDS MK5i CAD-derived visualization assets are used and distributed with PathBlender with express permission from Swerve Drive Specialties.
  This project-specific written permission covers the SDS MK5i portions of the
  module GLB and derived 2D visualization. It does not relicense these assets under Apache-2.0, MIT, CC0, or any other standard open-source license, and
  does not cover the Kraken X60 geometry or the maintainer-built frame assemblies.
  The FRCDesignLib and FRCDesignApp attribution above is retained. Naming assets
  "SDS MK5i" follows SDS's attribution preference, not a license requirement,
  and does not imply SDS sponsorship, certification, or endorsement.
- **Example autonomous routes — FRC Teams 8814 (BLACKHOLE) and 11019 (OffSeason)** —
  Files under `packages/web/src/assets/welcome-example/8814/`, `11019/`, and
  `11019-champs/` are included on the basis of the maintainer's record of the
  teams' oral permission for non-commercial demonstration in this free tool,
  retaining team attribution. This is not a grant of unrestricted rights to
  redistribute the route collection separately or for other purposes.

## Bundled third-party libraries

Runtime dependencies of the shipped app, each under its own license:

- **React / React DOM** (MIT) — https://react.dev
- **three.js** (MIT) — https://threejs.org — the 3D field view.
- **Tauri, tauri-plugin-dialog / -updater / -process**
  (MIT OR Apache-2.0) — https://tauri.app — desktop shell and its plugins.
- **window-vibrancy** (Apache-2.0 OR MIT) —
  https://github.com/tauri-apps/tauri-plugin-vibrancy — macOS sidebar
  material.
- Dev-time only (not shipped in the bundle): Vite, vitest, TypeScript,
  Playwright (all MIT), OpenCC/opencc-js (Apache-2.0, generates the
  Traditional-Chinese dictionary at build time).

FRC field visuals and game names/terms are owned by FIRST. The bundled
season field artwork comes from the community-tool ecosystem, per package:

- **Schematic artwork** (the default 2D look for 2022–2026:
  `rapidreact2022.png`, `chargedup2023.png`, `crescendo2024.png`,
  `reefscape2025-schematic.png`, `rebuilt2026.png`) — PathPlanner
  (MIT), drawn by its author Michael Jansen; redistributed unmodified.
- **Rendered artwork** (2018–2020's only art, and the selectable
  "Rendered" style for 2022–2026) — AdvantageScopeAssets archive
  (BSD-3-Clause, https://github.com/Mechanical-Advantage/AdvantageScopeAssets),
  including the official 2025 welded/AndyMark pair; several source renders
  originate from Chief Delphi community posts (per the packages' own
  `sourceUrl`). Redistributed unmodified.

Use of season field materials is rechecked against the current season's
terms before every public release.

## FIRST trademark disclaimer

Per FIRST's Policy on the Use of FIRST® Trademarks and Copyrighted Materials
(rev. 04/19/25, §IV), the required disclaimer for this project is:

> FIRST®, FIRST® Robotics Competition, and FIRST® Tech Challenge, are
> registered trademarks of FIRST® (www.firstinspires.org) which is not
> overseeing, involved with, or responsible for this activity, product, or
> service.

Terms recheck record (2026-08-30, pre-release): the governing policy is
unchanged — the Policy on the Use of FIRST Trademarks and Copyrighted
Materials (Brand & Assets page, rev. 04/19/25) still governs; 2026 REBUILT
field materials ship under the same terms via the Season Materials /
Playing Field pages. No new revision found; the 2026-08-26 conclusion
below stands.

Terms check record (2026-08-26, for the 2026 REBUILT season): the policy
permits registered FIRST teams non-commercial use of FIRST copyrighted
material (which explicitly includes field designs) for FIRST-program-related
activities, conditioned on displaying the disclaimer above and on the
"no modified form" rule for copyrighted materials. The bundled field images
are cropped/scaled for coordinate calibration, which is a gray zone under the
modified-form rule; the user-imported custom-field path is the ready fallback
(see docs/releasing.md) should FIRST ever tighten enforcement.

## Reuse, historical copies, and rights concerns

For the MK5i geometry and its derived renders, this project does not purport to
sublicense third-party rights it has not established. Before extracting or
redistributing those assets, check the applicable permission with the relevant
rights holder; do not infer a blanket Apache-2.0 or MIT grant from this repository.
The educational-use statement is not represented as an unrestricted commercial
license. This notice neither narrows rights actually granted by an applicable
license nor creates additional rights in third-party material. Any maintainer
decision to accept residual legal or privacy risk is not authorization from a
rights holder and is not a representation that historical material has been cleaned.

Historical commits, tags, screenshots, and older release packages may contain
these assets and earlier notices. Adding this notice does not retroactively
obtain permission or change those artifacts. Future distributions must carry
current attribution and the applicable license texts; unresolved asset scope
must not be described as fully cleared.

Rights holders may contact the maintainer through
https://github.com/LYT259/PathBlender/issues with the affected file or release,
the claimed rights, and the requested correction. Do not post private documents,
personal contact details, or confidential evidence publicly; request a private
follow-up channel where necessary. The maintainer will review substantiated
concerns and determine appropriate correction, restriction, removal, or
replacement. This process and any later removal are not substitutes for permission.

PathBlender is a visualization and planning aid, not a certified engineering or
safety assessment. Model dimensions and simplified geometry are not a substitute
for manufacturer documentation or physical verification. The warranty and
liability provisions of applicable licenses remain as written; this notice does
not waive anyone else's rights or create a new license for their work.
