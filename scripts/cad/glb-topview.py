# MK5i module GLB -> orthographic top-view sprite (see README.md).
# Run:
#   blender --background --python scripts/cad/glb-topview.py -- \
#     <input.glb> <output.png>
#
# Renders the shipped module (packages/web/public/models/mk5i-module.glb)
# straight down the up axis into a 2048px transparent PNG for the 2D
# canvas (FieldCanvas.tsx). The GLB contract (mk5i-convert.py) already
# pins the steering axis to the origin and +X to the rolling direction,
# so the camera centers on the origin: the sprite's pixel center IS the
# steering axis, image right = rolling direction, image up = glTF -Z
# (robot-frame -Y — the canvas draw flips vertically, see FieldCanvas).
# Workbench + MATERIAL color + cavity keeps the plate/motor/fork edges
# readable at any canvas zoom; the exact meters-per-image scale is
# printed for the runtime constant.

import bpy
import sys

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]

bpy.ops.wm.read_homefile(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

objs = [o for o in bpy.data.objects if o.type == 'MESH']
if not objs:
    raise SystemExit("No mesh objects after glTF import")

# Bake import transforms (glTF +Y-up -> Blender Z-up lands in the
# object matrices), then join everything for one bbox.
for o in objs:
    o.data.transform(o.matrix_world)
    o.matrix_world.identity()
bpy.context.view_layer.update()

bpy.ops.object.select_all(action='DESELECT')
for o in objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.object.join()
merged = bpy.context.view_layer.objects.active

# Smooth shading: the shipped GLB is decimated (55k tris) and flat
# normals render as glaring triangular facets under studio light.
for p in merged.data.polygons:
    p.use_smooth = True

xs = [v.co.x for v in merged.data.vertices]
ys = [v.co.y for v in merged.data.vertices]
half = max(-min(xs), max(xs), -min(ys), max(ys))
# Hair of margin so edge-on silhouette pixels are not clipped.
half *= 1.02
world_size = 2 * half
print(f"TOPVIEW bbox x [{min(xs):.4f}, {max(xs):.4f}] y [{min(ys):.4f}, {max(ys):.4f}]")
print(f"TOPVIEW world_size_m = {world_size:.6f} (ortho_scale)")

cam_data = bpy.data.cameras.new("topview")
cam_data.type = 'ORTHO'
cam_data.ortho_scale = world_size
cam_data.clip_start = 0.01
cam_data.clip_end = 100.0
cam = bpy.data.objects.new("topview", cam_data)
bpy.context.scene.collection.objects.link(cam)
# Zero rotation = looking straight down -Z, image up = world +Y,
# image right = world +X (the GLB rolling direction).
cam.location = (0.0, 0.0, 2.0)
cam.rotation_euler = (0.0, 0.0, 0.0)
bpy.context.scene.camera = cam

scene = bpy.context.scene
scene.render.engine = 'BLENDER_WORKBENCH'
shading = scene.display.shading
shading.light = 'STUDIO'
shading.color_type = 'MATERIAL'
# WORLD cavity only: SCREEN/ridge mode outlines the decimated mesh's
# triangulation on the flat plates (bright spider-web seams).
shading.cavity_type = 'WORLD'
shading.cavity_ridge_factor = 0.0
shading.cavity_valley_factor = 1.4
# Matte: studio speculars smear across the decimated plates as bright
# triangular glare wedges; a technical top view reads better diffuse-only.
shading.show_specular_highlight = False

scene.render.resolution_x = 2048
scene.render.resolution_y = 2048
scene.render.resolution_percentage = 100
scene.render.film_transparent = True
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.filepath = dst
bpy.ops.render.render(write_still=True)
print(f"TOPVIEW wrote {dst}")
