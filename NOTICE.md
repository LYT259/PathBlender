# NOTICE — Attribution

PathBlender is an independent project. It is not affiliated with FIRST,
Choreo, PathPlanner, or Team 103.

This project references (and, where noted, ports) the following open-source
works; each remains under its own license:

- **PathPlanner / PathPlannerLib** (MIT) — https://github.com/mjansen4857/pathplanner
  Trajectory generation algorithms ported to TypeScript in Phase 2 must carry
  source attribution in code comments and release notes.
- **Choreo / ChoreoLib** (BSD-3-Clause) — https://github.com/SleipnirGroup/Choreo
  Referenced for `.traj` file format behavior.
- **Collaborative PathPlanner fork (FRC Team 103, Cybersonics)** (MIT derivative
  of PathPlanner) — https://github.com/Cybersonics/Collaborative_Pathplanner_103_Fork
  The `.ghostauto` format facts implemented here are uncopyrightable facts; any
  code reference requires a license check of that repository first (see
  AGENTS.md red line §2).
- **AdvantageScopeAssets** (BSD-3-Clause) —
  https://github.com/Mechanical-Advantage/AdvantageScopeAssets
  The bundled 3D field models (`public/fields3d/`, FRC 2022–2026 incl.
  the 2025 welded/AndyMark variants) originate from this repository and
  are redistributed under its BSD-3-Clause terms; the models themselves
  derive from FIRST field CAD (see the FIRST section below).
- **WPILib** (BSD-3-Clause) — https://github.com/wpilibsuite/allwpilib
  Red/blue alliance transform semantics follow the official WPILib
  coordinate conventions, and the built-in 2026 REBUILT AprilTag layout is
  the official `2026-rebuilt-welded` field layout from allwpilib's apriltag
  resources (field-fact data; attribution also carried in
  `packages/core/src/field.ts`).

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
season field images originate from the AdvantageScope asset set
(https://github.com/Mechanical-Advantage/AdvantageScope), whose
community-tool precedent we follow; use of season field materials is
rechecked against the current season's terms before every public release.

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
