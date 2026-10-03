# MK5i chassis frame STEP -> GLB (see README.md).
# Run:
#   blender --background --python scripts/cad/mk5i-frame-convert.py -- \
#     <input.step> <output.glb>
#
# Source (user-built Onshape assembly, final 2026-10-03): 2x1 in box tubes
# + corner blocks + mounting hardware, modules bolted in for context.
# This conversion keeps ONLY the frame (tubes, corner blocks, chassis-level
# bolts/nuts) — the four MK5i modules are stripped (the app mounts its own
# CAD module asset). Normalization is translate-only (floor z=0, XY
# centered): the outline ships EXACTLY as drawn — 27.0x27.0 in, no scale
# (user requirement 2026-10-03).

import bpy
import sys
from collections import defaultdict
from mathutils import Matrix, Vector

import addon_utils

DECIMATE_RATIO = 0.35

# Module-internal parts get stripped; frame + chassis hardware stay.
STRIP = ('Kraken', 'Turret', 'Top Assembly', 'Molded Wheel', 'L Plate', 'Spacer')

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]

bpy.ops.wm.read_homefile(use_empty=True)
addon_utils.enable('bl_ext.blender_org.step_importer', default_set=True)
bpy.ops.import_scene.step(filepath=src)

all_objs = [o for o in bpy.data.objects if o.type == 'MESH']
keep = [o for o in all_objs if not any(s in o.name for s in STRIP)]
drop = [o for o in all_objs if any(s in o.name for s in STRIP)]
for o in drop:
    bpy.data.objects.remove(o, do_unlink=True)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
print(f'[strip] kept {len(objs)} frame parts, dropped {len(drop)} module parts')
for o in objs:
    o.data.transform(o.matrix_world)
    o.matrix_world.identity()

# Normalize: floor z=0, centered XY. Translate only — never scale.
lo = [min(min(v.co[k] for v in o.data.vertices) for o in objs) for k in range(3)]
hi = [max(max(v.co[k] for v in o.data.vertices) for o in objs) for k in range(3)]
T = Matrix.Translation(Vector((
    -(lo[0] + hi[0]) / 2,
    -(lo[1] + hi[1]) / 2,
    -lo[2],
)))
for o in objs:
    o.data.transform(T)
lo2 = [min(min(v.co[k] for v in o.data.vertices) for o in objs) for k in range(3)]
hi2 = [max(max(v.co[k] for v in o.data.vertices) for o in objs) for k in range(3)]
IN = 0.0254
print(f'[final] X={(hi2[0]-lo2[0])/IN:.3f} in  Y={(hi2[1]-lo2[1])/IN:.3f} in  '
      f'z {lo2[2]:.4f}..{hi2[2]:.4f} m')
print(f'[check] X=Y~27.000 in (0.6858 m), z starts at 0')

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
for idx, o in enumerate(joined):
    mod = o.modifiers.new('dec', 'DECIMATE')
    mod.ratio = DECIMATE_RATIO
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=mod.name)
    o.name = f'mk5i-frame-{chr(97 + idx)}'
    o.data.name = o.name
    print(f'[mesh] {o.name}: {len(o.data.polygons)} tris')
print(f'[total] {sum(len(o.data.polygons) for o in joined)} triangles')

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True)
print(f'[done] wrote {dst}')
