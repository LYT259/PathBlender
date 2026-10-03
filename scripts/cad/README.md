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
  molded wheel, L plate, fasteners). **frcdesigns.com was unreachable
  (HTTP 521) at decision time — its license terms are UNVERIFIED.
  Any public release must verify them first** (release-checklist
  item, AGENTS.md red line 2).
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
