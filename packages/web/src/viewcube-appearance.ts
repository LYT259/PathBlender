import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/** Visual candidates, not Onshape's proprietary dimensions. All regions share
 * one face atlas so edge strips terminate at the same corner pads on every side.
 * Reference: Onshape's live ViewCube and public view-navigation documentation:
 * https://cad.onshape.com/help/Content/View/view_navigation_and_the_view_cube.htm
 * Picking and camera motion deliberately remain owned by FieldCanvas3D. */
export const VIEWCUBE_APPEARANCE = {
  size: 1.55,
  bevel: 0.09,
  textureSize: 512,
  faceInset: 48,
  faceRadius: 72,
  cornerRadius: 48,
  edgeStart: 64,
  edgeHalfWidth: 18,
  labelSize: 128,
} as const;

export type CubeDirection = readonly [number, number, number];
export type FaceRegion = { kind: 'face' | 'edge' | 'corner'; u: number; v: number } | null;

// Three.js BoxGeometry material order, with the texture's right/up basis.
const FACE_FRAMES: readonly { n: CubeDirection; u: CubeDirection; v: CubeDirection }[] = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
const dot = (a: CubeDirection, b: CubeDirection) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** An edge paints two adjoining faces; a corner paints three. */
export function viewcubeFaceRegion(face: number, direction: CubeDirection | null): FaceRegion {
  const frame = FACE_FRAMES[face];
  if (!frame || !direction || dot(frame.n, direction) !== 1) return null;
  const u = dot(frame.u, direction);
  const v = dot(frame.v, direction);
  return { kind: u && v ? 'corner' : u || v ? 'edge' : 'face', u, v };
}

/** Pick classification, in the same texture space the faces are painted in
 * so a region's clickable boundary IS its visible outline: inside the
 * rounded panel → face, past the panel along one axis → the edge strip,
 * past it along two (or across a rounded corner) → the corner pad. UVs
 * come straight from a raycast hit on the appearance mesh — its UVs are
 * arc-length parametrized across the bevel, so a flat-box threshold (the
 * old 0.5·half-size test) lands in the wrong region on bevel and side
 * faces. `u`/`v` are the hit's 0..1 texture coordinates. */
export function viewcubeDirectionAt(face: number, u: number, v: number): CubeDirection | null {
  const frame = FACE_FRAMES[face];
  if (!frame) return null;
  const { textureSize: s, faceInset: inset, faceRadius: radius } = VIEWCUBE_APPEARANCE;
  const half = s / 2 - inset; // panel straight-edge extent (208 px)
  const arc = half - radius; // rounded-corner arc center (136 px)
  const px = u * s - s / 2;
  const py = v * s - s / 2;
  const dx = Math.abs(px);
  const dy = Math.abs(py);
  const insidePanel =
    dx <= half && dy <= half && Math.hypot(Math.max(dx - arc, 0), Math.max(dy - arc, 0)) <= radius;
  if (insidePanel) return frame.n;
  // Outside the panel: crossed one straight edge → edge; crossed two →
  // corner. Neither but still outside → the cursor fell off the rounded
  // corner diagonally, which reads as the corner pad (both dx/dy exceed
  // the arc center there, so the signs are well defined).
  let su = dx > half ? Math.sign(px) : 0;
  let sv = dy > half ? Math.sign(py) : 0;
  if (!su && !sv) {
    su = Math.sign(px);
    sv = Math.sign(py);
  }
  return [
    frame.n[0] + su * frame.u[0] + sv * frame.v[0],
    frame.n[1] + su * frame.u[1] + sv * frame.v[1],
    frame.n[2] + su * frame.u[2] + sv * frame.v[2],
  ];
}

type TokenReader = (name: string, fallback: string) => string;

