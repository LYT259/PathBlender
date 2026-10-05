# MK5i module CAD → glTF pipeline (private; not shipped)

Builds `packages/web/public/models/mk5i-module.glb` — the 3D swerve
module instanced 4× per robot. User decision 2026-10-02: the modules
must be real CAD; a hand-modeled approximation looks wrong when zoomed
in. Same-day follow-up decision: use the **FRC Designs Onshape
re-creation** (it models the two Kraken X60 motors, which the official
SDS export does not — SDS never ships motors).

## Provenance

- **Shipped geometry** — "MK5i DesignApp.step" (FRC Designs Onshape
  module, exported by the user 2026-10-02):
  sha256 `8ee3d6af0843d0a62502dc38c04e0d80b0dd948d36a2f0d9cb4dbf2cc9deac1a`.
  It is a community re-creation, not SDS's own geometry; core
  dimensions match the official layout drawing (module height
  6.16–6.17 in both; 18 named parts incl. 2× Kraken X60, turret,
  molded wheel, L plate, fasteners). **License UNVERIFIED — blocks any
  public release** (release-checklist item, AGENTS.md red line 2):
  the correct domain is **frcdesign.org** (the old note's
  `frcdesigns.com` was wrong). Research 2026-10-05: the site is a
  community open-source CAD course, but the active GitHub repos
  (`frcdesign/FRCDesign.org`, `frcdesign/FRCDesignApp`) carry **no
  LICENSE file** (default = all rights reserved); the archived repos
  (`FRCDesign-MKDocs`, `design-challenges-bot`) are GPL-3.0; no public
  statement grants redistribution/embedding rights for the CAD models.
  Resolution paths before any release: (a) written permission from the
  FRC Design team (Chief Delphi / GitHub), or (b) replace the module
  geometry (official SDS export has no motors; procedural fallback
  exists in `chassis3d.ts`).
- **Reference geometry kept for audit** — the official SDS Parasolid
  `mk5i.x_t` (product page → "CAD Model" Google Drive link;
  `attachment; filename="MK5i.x_t"`), sha256
  `b9a36e6bb3a948c04217f2f55293cf283b91d8151bd1ad5e7d789cff7008d203`,
  byte-identical across two downloads and the user's copy. Its Onshape
  STEP re-export ("MK5i Official.step") measured 7.45×7.45 in plan ×
  6.16 in high — used to cross-check the FRC Designs core dims.
- Parasolid has no open-source reader, so both STEP hops went through
  Onshape (user-side); everything after STEP is automated below.

## Rebuild (deterministic)

```sh
blender --background --python scripts/cad/mk5i-convert.py -- \
  ~/Downloads/MK5i\ DesignApp.step packages/web/public/models/mk5i-module.glb
```

Calibration is measured from the mesh (steering axis = turret bbox
center, floor = wheel bottom, rolling dir = wheel axle ⊥), baked into
vertices — no operator semantics, byte-reproducible runs.

## Acceptance (checked 2026-10-03 build)

- bbox after normalize: `[-0.1084, -0.0917, 0] .. [0.1082, 0.0926, 0.1564]`
  — floor exactly z=0, steering axis straddles the origin, height
  0.1564 m ≈ 6.16 in vs official drawing 6.17 in (decimation loss
  0.0007 m), plan 0.217×0.184 m with the long edge along the rolling
  axis ±X; motors sit fore/aft along ±X, offset +Y ≈ 0.06. (The
  2026-10-02 notes described the mis-rotated build: axle on +X,
  "motors flank ±Y" — that was the ROLL_SWAP regression, fixed by
  rotating the template -90° about the up axis.)
- 55,137 triangles (~24 material primitives).
- Runtime loader sanity-checks height 0.10–0.35 m and plan X > Z
  (rolling is the long plan axis) and falls back to the procedural
  module if either ever fails.

## Runtime contract (mirrored in web/src/chassis3d.ts)

- meters, +Y up, single scene root;
- origin = steering axis ∩ floor; +X = the wheel's rolling direction
  (steering 0 = straight ahead);
- small enough to clone 4× per robot with shared GPU buffers
  (a few meshes / tens of thousands of triangles).

