import type { PerspectiveCamera, Vector3 } from 'three';

/** Project an existing rig anchor; never changes the field or robot geometry. */
export function projectLabelAnchor(
  world: Vector3, camera: PerspectiveCamera, viewport: { w: number; h: number },
): { x: number; y: number; visible: boolean } {
  const ndc = world.clone().project(camera);
  return {
    x: (ndc.x + 1) * viewport.w / 2,
    y: (1 - ndc.y) * viewport.h / 2,
    visible: Number.isFinite(ndc.x) && Number.isFinite(ndc.y) && Number.isFinite(ndc.z)
      && ndc.z >= -1 && ndc.z <= 1 && Math.abs(ndc.x) <= 1 && Math.abs(ndc.y) <= 1,
  };
}

/**
 * On-screen radius (CSS px) of a world-space sphere around `world` — the
 * robot body's keep-clear zone for the label layer. Perspective only:
 * r / distance scaled by the vertical half-viewport over tan(fov/2).
 */
export function projectedRadiusPx(
  world: Vector3, radiusM: number, camera: PerspectiveCamera, viewport: { w: number; h: number },
): number {
  const distance = camera.position.distanceTo(world);
  if (!(distance > 0) || !(radiusM > 0)) return 0;
  const halfFov = (camera.fov * Math.PI) / 360;
  return radiusM / distance * (viewport.h / 2) / Math.tan(halfFov);
}
