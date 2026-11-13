# PathPlanner official reference fixtures (pinned v2025.2.7)

Acceptance fixtures for `packages/core/test/pathplanner-reference.test.ts`.
Everything here is **real upstream material at one pinned tag** or official
output computed from it — nothing in this directory is synthesized, and no
test may claim official alignment from anywhere else.

## Gate semantics

The acceptance suite is **self-gating**: it reads `manifest.json` in this
directory. An absent manifest, or one with an empty `cases` list, means zero
fixtures — the acceptance `describe` is skipped and a single gate test
documents the closed gate. A malformed manifest, a referenced file that is
missing, or a file whose bytes no longer match the recorded SHA256 fails the
suite loudly instead of silently closing the gate. When fixtures exist, each
case runs this repo's real pipeline (parse `settings.json` + `.path` /
`.auto` → profile → generation) and compares against the expected values
declared in the manifest.

## Provenance (all verified 2026-11-07)

Upstream project: **mjansen4857/pathplanner**, tag **v2025.2.7**, MIT license
(also credited in `NOTICE.md`). Files were fetched from the tag via the
GitHub contents API at their exact upstream paths:

| File | Upstream path at v2025.2.7 | SHA256 |
|---|---|---|
| `settings.json` | `examples/java/src/main/deploy/pathplanner/settings.json` | `ded3e52d3c063e3eaf65096eabcabfced4fbd20f8a56433e3ee3dc9fc15bb3d1` |
| `Pickup.path` | `examples/java/src/main/deploy/pathplanner/paths/Pickup.path` | `cd8d84c892f581703c9a3fd590c5153015a31da1d4e32877430de347d5393b46` |
| `Score.path` | `examples/java/src/main/deploy/pathplanner/paths/Score.path` | `2c9677bf72408e2d4228e45ffae505b97faaef292fd72d0aa5e18f83fd86f145` |
| `Example Auto.auto` | `examples/java/src/main/deploy/pathplanner/autos/Example Auto.auto` | `fa5a1e34ba44e20637ff1f0a0d4c58879550abccb84acedbe897bbc6a4e3fdb1` |

`Pickup.path` and `Score.path` are byte-identical to the long-standing
`samples/pathplanner/` copies; `settings.json` exists only here (the sample
library never carried one) — this directory re-lands the paths with pinned
provenance and hashes and adds the settings file. `Example Auto.auto` is
likewise byte-identical to the long-standing `samples/pathplanner/` copy
(re-verified 2026-11-09 against the tag bytes fetched via the jsdelivr gh
mirror for `v2025.2.7`, after a raw.githubusercontent.com timeout). The
wheel itself is pinned by bytes for reproduction:
`robotpy_pathplannerlib-2025.2.7-py3-none-any.whl` from PyPI has SHA256
`a1f5ab93a87301b85813bc8cfe3d4f4ad80e540d45248fa6e6edfe77a34e9f74`.

Golden outputs (`golden-pickup.json`, `golden-score.json`) were computed once
on 2026-11-07 with the **official PyPI wheel `robotpy-pathplannerlib`
2025.2.7** — the upstream python port published from the same tag — using
`golden-runner.py` (kept here verbatim, SHA256
`1e76deccc09290e3ed1184f1ee2793a46bec3abe22be899dfe2555aff67f82b1`) via the
official entry points `RobotConfig.fromGUISettings()` +
`PathPlannerPath.fromPathFile()` + `generateTrajectory()` with the paths'
ideal starting states. To reproduce:

```sh
python3 -m venv /tmp/pp && /tmp/pp/bin/pip install robotpy-pathplannerlib==2025.2.7
mkdir -p /tmp/ppdeploy/deploy/pathplanner/paths
cp settings.json /tmp/ppdeploy/deploy/pathplanner/
cp Pickup.path Score.path /tmp/ppdeploy/deploy/pathplanner/paths/
cd /tmp/ppdeploy && /tmp/pp/bin/python <this dir>/golden-runner.py
```

Golden file hashes: `golden-pickup.json`
`fa71baa2e7e3bc03cc9ef2a63a0e86dc0e8effc6e99866ca154483b59279fadc`,
`golden-score.json`
`18f3d72c72a5e548ce1e58093f9b334e2e59badb9ea4d00c091ddb3ed8cd66cf`.

### Composite golden for `Example Auto.auto` (added 2026-11-09)

`golden-example-auto.json` (`735ef5707bd8ce341e6a66ace862bd0733d75cb9498176a31fcd8b9b5fb3aad3`)
is **not** an official routine output — no such output exists (see below). It
is a **declared composite baseline**: every segment's states come from the
official wheel with the same ideal-starting-state formula as above, and the
chaining is a declared model:

