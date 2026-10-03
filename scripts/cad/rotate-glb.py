# Rotate the shipped module GLB about the up axis (glTF +Y = Blender Z)
# by the angle given on the command line — vertex-baked, colors
# untouched; a post-hoc patch for when the source STEP is not on disk.
# History: +90° in commit 7c7c888 (based on a backwards pixel
# measurement — made things worse), then -90° on 2026-10-03 to undo
# the ROLL_SWAP error and put the rolling direction on +X.
import bpy
import sys
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, deg = argv[0], argv[1], float(argv[2])

bpy.ops.wm.read_homefile(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
objs = [o for o in bpy.data.objects if o.type == 'MESH']
for o in objs:
    o.data.transform(o.matrix_world)
    o.matrix_world.identity()
R = Matrix.Rotation(deg * 3.14159265 / 180.0, 4, 'Z')
for o in objs:
    o.data.transform(R)

lo = [min(min(v.co[k] for v in o.data.vertices) for o in objs) for k in range(3)]
hi = [max(max(v.co[k] for v in o.data.vertices) for o in objs) for k in range(3)]
print(f'[final] extents X={hi[0]-lo[0]:.4f} Y={hi[1]-lo[1]:.4f} Z={hi[2]-lo[2]:.4f}')
print(f'[final] z from {lo[2]:.4f} (floor must stay 0)')
bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True)
print(f'[done] {dst}')
