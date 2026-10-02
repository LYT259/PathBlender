# @pathblender/core

Pure-function core of [PathBlender](../../README.md): parse FRC autonomous
path files into a unified trajectory model, then fuse, replay, and collision-
check them. **Zero DOM, zero dependencies, fully synchronous** — runs in any
JS runtime (browser, Node, workers).

Used by the PathBlender web app and consumable as a library (e.g. by the
sibling show-control project GHPaths for guest-path import).

## Install

```sh
npm install @pathblender/core
```

## What it does

| Area | Entry points |
|---|---|
| Parse any supported file | `parsePathFile(text, fileName, resolvePath?)` — auto-detects format; returns a `Trajectory` or throws `ParseError` with an actionable reason |
| Supported formats | Choreo `.traj` (all known schema versions) · Collaborative fork `.ghostauto` · PathPlanner `.path` / `.auto` (trajectory generation ported from PathPlannerLib) · PathBlender `.ghpb.json` session files |
| Unified model | `Trajectory` / `TrajectorySample` in WPILib blue-origin meters/radians; `applyAllianceChange` normalizes red-alliance exports |
| Fusion & playback | `SessionTrajectory`, `samplePoseAt`, `sessionDuration`, `serializeSession` / `deserializeSession` |
| Collision checking | `detectCollisions` (bumper OBB-SAT, 0.02 s sampling), `minimumSeparation`, `detectFieldBounds` |
| Fields | `FIELDS` (2018–2020, 2022–2026 — no 2021: that season reused the 2020 field), `makeCustomField`, AprilTag layout parsing (WPILib/PhotonVision JSON) |

Everything is pure: same input, same output, no hidden state.

## Attribution

Trajectory generation for `.path`/`.auto` is a TypeScript port of
PathPlannerLib (MIT, mjansen4857/pathplanner). Red/blue alliance transform
semantics follow WPILib conventions. See the repository NOTICE.md for the
full attribution list.