- sequential depth-first order — the runner **asserts** its walk matches the
  official `PathPlannerAuto.getPathGroupFromAutoFile` path group (by first
  path point, since `fromPathFile` does not populate `.name`) before emitting
  anything;
- `wait` commands hold the previous end pose at 10 Hz for the declared time;
- `named` commands are zero-duration markers (their real duration is
  user code and unknowable from the file).

Why this model is legitimate *for this routine*: the wheel's
`FollowPathCommand.initialize` generates each segment from the robot's live
state (`commands.py`, `generateTrajectory(currentSpeeds,
currentPose.rotation(), config)`), and `resetOdom: true` resets to path 0's
first point + ideal rotation (`auto.py` `_initFromJson`). In `Example Auto`,
Pickup ends at rest (goal velocity 0) at rotation 0° at exactly Score's first
anchor, and both waits leave the robot stationary — so every segment's live
starting state **equals** its path's ideal starting state (velocity 0,
rotation 0°). Ideal-start generation therefore coincides with official
runtime semantics for this fixture; the equivalence is specific to
continuous, at-rest segment joins like this one and is NOT claimed for
arbitrary routines. Computed once on 2026-11-09 with
`auto-golden-runner.py` (kept here verbatim) in the same pinned-wheel setup;
to reproduce, additionally copy `Example Auto.auto` to
`deploy/pathplanner/autos/` and run `/tmp/pp/bin/python auto-golden-runner.py`
from the deploy directory.

## What could NOT be obtained honestly (recorded, not faked)

- **Committed golden generation outputs in upstream test resources** — none
  exist at v2025.2.7. `pathplannerlib/src/test/{java,native}` carry only
  parser/geometry unit tests (ConstraintsZoneTest, PathConstraintsTest,
  GoalEndStateTest, RotationTargetTest, GeometryUtilTest) and there is no
  `src/test/resources` directory. Hence the wheel-run goldens above are the
  official numbers this gate uses.
- **An official `.auto` routine trajectory** (e.g. the example project's
  `Example Auto.auto`) — **re-verified 2026-11-09 against the installed
  wheel**: no library API at v2025.2.7 computes one. The Java lib's `auto/`
  has only `AutoBuilder`, `CommandUtil`, `NamedCommands`; the python port's
  `PathPlannerAuto` (`auto.py:155`) is a runtime `Command` — each segment's
  trajectory is generated by `FollowPathCommand.initialize` from the robot's
  live speeds/rotation (`commands.py:111`), so there is nothing to export
  without running a robot (or the GUI's own simulation). GUI preview numbers
  are not exportable. The `example-auto-composite-v2025.2.7` manifest case is
  therefore a **composite baseline** (official per-segment wheel numbers +
  declared chaining whose equivalence to runtime semantics holds for this
  routine — see the composite section above), never an official routine
  output; a genuinely official `.auto` case may only be added from a real
  export generated by the PathPlanner GUI at this exact tag.

## Declared comparison basis and tolerances

Defaults (recorded, not invented tighter): total duration ±2%, position
±5 cm, heading ±3°, speed ±0.2 m/s. Curve comparison samples this repo's
generator output against the official golden states at the fixture's own
timesteps. Additional declared values with reasons:

- `accelTolMPSS` ±0.5 m/s²: finite-difference acceleration peaks depend on
  each implementation's sample spacing (observed 3.0064 vs official 2.8293
  m/s² on Score); both remain within the path's own 3.0 m/s² constraint up
  to numeric desaturation error.
- Auto joins (`kind: "auto"` cases): a declared hold is detected as a
  maximal run of samples under 0.05 m/s lasting ≥75% of the declared wait
  (at most the wait +0.5 s) within ±5 cm of the declared pose. The composite
  fixture declares its two 1.0 s waits (around an instant named command) as
  one 2.0 s hold window — with zero-duration named semantics they are
  contiguous in time.

Any future relaxation must be recorded here and in `manifest.json` with a
reason; never tighten silently either — tolerances are part of the declared
basis.

## Adding fixtures later

Acceptable sources, in order: (a) files from the pinned upstream tag at
known paths, verified by SHA256; (b) real exports generated by PathPlanner
v2025.2.7 itself (user-provided), with origin and hashes recorded here.
Every new case needs a `manifest.json` entry (name, kind, files, provenance
incl. tag, expected values, any tolerance override with reason) and its
inputs hashed in the case's `sha256` block. Do not hand-write expected
numbers and do not compute them with this repo's own generator — that would
be a mirror assertion, not official alignment. MIT provenance is recorded in
`NOTICE.md`; no additional license entry is required for these samples.