/** Only the selected region changes color; the neutral rim is never tinted. */
export function drawViewcubeFace(
  g: CanvasRenderingContext2D, label: string, region: FaceRegion, token: TokenReader,
): void {
  const { textureSize: s, faceInset: inset, faceRadius, cornerRadius, edgeStart, edgeHalfWidth, labelSize } = VIEWCUBE_APPEARANCE;
  g.clearRect(0, 0, s, s);
  g.fillStyle = token('--viewcube-rim', '#878b90');
  g.fillRect(0, 0, s, s);
  const faceHot = region?.kind === 'face';
  const gradient = g.createLinearGradient(0, 0, 0, s);
  gradient.addColorStop(0, token('--viewcube-face-top', '#3d4146'));
  gradient.addColorStop(1, token('--viewcube-face-bottom', '#34383d'));
  g.beginPath();
  g.roundRect(inset, inset, s - 2 * inset, s - 2 * inset, faceRadius);
  g.fillStyle = faceHot ? token('--viewcube-hover-face', '#244c74') : gradient;
  g.fill();

  // Each strip wraps over a real bevel. Rounded ends stop before the corner
  // pads instead of a short floating cylinder in the middle of the edge.
  for (const [u, v] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
    const hot = region?.kind === 'edge' && region.u === u && region.v === v;
    g.fillStyle = hot
      ? token('--viewcube-hover-feature', '#549dde')
      : token('--viewcube-rim', '#878b90');
    g.beginPath();
    if (u) g.roundRect((u > 0 ? s : 0) - edgeHalfWidth, edgeStart, edgeHalfWidth * 2, s - 2 * edgeStart, edgeHalfWidth);
    else g.roundRect(edgeStart, (v! > 0 ? 0 : s) - edgeHalfWidth, s - 2 * edgeStart, edgeHalfWidth * 2, edgeHalfWidth);
    g.fill();
  }
  // Quarter-discs meet across three faces to make one flush rounded corner.
  // The same eight corner regions are present at rest and when highlighted.
  for (const u of [-1, 1]) for (const v of [-1, 1]) {
    const hot = region?.kind === 'corner' && region.u === u && region.v === v;
    g.fillStyle = token(hot ? '--viewcube-hover-feature' : '--viewcube-feature', hot ? '#549dde' : '#34383d');
    g.beginPath();
    g.arc(u > 0 ? s : 0, v > 0 ? 0 : s, cornerRadius, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = token(faceHot ? '--viewcube-hover-label' : '--viewcube-label', faceHot ? '#d6ecff' : '#f0f2f4');
  g.font = `500 ${labelSize}px -apple-system, "Segoe UI", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, s / 2, s / 2 + 7);
}

export function createViewcubeAppearance(labels: readonly string[], token: TokenReader) {
  const { size, bevel, textureSize } = VIEWCUBE_APPEARANCE;
  const geometry = new RoundedBoxGeometry(size, size, size, 5, bevel);
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  const light = new THREE.Vector3(-0.45, 0.8, 0.55).normalize();
  const normal = new THREE.Vector3();
  for (let i = 0; i < normals.count; i++) {
    normal.fromBufferAttribute(normals, i);
    const value = 0.72 + 0.28 * Math.max(0, normal.dot(light));
    colors.set([value, value, value], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const faces = labels.map(label => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = textureSize;
    const context = canvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 8;
    const material = new THREE.MeshBasicMaterial({ map: texture, vertexColors: true });
    return { label, context, texture, material };
  });
  let hovered: CubeDirection | null = null;
  let hoverKey = '';
  const redraw = () => faces.forEach((face, i) => {
    drawViewcubeFace(face.context, face.label, viewcubeFaceRegion(i, hovered), token);
    face.texture.needsUpdate = true;
  });
  redraw();
  return {
    mesh: new THREE.Mesh(geometry, faces.map(face => face.material)),
    setHover(direction: CubeDirection | null) {
      const key = direction?.join(',') ?? '';
      if (key === hoverKey) return;
      hoverKey = key;
      hovered = direction;
      redraw();
    },
    /** Locale switch: repaint with new labels, keeping the current hover. */
    setLabels(next: readonly string[]) {
      if (next.length === faces.length && next.every((label, i) => label === faces[i]?.label)) return;
      faces.forEach((face, i) => { face.label = next[i] ?? ''; });
      redraw();
    },
    getHover: () => hovered,
    retint: redraw,
    dispose() {
      geometry.dispose();
      faces.forEach(face => { face.texture.dispose(); face.material.dispose(); });
    },
  };
}
