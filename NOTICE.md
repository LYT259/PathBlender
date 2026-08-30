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
- **WPILib** (BSD-3) — red/blue alliance transform semantics follow the
  official WPILib coordinate conventions.

FRC field visuals and game names/terms are owned by FIRST. Use of season field
materials follows the precedent of community tools (AdvantageScope,
PathPlanner) and is rechecked against the current season's terms before every
public release.

## FIRST trademark disclaimer

Per FIRST's Policy on the Use of FIRST® Trademarks and Copyrighted Materials
(rev. 04/19/25, §IV), the required disclaimer for this project is:

> FIRST®, FIRST® Robotics Competition, and FIRST® Tech Challenge, are
> registered trademarks of FIRST® (www.firstinspires.org) which is not
> overseeing, involved with, or responsible for this activity, product, or
> service.

Terms check record (2026-08-26, for the 2026 REBUILT season): the policy
permits registered FIRST teams non-commercial use of FIRST copyrighted
material (which explicitly includes field designs) for FIRST-program-related
activities, conditioned on displaying the disclaimer above and on the
"no modified form" rule for copyrighted materials. The bundled field images
are cropped/scaled for coordinate calibration, which is a gray zone under the
modified-form rule; the user-imported custom-field path is the ready fallback
(see docs/releasing.md) should FIRST ever tighten enforcement.
