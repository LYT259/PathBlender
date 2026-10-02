# MK5i STEP → normalized GLB (one-time pipeline step; see README.md).
# Run:
#   blender --background --python scripts/cad/mk5i-convert.py -- \
#     <input.step> <output.glb>
#
# Normalizes to the runtime contract in web/src/chassis3d.ts: meters,
# +Y up (Blender's Z-up is converted by the glTF exporter), origin at
# the steering axis on the floor, +X the wheel's rolling direction.
#
# Calibration knobs: on the first run, keep STEERING_AXIS_XY = None and
# ROLL_DEG = 0.0 — the script prints the raw bbox and wheel-cylinder
# candidates; set the knobs from that report and re-run.

import bpy
import math
import sys
from collections import defaultdict

# The STEP importer is a Blender extension, not core — factory settings
# would drop it, so: empty default scene (keeps user prefs + extensions)
# and an explicit enable for robustness.
import addon_utils
addon_utils.enable('bl_ext.blender_org.step_importer')

# --- knobs (first run reports, second run finalizes) -------------------
STEERING_AXIS_XY = None  # e.g. (0.0, 0.0) — translation putting the
                         # steering axis at the XY origin
ROLL_DEG = 0.0           # rotation about Z so the rolling dir = +X
TARGET_HEIGHT_M = 7.45 * 0.0254  # official layout drawing, overall height
DECIMATE_RATIO = 0.12    # keep ~12% of CAD triangles (target ≤ ~60k)
# -----------------------------------------------------------------------

argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]

# Fresh scene (user prefs kept — the STEP extension lives there).
bpy.ops.wm.read_homefile(use_empty=True)

# STEP import via the official extension (bl_ext.blender_org.step_importer,
# which registers bpy.ops.import_scene.step; enable it once per user config,
# or pass --factory-startup off).
importer = getattr(bpy.ops.import_scene, "step", None) or getattr(
    bpy.ops.wm, "import_step", None
)
if importer is None:
    raise SystemExit("No STEP importer in this Blender build (need 4.5+)")
importer(filepath=src)

objs = [o for o in bpy.data.objects if o.type == "MESH"]
if not objs:
    raise SystemExit("No mesh objects after STEP import")


def bbox_report(tag):
    lo = min((o.matrix_world @ v.co.copy() for o in objs for v in o.data.vertices))
    hi = max((o.matrix_world @ v.co.copy() for o in objs for v in o.data.vertices))
    print(f"[{tag}] bbox min {tuple(round(c, 5) for c in lo)} max {tuple(round(c, 5) for c in hi)}")
    return lo, hi


lo, hi = bbox_report("raw")

# Wheel candidates for calibration: near-cylinders whose minor dimension
# matches a 3–4 in wheel.
wheel_diams = defaultdict(int)
for o in objs:
    s = sorted(o.dimensions)
    if s[0] < 0.15 and 0.06 < s[1] < 0.13:
        wheel_diams[round(s[1], 3)] += 1
print("[probe] wheel-candidate minor diameters (m):", dict(wheel_diams))

# Apply user calibration.
if STEERING_AXIS_XY:
    for o in objs:
        o.location.x -= STEERING_AXIS_XY[0]
        o.location.y -= STEERING_AXIS_XY[1]
if ROLL_DEG:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.transform.rotate(
        value=math.radians(ROLL_DEG), orient_axis="Z", center_override=(0, 0, 0),
    )
bpy.context.view_layer.update()
lo, hi = bbox_report("calibrated")

# Uniform scale from the official height, then floor at z=0, centered XY.
s = TARGET_HEIGHT_M / (hi.z - lo.z)
for o in objs:
    o.scale *= s
bpy.context.view_layer.update()
lo, hi = bbox_report("scaled")
for o in objs:
    o.location.x -= (lo.x + hi.x) / 2
    o.location.y -= (lo.y + hi.y) / 2
    o.location.z -= lo.z
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
objs = [o for o in bpy.data.objects if o.type == "MESH"]
lo, hi = bbox_report("final")
print(f"[final] extents (m): x={hi.x - lo.x:.4f} y={hi.y - lo.y:.4f} z={hi.z - lo.z:.4f}")
print(f"[check] expected ≈ x=0.1588 y=0.1588 z={TARGET_HEIGHT_M:.4f} (6.25/6.25/7.45 in)")

# Join per material → few draw calls per instance.
by_mat = defaultdict(list)
for o in objs:
    key = o.active_material.name if o.active_material else ""
    by_mat[key].append(o)
joined = []
for group in by_mat.values():
    if len(group) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for o in group:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.join()
    joined.append(bpy.context.view_layer.objects.active)

# Decimate each joined mesh.
for o in joined:
    mod = o.modifiers.new("dec", "DECIMATE")
    mod.ratio = DECIMATE_RATIO
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)
    print(f"[mesh] {o.name}: {len(o.data.polygons)} tris after decimate")

tris = sum(len(o.data.polygons) for o in joined)
print(f"[total] {tris} triangles")

bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_yup=True)
print(f"[done] wrote {dst}")
