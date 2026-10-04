/**
 * Robot artwork registry (import side: Vite hashes the files into the
 * bundle). The MK5i top view is an orthographic Blender render of the
 * shipped module GLB (packages/web/public/models/mk5i-module.glb) —
 * rebuilt by scripts/cad/glb-topview.py, provenance in scripts/cad/README.md.
 */
import mk5iModuleTop from '../../../assets/robots/mk5i-module-top.png';

/** MK5i module top-view sprite URL: transparent 2048px PNG, steering
 *  axis at the pixel center, image right = rolling direction (+X),
 *  image up = robot-frame −Y (render camera up = glTF −Z). */
export const MK5I_MODULE_TOP_URL = mk5iModuleTop;

/** World span of the square sprite image in meters — the ortho scale
 *  the render used (module bbox max |extent| 0.1336 m around the
 *  steering axis plus a 2% margin, printed by glb-topview.py as
 *  TOPVIEW world_size_m). One constant covers both axes; the real
 *  module never scales with the chassis. */
export const MK5I_MODULE_TOP_WORLD_M = 0.272524;
