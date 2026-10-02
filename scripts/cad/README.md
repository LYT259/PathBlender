# MK5i module CAD → glTF pipeline (private; not shipped)

Builds `packages/web/public/models/mk5i-module.glb` — the official
Swerve Drive Specialties MK5i module, instanced 4× per robot in the 3D
view. User decision 2026-10-02: the 3D modules must be the real CAD; a
hand-modeled approximation looks wrong when zoomed in.

## Provenance

- Source: the official SDS product page
  <https://www.swervedrivespecialties.com/products/mk5i-swerve-module>
  → "CAD Model" link (Google Drive) → `mk5i.x_t` — a Parasolid text
  transmit exported from SOLIDWORKS 2022 (header date 2025-09-02),
  3,701,437 bytes. Downloaded 2026-10-02; local copy `~/Downloads/mk5i.x_t`.
- SDS publishes no STEP and states no CAD license terms on the page.
  The repo is private, so bundling the derived GLB is fine today, but
  **every public release must re-check SDS's terms for redistribution**
  (release-checklist item, AGENTS.md red line 2).
- Parasolid has no open-source reader, so the one-time x_t → STEP hop
  happens in a CAD app that has a Siemens kernel (Fusion 360 /
  SolidWorks / Onshape — any of them opens x_t directly). Everything
  after STEP is automated below.

## One-time chain

1. **x_t → STEP (manual, any CAD app)**: open `~/Downloads/mk5i.x_t`,
   export STEP (AP214) → `~/Downloads/mk5i.step`.
2. **STEP → normalized GLB (automated)**:

   ```sh
   blender --background --python scripts/cad/mk5i-convert.py -- \
     ~/Downloads/mk5i.step packages/web/public/models/mk5i-module.glb
   ```

   The script normalizes to the runtime contract, decimates, joins by
   material, and prints its bounding box for the check below.
3. **Numeric acceptance** (official layout drawing
   `~/Downloads/mk5i-layout-drawing.pdf`, dimensions in inches):
   overall height 7.45, plate 6.25 × 6.25 (wheel-to-wheel plan ≈ this
   class). After normalize+scale the printed bbox must be ≈ 0.159 ×
   0.159 × 0.189 m (6.25/6.25/7.45 in). The runtime loader also
   sanity-checks height (0.10–0.35 m) and falls back to the procedural
   module if it fails, so a bad asset can never mis-render the field.
4. Commit the GLB (it is small: decimated, joined); never commit the
   raw x_t/STEP sources.

## Runtime contract (mirrored in web/src/chassis3d.ts)

- meters, +Y up, single scene root;
- origin = steering axis ∩ floor; +X = the wheel's rolling direction
  (steering 0 = straight ahead);
- ≤ 5 meshes, ≤ ~60k triangles total (4 pods × N robots are cloned from
  one template; geometry/materials stay shared on the GPU).

## Provenance evidence (verified 2026-10-02, twice)

- Download URL = the official product page's own "CAD Model" link
  (Google Drive id `1WCN-hDwU_AilFH5X-7swBz2U0_n4Wpnf`); the Drive
  response headers name the file `attachment; filename="MK5i.x_t"`.
- Two independent downloads are **byte-identical**:
  size 3,701,437 bytes, sha256
  `b9a36e6bb3a948c04217f2f55293cf2858206ed9862b4050fa1ef3ba736893af`
  (network truncation ruled out — this link truncated other files).
- Internal Parasolid header: `KEY=FILEMK5i .x_t`,
  `APPL=SOLIDWORKS 2022-2029`, Parasolid 33.1, export date 2025-09-02
  — consistent with the product's layout-drawing REV date 2025-07-28.
- This x_t is the native SolidWorks kernel export — the *master*
  geometry, strictly higher fidelity than any STEP/mesh derived from
  it (exact B-rep surfaces, no tessellation loss). It is the only CAD
  artifact the official page publishes; the per-part store pages are
  subsets of this assembly, and MK5n is a different product.
- Final acceptance gates: the exporter should see the complete module
  assembly (~7.45 in tall, wheel + gearbox + motor) in their CAD, and
  the convert script must print a bbox of ≈ 0.159 × 0.159 × 0.189 m.
