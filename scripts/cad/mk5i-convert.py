# MK5i module STEP -> normalized GLB (see README.md).
# Run:
#   blender --background --python scripts/cad/mk5i-convert.py -- \
#     <input.step> <output.glb>
#
# Source of truth for the geometry (user decision 2026-10-02): the FRC
# Designs Onshape MK5i re-creation exported as STEP ("MK5i DesignApp.step"
# in ~/Downloads) — chosen over the official SDS x_t export because it
# includes the two Kraken X60 motors; core dimensions match the official
# layout drawing (module height 6.16-6.17 in both).
#
# Every transform is baked straight into mesh vertices (mesh.transform)
# — no object-matrix or operator semantics in the loop, so runs are
# byte-reproducible. Calibration is measured from the mesh itself:
#   - steering axis  = turret bbox center in XY,
#   - floor          = wheel bbox bottom,
#   - rolling axis   = the wheel's axle (smallest-variance horizontal
#     direction of its vertices); +X after the bake = rolling direction.
# Runtime contract (web/src/chassis3d.ts): meters, +Y up after export,
# origin = steering axis on the floor, +X = rolling direction.

import bpy
import math
import sys
from collections import defaultdict
from mathutils import Matrix, Vector

import addon_utils

DECIMATE_RATIO = 0.35  # 158k -> ~55k tris; small fasteners survive fine
WHEEL_NAME = "Molded Wheel"

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]

bpy.ops.wm.read_homefile(use_empty=True)
addon_utils.enable('bl_ext.blender_org.step_importer', default_set=True)
bpy.ops.import_scene.step(filepath=src)

objs = [o for o in bpy.data.objects if o.type == 'MESH']
if not objs:
    raise SystemExit("No mesh objects after STEP import")

# Bake import transforms: after this, local vertices == world coordinates.
for o in objs:
    o.data.transform(o.matrix_world)
    o.matrix_world.identity()
bpy.context.view_layer.update()

wheel = next(o for o in objs if WHEEL_NAME in o.name)
turret = next(o for o in objs if "Turret" in o.name)


def bbox(o):
    lo = [min(v.co[k] for v in o.data.vertices) for k in range(3)]
    hi = [max(v.co[k] for v in o.data.vertices) for k in range(3)]
    return lo, hi


wlo, whi = bbox(wheel)
tlo, thi = bbox(turret)
axis_xy = ((tlo[0] + thi[0]) / 2, (tlo[1] + thi[1]) / 2)
floor_z = wlo[2]
print(f"[turret] bbox center XY=({axis_xy[0]:.4f},{axis_xy[1]:.4f})")
print(f"[wheel]  bbox center XY=({(wlo[0]+whi[0])/2:.4f},{(wlo[1]+whi[1])/2:.4f}) floor={floor_z:.4f}")

# Axle = smallest-variance horizontal direction of the wheel's vertices.
wc = Vector((0.0, 0.0, 0.0))
n = len(wheel.data.vertices)
for v in wheel.data.vertices:
    wc += v.co
wc /= n
cov = [[0.0] * 3 for _ in range(3)]
for v in wheel.data.vertices:
    w = v.co - wc
    for i in range(3):
        for j in range(3):
            cov[i][j] += w[i] * w[j]


def smallest_eigen_axis(m):
    # Power iteration on (trace*I - m): its dominant eigenvector is the
    # smallest-eigenvalue direction of m. Fine for one clean axis.
    q = Vector((0.2673, 0.5345, 0.8018))
    for _ in range(64):
        q = Vector((
            (m[0][0] + m[1][1] + m[2][2]) * q.x - sum(m[0][j] * q[j] for j in range(3)),
            (m[0][0] + m[1][1] + m[2][2]) * q.y - sum(m[1][j] * q[j] for j in range(3)),
            (m[0][0] + m[1][1] + m[2][2]) * q.z - sum(m[2][j] * q[j] for j in range(3)),
        ))
        q.normalize()
    return q


axle = smallest_eigen_axis(cov)
axle.z = 0.0
axle.normalize()
# ROLL_SWAP: the covariance axle/roll split was ambiguous for this wheel
# mesh (variance ratio only 1.5×) and the first build came out 90° off
# (user report 2026-10-02) — the axle direction was actually the rolling
# direction. True until a measurement says otherwise.
ROLL_SWAP = True
roll = Vector((axle.x, axle.y, 0.0)) if ROLL_SWAP else Vector((-axle.y, axle.x, 0.0))
ang = math.atan2(roll.y, roll.x)       # rolling direction vs +X
print(f"[axle] direction=({axle.x:.3f},{axle.y:.3f},0) roll_angle={math.degrees(ang):.1f} deg swap={ROLL_SWAP}")

# Bake: rotate about world Z so rolling -> +X, then move the steering
# axis to the origin and the floor to z=0 — all in one vertex transform.
R = Matrix.Rotation(-ang, 4, 'Z')
a = Vector((axis_xy[0], axis_xy[1], 0.0))
axis2 = (R @ a).xy
T = Matrix.Translation(Vector((-axis2.x, -axis2.y, -floor_z)))
W = T @ R
for o in objs:
    o.data.transform(W)
bpy.context.view_layer.update()

lo = [min(min(v.co[k] for v in o.data.vertices) for o in objs) for k in range(3)]
hi = [max(max(v.co[k] for v in o.data.vertices) for o in objs) for k in range(3)]
print(f"[final] bbox min {[round(c,4) for c in lo]} max {[round(c,4) for c in hi]}")
print(f"[final] extents (m): X={hi[0]-lo[0]:.4f} Y={hi[1]-lo[1]:.4f} Z(height)={hi[2]-lo[2]:.4f}")
print(f"[check] z must start at 0; height ≈ 0.1564-0.1570 (6.16-6.17 in); plan ≤ ~0.21 (motor overhang)")

# Join per material, decimate, rename.
by_mat = defaultdict(list)
for o in objs:
    by_mat[o.active_material.name if o.active_material else '(none)'].append(o)
joined = []
for group in by_mat.values():
    if len(group) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in group:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.join()
    joined.append(bpy.context.view_layer.objects.active)

# Mute garish marker colors from the source model (user report 2026-10-02:
# the module top read yellowish): high-saturation yellow→green hues
# (#ffff00, #aaff1c, #fabe3d, #00ff00 — Onshape marker defaults) become
# neutral grays of the same luminance; grays/blacks/steel and the small
# red/blue accents stay untouched.
import colorsys
for mat in bpy.data.materials:
    if not mat.use_nodes:
        continue
    bsdf = next((n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf is None:
        continue
    c = bsdf.inputs['Base Color'].default_value
    h, s, v = colorsys.rgb_to_hsv(c[0], c[1], c[2])
    hue_deg = h * 360
    if s > 0.45 and 30.0 <= hue_deg <= 170.0:
        bsdf.inputs['Base Color'].default_value = (v, v, v, c[3])
        print(f"[mute] {mat.name}: hue {hue_deg:.0f} sat {s:.2f} -> gray {v:.2f}")
for idx, o in enumerate(joined):
    mod = o.modifiers.new("dec", "DECIMATE")
    mod.ratio = DECIMATE_RATIO
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)
    o.name = f"mk5i-{chr(97 + idx)}"
    o.data.name = o.name  # glTF mesh names come from the data block
    print(f"[mesh] {o.name}: {len(o.data.polygons)} tris")
print(f"[total] {sum(len(o.data.polygons) for o in joined)} triangles")

bpy.ops.export_scene.gltf(filepath=dst, export_format="GLB", export_yup=True)
print(f"[done] wrote {dst}")
