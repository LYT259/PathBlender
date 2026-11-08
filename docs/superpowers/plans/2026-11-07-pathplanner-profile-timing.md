# PathPlanner Profile Timing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make PathPlanner trajectory timing reflect each team's real robot configuration — full flat `settings.json` parsing (motor, current limit, module layout, deg→rad defaults), `.auto` regeneration from preserved structure, honest four-state timing provenance, unified application entries, and gated acceptance against the pinned upstream PathPlanner v2025.2.7.

**Architecture:** All work lives in `@pathblender/core` behind backward-compatible additions: profile parsing gains the real v2025.2.7 flat fields, a new `resolveRobotConfig(profile)` becomes the single profile→generator-config seam (recording per-parameter provenance), `.auto` parsing is split into structure-parse + generate so `applyProfileToTrajectory` can regenerate it, and a `timingSource` field on `Trajectory` carries the timing story into sessions and the web inspector. Web entry points (upload / select / folder) all delegate to one core `applyProfileToRobot`.

**Tech Stack:** TypeScript, npm workspaces, Vitest (`npm test -w @pathblender/core`, `npm test -w @pathblender/web`), React inspector UI with the repo's 40-language i18n dictionaries. Reference upstream: PathPlanner **v2025.2.7** (MIT, already credited in `NOTICE.md`).

**Spec:** `PathBlender_红皮书.md` §16.39 (five repair directions; 2026-11-03 user-confirmed, 待实施). Field facts below come from the spec plus the work-package briefing; anything not listed here must be verified against upstream v2025.2.7 source at execution time (read-only learning is permitted; copying MIT code is permitted with attribution).

## Global Constraints