## Box/turret split + chassis measurements (2026-10-03)

The shipped GLB is now two nodes — `mk5i-box` (static: top plate, both
Kraken motors, L plate) and `mk5i-turret` (steers: fork + wheel) — so
the app yaws only the turret, matching the real robot where the box is
bolted to the rail.

- **Split tool** — `scripts/cad/mk5i-split-glb.py`, pure python3
  stdlib (no Blender). Input is the DesignApp-exported module GLB
  exactly as shipped at git `9250d4b` (backup:
  `/tmp/mk5i-module-design.glb`). It re-groups per TRIANGLE: a
  triangle is turret iff every vertex sits inside the fork/wheel
  column around the steering axis (`|x| <= 0.0518`, `|z| <= 0.0518` —
  fork bbox measured on the chassis STEP's named Turret Assembly) AND
  it either touches the floor (`ymin <= 0.001`, the wheel) or is no
  taller than the fork (`ymax <= 0.0775`); everything else is box.
  Materials are preserved and all node transforms are flattened to
  identity — a pure re-grouping: no decimate, no calibration. Result:
  box 46,548 + turret 8,589 = 55,137 triangles, exactly the source
  total; measured turret bbox x ±0.0518, y 0..0.0775,
  z -0.0518..0.0512.
- **Why not the chassis STEP** — "MK5i Chassis 27*27.step" (literal
  `*` in the filename) is internally mis-mated: its Top Assembly +
  Kraken motors hang 55–87 mm BELOW the wheel floor and the top cover
  is missing, and the Blender decimate/loose-parts route shattered the
  module into hundreds of pieces. Every STEP-based split attempt
  failed, hence the triangle-level script on the shipped GLB itself.
- **Steering-axis positions** — the four turret bbox centers in the
  chassis STEP are the true steering axes: ±0.27625 m, symmetric in
  render coordinates. This is the measured basis for
  `MODULE_INSET_FRACTION = 0.8056` in
  `packages/core/src/robot-geometry.ts`.
- **Fastener cross-check** — the chassis GLB carries all 64 fasteners
  (20× 2-1/2 in long bolts — 5 per corner in an L pattern — plus 24
  short bolts and 20 nuts); positions match the STEP within 0.33 mm.

## Mount height — plate-bottom face (CORRECTED 2026-10-04)

The frame/module stack-up in `chassis3d.ts` (`MODULE_MOUNT_Y_M`) needs
the module mounting-plate BOTTOM face height above the wheel floor,
measured on the shipped module GLB.

- **Correct value: module-y 0.092126 m** — the GLB's largest
  full-footprint downward-facing plane (area ≈ 0.037 m² ≈ the whole
  module plan). Internal consistency: fork top 0.0775 < plate 0.0921 ✓;
  wheel top 0.1016 pokes 9.5 mm through the plate cutout ✓; frame bolt
  heads (frame-y 0.0695 + 0.0306 lift ≈ 0.1001) stand ~4 mm over the
  plate top ≈ 0.0961 ✓.
- **The earlier 0.042118 m reading was a misidentified face** — the
  fork/gearbox underside. It put the plate BELOW the fork top
  (impossible), sank the frame assembly 19.4 mm UNDER the field floor
  ("metal frame touches the ground", user 2026-10-04) and floated the
  real plate 50 mm above the rails.
- Result: `MODULE_MOUNT_Y_M = 0.061516 (rail top, frame-y) − 0.092126
  = −0.030610` — NEGATIVE, i.e. the frame assembly RISES 30.6 mm;
  belly pan clears the floor by 30.6 mm, wheels stay on the floor.
  Guard test: `chassis3d.test.ts` asserts `frame-assembly`.position.y
  > 0.
- The chassis STEP cannot corroborate module-internal heights (its
  module placement is the known mis-mated one, 55–87 mm below the
  wheel floor), and the DesignApp module STEP is no longer on disk —
  the shipped GLB is the authority, and the plate↔rail contact makes
  the render self-consistent by construction.

## Box radial offset experiment — wheel biased to the corner (REVERTED 2026-10-04)

The DesignApp replica centers the wheel column in the module
footprint, but on the real MK5i the wheel is biased to the corner of
the drivebase: the steering axis sits 2.58-2.62 in / 2.55 in from two
edges of the 7.45 in square module envelope (official SDS MK5i layout
drawing, measured at 140.3 px/in; grid overlay in
/tmp/mk5i-grid.png). Rendered as-was, the box hung ~4 cm past the
frame rails into the bumper zone — so on 2026-10-04 the box was
shifted 41 mm toward local -Z (radially inward in the parked windmill
pose) and the 2D sprite re-rendered. **Reverted the same day**: the
SDS envelope drawing is the wrong ground truth — the chassis CAD
governs, and the shift moved the module plate off the frame-corner
mounting bolts.

- **Tool (do NOT re-run)** — `scripts/cad/mk5i-box-offset.py`, pure
  python3 stdlib (same in-place GLB patching technique as
  mk5i-split-glb.py):

  ```sh
  python3 scripts/cad/mk5i-box-offset.py \
    packages/web/public/models/mk5i-module.glb \
    packages/web/public/models/mk5i-module.glb -0.041
  ```

  It translated every `mk5i-box` POSITION vertex by dz=-0.041 m and
  updated the accessor min/max; the turret was NOT moved (trajectory
  moduleLocations are steering-axis positions). Result was box z
  -0.1336..+0.0507 m, x +/-0.108.
- **Why reverted (2026-10-04)** — in mk5i-frame.glb the 20 long
  module mounting bolts sit in (±0.3302, ±0.3302) corner L patterns;
  relative to the steering axis (±0.27625 m, diagonal parked yaw) the
  corner bolt needs plate outboard reach lz = +0.0763 m. The shifted
  plate reached only +0.0507 — the corner bolt floated 25.6 mm off
  the plate at all four corners. The restored pre-shift plate (box z
  -0.0926..+0.0917) covers all 20 bolts with >=15 mm margin.
- **Restored artifacts** — GLB byte-identical to git `a0f2639`
  (`git checkout a0f2639 -- packages/web/public/models/mk5i-module.glb`),
  sprite PNG from git `4b3b36b` (world_size_m back to 0.221077 =
  `MK5I_MODULE_TOP_WORLD_M` in packages/web/src/robot-sprites.ts).
  Geometry guarded by `packages/web/test/mk5i-module-glb.test.ts`,
  including an explicit lz = +0.0763 corner-bolt coverage assertion.

## Top-view sprite for the 2D canvas (2026-10-03)

`assets/robots/mk5i-module-top.png` — the 2D canvas's module artwork
(`FieldCanvas.tsx` draws it parked at each corner's installed yaw; the
2D view shows no steering animation by user decision).

- **Tool** — `scripts/cad/glb-topview.py`, headless Blender:

  ```sh
  blender --background --python scripts/cad/glb-topview.py -- \
    packages/web/public/models/mk5i-module.glb assets/robots/mk5i-module-top.png
  ```

- Input is the shipped split GLB exactly as the 3D view instances it,
  so 2D and 3D can never drift apart. The script bakes import
  transforms, joins every mesh, smooths normals (the decimation's flat
  facets glare under studio light), centers an orthographic camera on
  the origin (the GLB contract pins the steering axis there) looking
  straight down, and renders 2048x2048 RGBA on a transparent film:
  Workbench studio light, MATERIAL colors, WORLD cavity, specular OFF
  (studio speculars smeared bright wedges across the decimated
  plates).
- Image contract: pixel center = steering axis, image right = rolling
  direction (+X), image up = glTF -Z = robot-frame -Y (FieldCanvas
  flips the draw vertically, mirroring the 3D mount's
  `rotation.y = -yaw`; verified against the 3D top view in the
  2026-10-03 walkthrough). The square image spans the printed
  `TOPVIEW world_size_m` (0.221077 m — module bbox ±0.1084 m plus a 2%
  margin), mirrored as `MK5I_MODULE_TOP_WORLD_M` in
  `packages/web/src/robot-sprites.ts`. If the GLB ever changes,
  re-run the tool and update that constant.