- Upstream reference is pinned to PathPlanner **v2025.2.7** (github.com/mjansen4857/pathplanner, tag `v2025.2.7`). All format/semantics verification cites that tag, not main, not memory. MIT attribution stays in `NOTICE.md`.
- New `@pathblender/core` API must be **backward compatible**: existing exported signatures (`parsePathPlannerAuto`, `applyProfileToTrajectory`, `reparameterize`, `makeRobotConfig`, …) keep working unchanged; new `Trajectory` fields are optional; session files stay version 1 and old files must load unchanged (`@pathblender/core` is GHPaths' published dependency).
- Choreo `.traj` and WPILOG trajectories **carry their own time samples and are never regenerated** — profile application to them is geometry-only (current behavior, keep it asserted).
- Angular defaults in `generationSettings` are **degrees in the file**: `defaultMaxAngVel: 540` means **540 °/s → 9.42478 rad/s** (`540 × π/180 = 9.4247779607…`, assert `toBeCloseTo(9.42478, 4)`); `defaultMaxAngAccel: 720` → 12.56637 rad/s².
- `unlimited: true` global constraints are an **explicit file choice and are never backfilled** with profile/project default constraints (replaces today's `withConstraintFallback` substitution).
- External files are untrusted: plausibility guards + explicit errors, never crash, never silently treat "explicitly unlimited" as "field missing".
- Unknown `driveMotorType` strings must surface as **unsupported** (warning + provenance), never silently substituted by the Kraken default.
- No real official numeric fixtures exist in this repo today (`samples/` has no PathPlanner `settings.json` and no upstream-generated outputs). Acceptance tests that need them must **gate on fixture presence** (`describe.skipIf` / `it.skipIf` + skip reason) — fabricating official numbers is forbidden. Constructed synthetic fixtures are fine for behavior tests (spec direction 5 explicitly allows them), but must never be presented as official alignment.
- Every new UI string is added to **all 40** i18n dictionaries (`packages/web/src/i18n/*.ts`); `packages/web/test/i18n.test.ts` enforces key parity.
- Full-repo `npm run typecheck` and both workspace test suites must pass at every commit; the Beta-merge three-OS full verification (AGENTS.md top section) happens in the merge flow after this plan, not inside it.
- Red book, engineering log, and AGENTS.md are **not** modified by this plan's tasks.

## Current-Code Orientation (verified 2026-11-07 at `7fed5404`)

- `packages/core/src/parsers/robot-profile.ts` — `ppDynamics` reads mass/MOI/COF/wheel radius/gearing/`maxDriveSpeed`; does **not** read `driveMotorType`, `driveCurrentLimit`, or the flat `flModuleX…brModuleY` module fields. `ppDefaultConstraints` copies `defaultMaxAngVel`/`defaultMaxAngAccel` **without deg→rad conversion** (unit bug this plan fixes; an existing test asserts the buggy `540` and must change).
- `packages/core/src/profile-apply.ts` — `applyProfileToTrajectory` never passes motor/current to `makeRobotConfig` (falls back to Kraken X60 @ `60 × numMotors` A); `withConstraintFallback` (line ~25) substitutes profile defaults into `unlimited` paths (to be removed); the success warning `regenerated with real robot config from profile "…"` fires for a mass-only profile (the honesty bug spec direction 4 describes).
- `packages/core/src/parsers/pathplanner-auto.ts` — `parsePathPlannerAuto` generates every segment with `makeRobotConfig()` defaults, returns **no `editable`**; `flattenCommand` treats `deadline` as "unsupported command type ignored" (silently dropped from the timeline).
- `packages/core/src/pathplanner/robot-config.ts:makeRobotConfig` — defaults: wheel radius 0.048 m, max drive 5.45 m/s, gearing 5.143, current `60 × numMotors` A, COF 1.2, mass 74.088 kg, MOI 6.883. Accepts `driveMotor`/`driveCurrentLimitA` but no caller passes them.
- `packages/core/src/pathplanner/dc-motor.ts` — `DCMotor.fromString` maps `krakenX60|krakenX60FOC|falcon500|falcon500FOC|vortex|NEO|CIM|miniCIM`, defaulting **silently** to Kraken (needs a known-type predicate).
- Entry asymmetry: upload → `packages/web/src/robot-profile-ui.ts:applyUploadedProfile` (current trajectory + `routeOptions`); select → `packages/web/src/App.tsx:656 applyProfile` (current trajectory only); folder → `packages/web/src/route-library.ts:88 robotsFromImport` (geometry only, current trajectory only). `packages/core/src/editing.ts:168 reparameterize` calls `makeRobotConfig()` directly. Folder import's path resolver (`App.tsx:543`) already scopes `.path` lookup to the importing folder root — team scoping exists at import and is preserved by this plan.
- `packages/core/src/session.ts:serializeSession` writes an explicit field list — new `Trajectory` fields must be added there and in `deserializeSession` to persist; `routeOptions` trajectories serialize whole.
- Dynamics-sensitive probe for tests: `samples/pathplanner/constrained_pointing.path` (documented: 8.0105 s default-config → 7.6412 s with a tuned config; `Pickup.path` is constraint-masked and timing-invariant under mass-only changes — useful negative probe).
- `.auto` sample: `samples/pathplanner/Example Auto.auto` references paths `Pickup` + `Score`, with two `wait`s and one `named` command.

## Review Focus

Five input classes the spec implies but no single task fully exercises; each is pinned to its owning task's test:

1. **A settings.json from a newer PathPlanner release carrying an unrecognized `driveMotorType`** (e.g. a motor released after v2025.2.7) — user expects a visible "unsupported" note and Kraken fallback, not a silent swap → Task 2 test `unknown motor type is visibly unsupported`.
2. **Angular generation defaults in a real file (deg) applied as rad/s** — today 540 becomes 540 rad/s (60× too fast, masking real angular limits) → Task 1 test `converts angular generation defaults from degrees to radians` (9.42478) plus Task 3's unlimited case (where the substituted value previously bypassed the conversion entirely).
3. **A `.auto` with `deadline` groups** — silently dropped today, so the routine timeline is missing commands a team will actually run → Task 4 test `deadline groups flatten with an approximation warning`.
4. **An old session file saved before `timingSource` existed** (and old warnings strings) — must restore unchanged with the badge treating PathPlanner sources as default-estimate → Task 5 test `pre-timingSource session file restores without the field`.
5. **A folder import containing two different `settings.json` files for one team** — no unambiguous pick; user expects no silent application, both stay selectable options → Task 6 test `multi-profile folders apply nothing automatically`.

---

### Task 1: Parse the full flat v2025.2.7 `settings.json` (module layout, motor, current limit, deg→rad defaults)

**Files:**
- Modify: `packages/core/src/parsers/robot-profile.ts` (`ppDynamics`, `ppDefaultConstraints`, `readModuleLocations`, `ProfileDynamics`)
- Test: `packages/core/test/robot-profile.test.ts`, `packages/core/test/profile-apply.test.ts`

**Interfaces:**
- Consumes: existing `ProfileDynamics`/`ProfileDefaultConstraints` shapes, `num`/`asRecord` helpers.
- Produces: `ProfileDynamics` gains `driveMotorType?: string` (raw string, resolution happens in Task 2) and `driveCurrentLimitA?: number`; `ppDefaultConstraints` returns true rad/s and rad/s² values (`maxAngVelRadPS`, `maxAngAccelRadPSSq`); module locations additionally read from flat `flModuleX/flModuleY, frModuleX/frModuleY, blModuleX/blModuleY, brModuleX/brModuleY` (all eight finite, else ignored) in stable order `[fl, fr, bl, br]`, falling back to nested `modules`/`moduleLocations` when the flat set is absent.

- [ ] **Step 1: Write the failing tests**

In `robot-profile.test.ts` (new `describe('v2025.2.7 flat settings.json fields')`):

- `reads flat module corners, motor type, and current limit` — fixture `JSON.stringify({ robotConfig: { robotWidth: 0.85, robotLength: 0.85, flModuleX: 0.273, flModuleY: 0.273, frModuleX: -0.273, frModuleY: 0.273, blModuleX: 0.273, blModuleY: -0.273, brModuleX: -0.273, brModuleY: -0.273, driveMotorType: 'falcon500FOC', driveCurrentLimit: 80 } })`; assert `moduleLocations` has length 4 with first `{x:0.273, y:0.273}`, `dynamics.driveMotorType === 'falcon500FOC'`, `dynamics.driveCurrentLimitA === 80`.
- `ignores partial flat corners and falls back to nested modules` — only `flModuleX` present → flat set ignored, nested `modules` array still wins; none present → `[]`.
- `rejects non-positive current limit` — `driveCurrentLimit: 0` → `driveCurrentLimitA` undefined.
- `prefers flat corners over nested modules when both exist` — assert flat order wins (upstream writes flat in current versions).

In `profile-apply.test.ts`:

- Update the existing `parses PP settings.json dynamics and generation defaults when carried` test: `defaultMaxAngVel: 540` now asserts `maxAngVelRadPS` `toBeCloseTo(9.42478, 4)`; add `defaultMaxAngAccel: 720` asserting `maxAngAccelRadPSSq` `toBeCloseTo(12.56637, 4)`.
- New: `keeps linear defaults in SI units unchanged` (`defaultMaxVel: 4.5` → 4.5).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @pathblender/core -- robot-profile profile-apply`
Expected: FAIL — flat fields/motor/current unimplemented; angular assertion gets 540 (or NaN) instead of 9.42478.

- [ ] **Step 3: Implement in `packages/core/src/parsers/robot-profile.ts`**

- Extend `ProfileDynamics` with the two fields (doc comment: raw upstream field names `driveMotorType`/`driveCurrentLimit`).
- `ppDynamics`: map `driveMotorType` (string, non-empty → keep; anything else undefined) and `driveCurrentLimitA` (finite and > 0).
- `ppDefaultConstraints`: multiply angular values by `π/180` before the positivity guard (keep the guard on the converted value).
- `readModuleLocations`: try the flat set first (helper `readFlatModuleLocations(source)`); all eight must be finite or return null; else existing nested path.
- Then verify the field inventory against upstream: fetch the **v2025.2.7 tag** zip of `mjansen4857/pathplanner` (direct zip download, no recursive API scans — AGENTS red line 4) and check the robotConfig serialization (`lib/config/robot_config.dart` or equivalent at that tag). Every field present there that this parser does not consume gets a one-line comment in `ppDynamics` marking it not-consumed-with-reason (e.g. display-only fields); if the tag carries additional generation-relevant fields beyond the briefing list, map them the same guarded way and extend the tests. Record the verified field list in the commit body.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @pathblender/core -- robot-profile profile-apply`
Expected: PASS (all green in both files).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/parsers/robot-profile.ts packages/core/test/robot-profile.test.ts packages/core/test/profile-apply.test.ts
```

```bash
git commit -m "feat(core): parse full flat PathPlanner settings.json fields with deg-to-rad angular defaults"
```

### Task 2: Build the generation config from the profile — motor, current limit, per-parameter provenance

**Files:**
- Modify: `packages/core/src/pathplanner/dc-motor.ts` (add `isKnownMotorType`), `packages/core/src/profile-apply.ts` (`resolveRobotConfig` + rewire `applyProfileToTrajectory`), `packages/core/src/index.ts` (exports)
- Test: `packages/core/test/profile-apply.test.ts`

**Interfaces:**
- Consumes: Task 1 `ProfileDynamics` fields; `makeRobotConfig(partial)`; `DCMotor.fromString(type, numMotors).withReduction(gearing)`.
- Produces (exported from `@pathblender/core`):

```ts
export type DynamicsParamKey =
  | 'massKG' | 'moiKGm2' | 'wheelCOF' | 'wheelRadiusM' | 'driveGearing'
  | 'maxDriveVelocityMPS' | 'driveMotorType' | 'driveCurrentLimitA'
  | 'moduleLocations' | 'holonomic';
export type DynamicsParamSource = 'file' | 'default' | 'invalid' | 'unsupported';
export type DynamicsProvenance = Partial<Record<DynamicsParamKey, DynamicsParamSource>>;
export interface ResolvedRobotConfig {
  config: RobotConfig;
  provenance: DynamicsProvenance;
  /** Raw motor string when driveMotorType is not a known model. */
  unknownMotorType?: string;
}
export function resolveRobotConfig(profile: RobotProfile): ResolvedRobotConfig;
export function dynamicsConfigComplete(provenance: DynamicsProvenance): boolean;
```

plus `DCMotor.isKnownMotorType(type: string): boolean` (exact `fromString` case list).

- [ ] **Step 1: Write the failing tests**

New `describe('resolveRobotConfig (motor, current, provenance)')` in `profile-apply.test.ts`, all against `parsePathFile(read('pathplanner/constrained_pointing.path'))`:

- `motor type reaches the generator and changes a dynamics-limited timeline` — full synthetic profile with `driveMotorType: 'falcon500'` (less torque than default Kraken) vs `'krakenX60'`: `applyProfileToTrajectory` durations differ, falcon longer; both `< ` default-config duration with the same mass (sanity).
- `current limit reaches the generator` — same profile with `driveCurrentLimitA: 20` vs `80`: durations differ (20 A longer).
- `unknown motor type is visibly unsupported` — `driveMotorType: 'madeUp2027'`: `resolveRobotConfig().unknownMotorType === 'madeUp2027'`, `provenance.driveMotorType === 'unsupported'`, applied trajectory warnings contain `drive motor "madeUp2027" not supported`.
- `invalid current limit is recorded, not applied` — `driveCurrentLimit: -5` at parse → provenance `driveCurrentLimitA === 'invalid'`, config uses default.
- `provenance marks every consumed parameter` — complete synthetic profile (mass, MOI, COF, wheel radius, gearing, max speed, motor, current, flat modules, `holonomicMode: true`) → every key `'file'`, `dynamicsConfigComplete === true`; drop motor → `false` with `driveMotorType === 'default'`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @pathblender/core -- profile-apply`
Expected: FAIL — `resolveRobotConfig` not exported; motor/current tests fail (durations identical, Kraken fallback both sides).

- [ ] **Step 3: Implement**

- `dc-motor.ts`: add `static isKnownMotorType(type: string)` returning membership in the exact `fromString` case set.
- `profile-apply.ts`: implement `resolveRobotConfig` — the one algorithm block:

```ts
// provenance mapping: for each scalar key, 'file' when the profile carries a
// guard-passing value, 'invalid' when present-but-rejected, 'unsupported' for
// an unknown motor string, 'default' when absent. moduleLocations: 'file'
// when profile.moduleLocations.length > 0. holonomic: 'file' when boolean.
// config = makeRobotConfig({...mapped fields, driveMotor built only when
// isKnownMotorType: DCMotor.fromString(type, numMotors).withReduction(gearing ?? 5.143)})
// with numMotors = profile.holonomic === false ? 2 : 1 — mirroring
// makeRobotConfig's own default chain exactly.
```

- Rewire `applyProfileToTrajectory`'s regen branch to use `resolveRobotConfig(profile).config`; append the unknown-motor warning when `unknownMotorType` is set. Do **not** change warning/timing-source strings yet (Task 5 does); the existing `regenerated with real robot config…` string stays for now so this task stays focused.
- Export the new types/function from `packages/core/src/index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @pathblender/core -- profile-apply`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/pathplanner/dc-motor.ts packages/core/src/profile-apply.ts packages/core/src/index.ts packages/core/test/profile-apply.test.ts
```

```bash
git commit -m "feat(core): build generation config from profile motor and current limit with per-parameter provenance"
```

### Task 3: `unlimited` global constraints stay unlimited (no profile-default backfill)

**Files:**
- Modify: `packages/core/src/profile-apply.ts` (remove `withConstraintFallback`)
- Test: `packages/core/test/profile-apply.test.ts`

**Interfaces:**
- Consumes: Task 2 wiring; `constraintsForPos` already handles `unlimited` via `Number.POSITIVE_INFINITY` (`packages/core/src/pathplanner/path-points.ts:61`).
- Produces: no new API — behavior change only. `ProfileDefaultConstraints` parsing stays (data + Task 1 units fix); it is no longer applied to paths.

- [ ] **Step 1: Write the failing tests**

Replace the existing test `fills unlimited global constraints from profile generation defaults, never file data` with `unlimited global constraints are never backfilled from the profile`:

- Same unlimited-path fixture construction as the old test (mutate `editable.path.globalConstraints` to `unlimited: true`); apply a profile carrying `generationSettings` defaults; assert `filled.editable.path.globalConstraints.unlimited === true`, `maxVelocityMPS` unchanged from the fixture (999), and the applied duration equals the duration of applying a profile with **no** `generationSettings` (the two cases must be identical).
- Keep/extend the sibling assertion: a **non-unlimited** path's file-carried constraints survive application unchanged (the old test's `carried.globalConstraints.unlimited === false` half).
- Add: `unlimited path keeps the estimate warning lineage` — warnings still contain `path has unlimited global constraints` after application.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @pathblender/core -- profile-apply`
Expected: FAIL — current code flips `unlimited` to false and substitutes 3.0/2.0.

- [ ] **Step 3: Implement**

Delete `withConstraintFallback` and its call; regenerate from `editable.path` verbatim. Update the module doc comment (top of `profile-apply.ts`) and the `withConstraintFallback` doc block — the "project defaults fill unlimited paths" story is gone; cite upstream v2025.2.7 semantics in a comment (at execution time, confirm in the tag's path-loading code that `unlimited` maps to unconstrained values and is never merged with project defaults; record the file you checked in the comment).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @pathblender/core -- profile-apply && npm test -w @pathblender/core -- pathplanner`
Expected: PASS (pathplanner suite confirms generation itself is untouched).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/profile-apply.ts packages/core/test/profile-apply.test.ts
```

```bash
git commit -m "fix(core): keep unlimited path constraints instead of backfilling profile defaults"
```

### Task 4: `.auto` structure preservation, `deadline` handling, and profile-based regeneration

**Files:**
- Modify: `packages/core/src/parsers/pathplanner-auto.ts` (split parse/generate), `packages/core/src/editing.ts` (`EditablePath` variant), `packages/core/src/profile-apply.ts` (auto branch), `packages/core/src/index.ts` (exports)
- Test: `packages/core/test/pathplanner.test.ts` (`.auto routine semantics`), `packages/core/test/profile-apply.test.ts`

**Interfaces:**
- Consumes: `AutoSegment` (unchanged, already exported), `makeRobotConfig`, `generateTrajectory`, Task 2 `resolveRobotConfig`.
- Produces:

```ts
export interface ParsedAuto {
  name: string;
  segments: AutoSegment[];
  /** Parsed .path source per referenced pathName (team-scoped at import). */
  paths: Record<string, ParsedPath>;
  /** Non-fatal command-tree findings (parallel/race/group/deadline/unknown). */
  commandWarnings: string[];
}
export function parseAutoStructure(
  text: string, fileName: string,
  resolvePath: (pathName: string) => string | undefined,
): ParsedAuto;                       // throws the same ParseErrors as today
export function generateAutoTrajectory(
  auto: ParsedAuto, config: RobotConfig,
): { samples: TrajectorySample[]; events: TrajectoryEvent[]; warnings: string[] };
```

and `EditablePath` gains `| { kind: 'pathplanner-auto'; auto: ParsedAuto }`. `parsePathPlannerAuto(text, fileName, resolvePath)` keeps its exact signature and current output shape **plus** `editable: { kind: 'pathplanner-auto', auto }` — pure addition, backward compatible. Warnings contract: `generateAutoTrajectory` returns `commandWarnings` + per-path `parseWarnings` + segment-chaining warnings only; the `generated with default robot config (Kraken X60 swerve)…` claim is prepended by the `parsePathPlannerAuto` wrapper (it knows it used `makeRobotConfig()`), and profile application builds its own timing warnings per Task 5 — the generator itself never claims a config.

- [ ] **Step 1: Write the failing tests**

In `pathplanner.test.ts` `.auto routine semantics`:

- `parsePathPlannerAuto preserves the editable auto structure` — parse `Example Auto.auto` with a resolver over `Pickup.path`/`Score.path`; assert `editable.kind === 'pathplanner-auto'`, `auto.segments` length 5 (path, wait, named, wait, path), `Object.keys(auto.paths)` = `['Pickup', 'Score']`.
- `deadline groups flatten with an approximation warning` — synthetic `.auto` JSON with a `deadline` node wrapping two paths; assert both segments present, warnings contain `"deadline" command group approximated as sequential` (group actually ends when its first command finishes — the sequential sum is an upper-bound estimate), and the old `unsupported command type "deadline" ignored` message is gone.
- `structure round-trips through structuredClone and regenerates identically` — `generateAutoTrajectory(structuredClone(auto), makeRobotConfig())` twice → deep-equal samples/events.

In `profile-apply.test.ts` (new `describe('.auto regeneration')`):

- `applying a profile regenerates every segment, shift, and event` — parse the sample `.auto`, apply a dynamics profile (Task 2 full synthetic set with lighter mass or lower current on a dynamics-sensitive referenced path — construct a constrained referenced path if the bundled ones are constraint-masked): `durationS` changes, `editable` survives as `pathplanner-auto`, event times shift consistently (first event offset changes by the first segment's duration delta), `wait` durations preserved exactly (samples with zero velocity at the same relative offsets), `named` stays a zero-duration event with its warning.
- `regeneration is deterministic` — applying the same profile twice to fresh parses yields deep-equal samples.
- `Choreo and WPILOG trajectories are still never regenerated` — `applyProfileToTrajectory` on `v3_swerve.traj` and a wpilog-derived trajectory leaves `samples` reference-equal (extend the existing Choreo test with the wpilog case using `extractWpilogTrajectory` on the bundled sample, or the smallest existing wpilog test fixture builder).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @pathblender/core -- pathplanner profile-apply`
Expected: FAIL — no `editable` on `.auto`, `deadline` unsupported, no auto branch in apply.

- [ ] **Step 3: Implement**

- `pathplanner-auto.ts`: extract `flattenCommand` + resolution loop into `parseAutoStructure` (throws the exact current ParseErrors: missing command tree, no segments, unresolved path, referenced-path parse failure, no motion); extract the generation loop into `generateAutoTrajectory` (keeps wait sampling at 10 Hz, chaining/discontinuity warnings, event shifts); `parsePathPlannerAuto` becomes parse → `makeRobotConfig()` → generate → wrap (now also attaching `editable`). Add `case 'deadline'` to `flattenCommand` alongside `parallel`/`race`/`group` with its own warning string.
- `editing.ts`: add the `EditablePath` variant. Waypoint-edit functions (`clonePp`) already throw for non-`pathplanner` kinds — `.auto` correctly stays non-waypoint-editable; leave as is.
- `profile-apply.ts`: in the regen gate, accept both `editable.kind === 'pathplanner'` and `'pathplanner-auto'`; for auto use `generateAutoTrajectory(auto, resolveRobotConfig(profile).config)`, replacing samples/events/duration while keeping the `base` geometry/module provenance spread.
- Export `ParsedAuto`, `parseAutoStructure`, `generateAutoTrajectory` from `index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @pathblender/core -- pathplanner profile-apply parsers`
Expected: PASS (parsers suite covers `parsePathFile` dispatch, unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/parsers/pathplanner-auto.ts packages/core/src/editing.ts packages/core/src/profile-apply.ts packages/core/src/index.ts packages/core/test/pathplanner.test.ts packages/core/test/profile-apply.test.ts
```

```bash
git commit -m "feat(core): preserve PathPlanner auto structure, handle deadline, regenerate per profile"
```

### Task 5: `timingSource` four-state provenance + session persistence

**Files:**
- Modify: `packages/core/src/types.ts` (`TimingSource`, `Trajectory.timingSource?`), `packages/core/src/parsers/pathplanner-path.ts` + `pathplanner-auto.ts` (set `'default-config'`), `packages/core/src/parsers/wpilog/extract.ts:604` area (set `'logged'`), `packages/core/src/profile-apply.ts` (set `'partial-config'`/`'full-config'` + honest warnings), `packages/core/src/session.ts` (serialize/deserialize), `packages/core/src/index.ts` (type export)
- Test: `packages/core/test/profile-apply.test.ts`, `packages/core/test/session.test.ts`, `packages/core/test/wpilog.test.ts`

**Interfaces:**
- Consumes: Task 2 `dynamicsConfigComplete`.
- Produces: `export type TimingSource = 'default-config' | 'partial-config' | 'full-config' | 'logged';` and `Trajectory.timingSource?: TimingSource`. Semantics per spec direction 4: ① default estimate, ② partial estimate, ③ generated from imported config (still a plan, not a measurement), ④ logged run. Choreo/`.ghostauto` keep `undefined` — their samples come from the original tool and PathBlender makes no timing claim. Warning strings: full keeps `regenerated with real robot config from profile "<name>"`; partial becomes `timing re-estimated with partial robot config from profile "<name>" — defaults fill: <comma-separated defaulted keys>`; unknown motor appends the Task 2 warning. Partial application must **not** drop the estimate story (the §16.39 direction-4 bug).

- [ ] **Step 1: Write the failing tests**

- `profile-apply.test.ts`: update the two affected assertions and add states — mass-only profile on `constrained_pointing.path` → `timingSource === 'partial-config'`, warnings contain `timing re-estimated with partial robot config` and list the defaulted keys, and no longer contain the unconditional `regenerated with real robot config`; full synthetic profile → `'full-config'` with the original full warning string; no-dynamics profile → `'default-config'` unchanged; `parsePathFile('Pickup.path')` → `'default-config'`; `.auto` import → `'default-config'`, after full-profile application → `'full-config'`.
- `wpilog.test.ts`: extracted trajectory has `timingSource === 'logged'` (find the existing extraction test and extend its assertions).
- `session.test.ts`: `timingSource survives the session round trip` (full + partial + logged robots); `pre-timingSource session file restores without the field` — hand-written minimal session JSON (no `timingSource` key, one robot) deserializes with `timingSource === undefined` and samples intact.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @pathblender/core -- profile-apply session wpilog`
Expected: FAIL — field/type missing everywhere.

- [ ] **Step 3: Implement**

- Add the type + optional field in `types.ts` (doc comment carries the four-state semantics and the Choreo-undefined decision).
- Set `'default-config'` in both PathPlanner parsers, `'logged'` in the wpilog extraction construction.
- In `applyProfileToTrajectory`: partial/full per `dynamicsConfigComplete(provenance)`; build the partial warning from provenance keys whose source is `'default'`/`'invalid'`/`'unsupported'`; geometry-only base keeps the trajectory's existing `timingSource`.
- `session.ts`: add `timingSource: st.trajectory.timingSource` to the serializer's robot field list and `timingSource: r.timingSource` (+ optional field on the `SessionFileV1` robot type) in `deserializeSession`.
- Export `TimingSource` from `index.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @pathblender/core`
Expected: PASS (whole core suite — this task touches shared types).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/parsers/pathplanner-path.ts packages/core/src/parsers/pathplanner-auto.ts packages/core/src/parsers/wpilog/extract.ts packages/core/src/profile-apply.ts packages/core/src/session.ts packages/core/src/index.ts packages/core/test/profile-apply.test.ts packages/core/test/session.test.ts packages/core/test/wpilog.test.ts
```

```bash
git commit -m "feat(core): track timing source status and persist it in sessions"
```

### Task 6: Unify the three application entries and bind edits to the applied config

**Files:**
- Modify: `packages/core/src/profile-apply.ts` (`applyProfileToRobot`), `packages/core/src/editing.ts` (`reparameterize` optional profile), `packages/core/src/index.ts`, `packages/web/src/robot-profile-ui.ts`, `packages/web/src/App.tsx:656 applyProfile`, `packages/web/src/route-library.ts:88 robotsFromImport`
- Test: `packages/core/test/profile-apply.test.ts`, `packages/web/test/robot-profile-ui.test.tsx`, `packages/web/test/route-library.test.ts` (create if absent — check `packages/web/test/` first; otherwise fold route-library assertions into `robot-profile-ui.test.tsx`)

**Interfaces:**
- Consumes: Tasks 2/4/5 `applyProfileToTrajectory` behavior.
- Produces: `export function applyProfileToRobot(robot: SessionTrajectory, profile: RobotProfile): SessionTrajectory` — applies to `robot.trajectory` **and** every `routeOptions[].trajectory`; does not touch `profileOptions`/`profileId` (callers own bookkeeping). Web upload/select/folder all delegate to it. `reparameterize(traj: Trajectory, profile?: RobotProfile): Trajectory` — optional second parameter (pure addition; no existing caller breaks). Sequence segments need no separate handling: they resolve through `routeOptions`, which are now applied.

- [ ] **Step 1: Write the failing tests**

- Core `profile-apply.test.ts`: `applyProfileToRobot regenerates the current trajectory and every route option` — robot with a `.path` current trajectory + two route options (one `.path`, one `.auto`): all three get `geometrySource 'file'`, regenerable ones get new durations, Choreo option samples untouched; `profileId`/`profileOptions` unchanged by the core function.
- Core: `reparameterize honors a bound profile` — edited `constrained_pointing.path` (`movePpWaypoint`) + profile with lighter mass → `reparameterize(traj, profile).durationS` differs from `reparameterize(traj)`; without a profile the old default-config behavior is bit-identical to today.
- Web `robot-profile-ui.test.tsx`:
  - `upload and select entries produce identical application` — `applyUploadedProfile(robot, profile, 'x/settings.json')` route-option trajectories deep-equal `applyProfileToRobot(robot, profile)` route-option trajectories (bookkeeping aside);
  - `selecting a profile from the inspector applies it to the whole route library` — App-level render (existing pattern in this file): import a team folder with a `.path` + `.auto` + `settings.json`, then select the profile via the inspector dropdown; assert the library routes' durations changed and `robot.profileId` set (today's select-entry bug: only the current trajectory changed);
  - `multi-profile folders apply nothing automatically` — `robotsFromImport` with two profiles: no application, both listed in `profileOptions`, `profileId` undefined;
  - `teams in one import never share profiles` (spec direction 5, multi-team non-pollution) — `robotsFromImport` with two folders in one batch, each carrying its own `settings.json` + `constrained_pointing.path`: each robot's regeneration reflects only its own folder's profile (different masses → different durations per team), and neither robot lists the other team's profile in `profileOptions`;
  - `single-profile folder import now regenerates timing, not just geometry` — folder with one settings.json + `constrained_pointing.path`: `robotsFromImport` output has regenerated duration ≠ raw import duration and `timingSource` set.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @pathblender/core -- profile-apply && npm test -w @pathblender/web -- robot-profile-ui`
Expected: FAIL — `applyProfileToRobot` missing; select entry leaves route options unchanged; folder entry geometry-only.

- [ ] **Step 3: Implement**

- Core `applyProfileToRobot` (spread `robot`, map both levels through `applyProfileToTrajectory`).
- `editing.ts`: `reparameterize` second optional param; when `profile?.dynamics` exists and `editable.kind === 'pathplanner'` generate with `resolveRobotConfig(profile).config`, else today's `makeRobotConfig()`.
- Web: `applyUploadedProfile` = append option + set `profileId` + `applyProfileToRobot`; `App.tsx applyProfile` = set `profileId` + `applyProfileToRobot`; `route-library.ts robotsFromImport` single-profile branch = set `profileId` + `applyProfileToRobot` (preserving the existing `geometrySource !== 'file'` guard so file-carried geometry is never clobbered).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @pathblender/core -- profile-apply && npm test -w @pathblender/web -- robot-profile-ui route-library`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/profile-apply.ts packages/core/src/editing.ts packages/core/src/index.ts packages/web/src/robot-profile-ui.ts packages/web/src/App.tsx packages/web/src/route-library.ts packages/core/test/profile-apply.test.ts packages/web/test/robot-profile-ui.test.tsx
```

```bash
git commit -m "feat: unify profile application across upload, select, and folder entries"
```

(Add the route-library test file to `git add` if one was created.)

### Task 7: Inspector timing badge + i18n in all 40 languages

**Files:**
- Modify: `packages/web/src/robot-profile-ui.ts` (`displayTimingSource` helper), `packages/web/src/components/RobotList.tsx` (`RobotInspector`), all 40 `packages/web/src/i18n/*.ts` dictionaries
- Test: `packages/web/test/robot-list.test.tsx`

**Interfaces:**
- Consumes: Task 5 `Trajectory.timingSource`.
- Produces: `export function displayTimingSource(traj: Trajectory): TimingSource | undefined` — returns `traj.timingSource ?? (traj.source === 'wpilog' ? 'logged' : traj.source.startsWith('pathplanner') ? 'default-config' : undefined)` so old sessions (saved before the field existed) and fresh imports read alike; Choreo/ghostauto show no badge. New i18n keys (8): `robots.timingDefault`, `robots.timingPartial`, `robots.timingFull`, `robots.timingLogged` (badge labels) and `…Hint` variants (titles). Proposed English initial values (spec direction 4 defers final copy/style to implementation review — these are the plan's defaults, tweaks need no new plan): `Default-estimate timing` / `Partial-config timing` / `Real-config timing` / `Logged run`; hints: `Estimated with PathBlender's default robot config` / `Some timing parameters fell back to PathBlender defaults` / `Generated from this team's imported robot config — still a plan, not a measurement` / `Recorded from the robot's log during an actual run`. Badge renders in the inspector data section next to (visually distinct from) the geometry `fromFile/notUploaded` badge, per direction 4's "size-imported ≠ time-calibrated" separation.

- [ ] **Step 1: Write the failing tests**

In `robot-list.test.tsx` (new `describe('timing source badge')`, rendering `RobotInspector` with minimal fixture robots):

- `shows the badge for each timing state` — four fixtures (`timingSource` set to each value) render the matching label; a trajectory with `undefined` timingSource and `source: 'choreo-traj'` renders none.
- `old sessions read as default estimate` — PathPlanner-source trajectory without `timingSource` (via `displayTimingSource`) shows the default label.
- `partial badge does not claim real config` — partial fixture must not contain the full-config label text.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -w @pathblender/web -- robot-list`
Expected: FAIL — helper/badge absent, keys missing.

- [ ] **Step 3: Implement**

Add `displayTimingSource` + badge markup (reusing the existing `robot-data-source` class family with a timing modifier class), then add the 8 keys to `en.ts` and translate in every other dictionary file (40 total; `packages/web/test/i18n.test.ts` enforces parity — keep translations short and follow each file's existing tone; terminology consistent with the glossary `docs/i18n-glossary.md` where it covers these words).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -w @pathblender/web -- robot-list i18n`
Expected: PASS (i18n parity across all dictionaries).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/robot-profile-ui.ts packages/web/src/components/RobotList.tsx packages/web/src/i18n packages/web/test/robot-list.test.tsx
```

```bash
git commit -m "feat(web): show timing source badge in robot inspector across 40 languages"
```

### Task 8: Gated acceptance against pinned PathPlanner v2025.2.7 references + final validation

**Files:**
- Create: `samples/pathplanner/reference/README.md`, fixture files under the same dir **only if real ones are obtained**, `packages/core/test/pathplanner-reference.test.ts`
- Test: `packages/core/test/pathplanner-reference.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: a self-gating acceptance suite + a documented fixture protocol. No product code changes expected in this task (if acceptance exposes a defect, fix it in its owning area as a separate commit following that area's task pattern).

- [ ] **Step 1: Write the gated test harness (fails only when fixtures exist and disagree)**

`pathplanner-reference.test.ts`:

```ts
const FIXTURE_DIR = resolve(__dirname, '../../../samples/pathplanner/reference');
const fixtures = loadReferenceFixtures(FIXTURE_DIR); // [{ name, pathFile, settingsFile, expected }]
describe.skipIf(fixtures.length === 0)('official PathPlanner v2025.2.7 reference acceptance', () => { … });
it('documents the gate when fixtures are absent', () => {
  if (fixtures.length > 0) return; // real assertions run above
  expect(fixtures).toHaveLength(0); // gate, not a pass: see README
});
```

Each fixture case parses its `settings.json` + `.path` (or `.auto` with referenced paths) through this repo's pipeline and asserts, per the README's declared basis: total duration within the declared tolerance, velocity/acceleration curve peaks, pose+heading at declared sample times, locally-capped zones, start/end velocities, and `.auto` segment joins. Fixtures are described by a `manifest.json` in the fixture dir (one entry per case: name, file names, upstream provenance incl. tag, expected values, any tolerance override with reason); `loadReferenceFixtures` reads that manifest — an empty or absent manifest means zero fixtures and the gate stays closed. Declared defaults for the README (record, don't invent tighter ones): sampling = this repo's generator output vs upstream golden samples at the fixture's own timesteps; tolerance = total duration ±2%, position ±5 cm, heading ±3°, velocity ±0.2 m/s — any relaxation must be recorded with a reason in the README.

- [ ] **Step 2: Run the harness to verify the gate behavior**

Run: `npm test -w @pathblender/core -- pathplanner-reference`
Expected: with no fixtures — the suite runs 1 gate test, reference describe reports skipped (verify skip reason visible in vitest output); never a green "official alignment" claim.

- [ ] **Step 3: Obtain fixtures or record their absence — honestly**

Fixture sources, in order: (a) the upstream **v2025.2.7 tag** zip — `examples/*/deploy/pathplanner/` real projects (settings.json + paths) plus any committed golden generation outputs in its test resources; (b) user-provided real exports generated by PathPlanner v2025.2.7. Record each fixture's origin, the exact tag, and SHA256 in `samples/pathplanner/reference/README.md` (README also notes MIT provenance; NOTICE.md already credits the project — add the reference-sample line there only if files land). Add a `licenses/` entry only if upstream licensing requires more than the existing notice (it does not for MIT). If no real fixture can be obtained, the README states that plainly and the gate stays — **do not synthesize "official" numbers**.

- [ ] **Step 4: If fixtures landed, run the acceptance**

Run: `npm test -w @pathblender/core -- pathplanner-reference`
Expected: PASS within declared tolerances, or documented failures routed back to owning tasks (spec: no filling in "passed" without running).

- [ ] **Step 5: Final whole-repo validation**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; core + web suites green. Then `git status` — no stray files beyond this task's additions.

- [ ] **Step 6: Commit**

```bash
git add samples/pathplanner/reference packages/core/test/pathplanner-reference.test.ts
```

```bash
git commit -m "test(core): gated acceptance against pinned PathPlanner v2025.2.7 references"
```

(If NOTICE.md was touched, include it in `git add`.)

---

## Externally Unverifiable Items (do not fake, do not claim)

- **Official numeric outputs** at v2025.2.7 exist only if real fixtures land (Task 8 gate). Until then, no test, doc, or release note may claim official alignment; behavior tests use constructed fixtures and say so.
- **Real team `settings.json` files** — none in `samples/` today; all parsing tests use synthetic-but-upstream-shaped fixtures, and `docs/formats/format-facts.md` currently records no such sample. When a real one arrives, add it and update the facts doc then.
- **Real-robot execution** — `full-config` timing is still a plan, never a measurement (spec direction 4); no UI copy or doc may blur this, and logged (WPILOG) vs planned trajectories must stay distinguishable.
- **Real upstream semantics beyond the briefing's facts** — anything discovered at execution time comes from the pinned tag with file citations, not from memory or `main`.
- Three-OS Beta verification, release, and version bump happen in the merge flow (AGENTS.md), not in this plan.

## Out of Scope

- WPILOG/HOOT import scheduling (§16.39 explicitly excludes), §16.40 BLE sharing, §16.41 path lib/video exploration.
- Porting the Choreo optimizer; Choreo timing stays as-is.
- `useDefaultConstraints` handling beyond documenting the tag's semantics (no behavior change planned — the file's `globalConstraints` remain authoritative as today; revisit only if Task 8 fixtures contradict).
- The vestigial `Trajectory.regenFrom` field — left untouched (public type; removal would not be backward compatible).
