#!/usr/bin/env node
/**
 * Render the 2026 REBUILT rendered 2D artwork
 * (assets/fields/rebuilt2026-rendered.png, 7804×3168) top-down from the
 * bundled AdvantageScope Field3d GLB (packages/web/public/fields3d/
 * 2026-rebuilt/model.glb — BSD-3, untextured solid-colour meshes from the
 * official Onshape CAD). Replaces the previous community Fusion render,
 * whose two hubs carried mirrored alliance colours.
 *
 * Modes:
 *   node scripts/cad/render-field-topdown.mjs           validate → render → write the PNG
 *   node scripts/cad/render-field-topdown.mjs --check   validate only, write nothing
 *
 * Validation (repo rule: load-bearing geometry is checked against official
 * data): a throwaway frame is rendered with 32 bright-magenta flat discs
 * (0.03 m radius, MeshBasicMaterial — lighting-independent) floated at y=3
 * above every official welded 2026 AprilTag position (parsed out of
 * packages/core/src/field.ts). The radius must stay well under 37 mm — the
 * trench/hub tag pairs (1/12, 6/7, 17/28, 22/23) sit only 74.9 mm apart and
 * larger discs merge into one blob. The discs' pixel centroids must land
 * within 2 px (≈ 5.8 mm) of the calibration prediction before anything is
 * written.
 *
 * The world→pixel contract rendered here is exactly 2× the previous sheet's
 * calibration — keep these constants in sync with `imageRendered` for
 * 'rebuilt-2026' in packages/core/src/field.ts (this script's PASS is what
 * licenses those numbers):
 *   pixelWidth 7804, pixelHeight 3168, ppm 345.10, ppmY 345.48,
 *   originPx { x: 1048, y: 190 }.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GLB_URL = '/packages/web/public/fields3d/2026-rebuilt/model.glb';
const OUT_FILE = join(ROOT, 'assets/fields/rebuilt2026-rendered.png');
const TMP_FILE = OUT_FILE + '.tmp';

const CHECK_ONLY = process.argv.includes('--check');

// --- Artwork geometry contract (2× the previous 3902×1584 sheet) ----------
const OUT_W = 7804;
const OUT_H = 3168;
const PPM = 345.10; // px per metre along field length (x)
const PPM_Y = 345.48; // px per metre along field width (y)
const ORIGIN_PX = { x: 1048, y: 190 }; // blue corner (world 0,0) in pixels
// The previous sheet's calibration defines the world rectangle the camera
// covers — identical coverage, double resolution:
const PREV = { w: 3902, h: 1584, ppm: 172.55, ppmY: 172.74, origin: { x: 524, y: 95 } };
const FIELD = { lengthM: 16.54, widthM: 8.07 }; // packages/core field.ts
const MAX_RESIDUAL_PX = 2; // 1 px ≈ 2.9 mm at this scale

/** Official welded 2026 AprilTag (x, y) — parsed from packages/core/src/field.ts
 *  so the validation can never drift from the shipped tag layout. */
function readWeldedTags2026() {
  const src = readFileSync(join(ROOT, 'packages/core/src/field.ts'), 'utf8');
  // The welded set is the inline array right after this comment (the AndyMark
  // variant is the separate TAGS_2026_ANDYMARK constant).
  const block = src.match(/Official 2026 welded-field AprilTag layout[\s\S]*?aprilTags:\s*\[([\s\S]*?)\n\s*\]/);
  if (!block) throw new Error('could not locate the 2026 welded aprilTags block in field.ts');
  const tags = [...block[1].matchAll(/\{\s*id:\s*(\d+),\s*x:\s*([\d.]+),\s*y:\s*([\d.]+)/g)]
    .map((m) => ({ id: Number(m[1]), x: Number(m[2]), y: Number(m[3]) }));
  const ids = new Set(tags.map((t) => t.id));
  if (tags.length !== 32 || ids.size !== 32 || Math.min(...ids) !== 1 || Math.max(...ids) !== 32) {
    throw new Error(`expected welded tags 1..32, got ${tags.length} entries`);
  }
  return tags;
}

/** Page source: loads the GLB, renders the top-down ortho frame, and either
 *  extracts magenta-marker centroids (validation) or the final PNG. */
function pageHtml(tags, withMarkers) {
  return `<!doctype html><html><body>
<script type="importmap">{ "imports": { "three": "/node_modules/three/build/three.module.js", "three/examples/jsm/": "/node_modules/three/examples/jsm/" } }</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const W = ${OUT_W}, H = ${OUT_H};
// World rectangle covered by the artwork, from the previous sheet's
// calibration (identical coverage, double resolution):
const rect = { left: -${PREV.origin.x} / ${PREV.ppm}, bottom: -${PREV.origin.y} / ${PREV.ppmY} };
rect.right = rect.left + ${PREV.w} / ${PREV.ppm};
rect.top = rect.bottom + ${PREV.h} / ${PREV.ppmY};
const xc = (rect.left + rect.right) / 2, yc = (rect.bottom + rect.top) / 2;
const cx = ${FIELD.lengthM} / 2, cy = ${FIELD.widthM} / 2;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.NoToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(121 / 255, 118 / 255, 120 / 255); // artwork margin grey
// Lighting mirrors FieldCanvas3D:
scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6 * Math.PI));
const sun = new THREE.DirectionalLight(0xffffff, 1.1 * Math.PI);
sun.position.set(9, 16, 8);
scene.add(sun);

const gltf = await new GLTFLoader().loadAsync('${GLB_URL}');
const g = gltf.scene;
g.scale.set(1, 1, -1); // fieldModelScale('z') — 2026 config rotations [x 90°]
g.traverse((o) => {
  if (!o.isMesh) return;
  const mats = Array.isArray(o.material) ? o.material : [o.material];
  for (const m of mats) {
    m.side = THREE.DoubleSide;
    if (m.roughness !== undefined) m.roughness = Math.max(m.roughness ?? 0.5, 0.55);
    if (m.metalness !== undefined) m.metalness = Math.min(m.metalness ?? 0, 0.05);
  }
});
scene.add(g);

if (${withMarkers}) {
  // One magenta disc per official tag position. Render frame: X = -(x - cx),
  // Z = -(y - cy); y=3 floats the discs above every structure, and the
  // top-down projection does not depend on the height.
  const geo = new THREE.CircleGeometry(0.03, 32);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff, side: THREE.DoubleSide });
  for (const t of ${JSON.stringify(tags)}) {
    const d = new THREE.Mesh(geo, mat);
    d.rotation.x = -Math.PI / 2; // face straight up at the camera
    d.position.set(-(t.x - cx), 3, -(t.y - cy));
    scene.add(d);
  }
}

const Xc = -(xc - cx), Zc = -(yc - cy);
const halfW = (rect.right - rect.left) / 2, halfH = (rect.top - rect.bottom) / 2;
const cam = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, 1, 200);
cam.position.set(Xc, 50, Zc);
cam.up.set(0, 0, -1);
cam.lookAt(Xc, 0, Zc);
renderer.render(scene, cam);

// Screen-right came out as render +X = world -x: flip horizontally so the
// PNG matches the 2D artwork convention (right = world +x, top = world +y).
const flip = document.createElement('canvas');
flip.width = W; flip.height = H;
const fctx = flip.getContext('2d', { willReadFrequently: true });
fctx.translate(W, 0); fctx.scale(-1, 1);
fctx.drawImage(renderer.domElement, 0, 0);

if (${withMarkers}) {
  // Find the magenta connected components (4-connectivity) and centroids.
  const img = fctx.getImageData(0, 0, W, H).data;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = img[i * 4], gch = img[i * 4 + 1], b = img[i * 4 + 2];
    if (r > 200 && gch < 60 && b > 200) mask[i] = 1;
  }
  const seen = new Uint8Array(W * H);
  const comps = [];
  for (let i = 0; i < W * H; i++) {
    if (!mask[i] || seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    let sx = 0, sy = 0, n = 0;
    while (stack.length) {
      const p = stack.pop();
      const px = p % W, py = (p / W) | 0;
      sx += px; sy += py; n++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const qx = px + dx, qy = py + dy;
        if (qx < 0 || qx >= W || qy < 0 || qy >= H) continue;
        const q = qy * W + qx;
        if (mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); }
      }
    }
    if (n >= 100) comps.push({ x: sx / n, y: sy / n, area: n }); // disc ≈ 340 px
  }
  window.__result = { markers: comps };
} else {
  window.__result = { png: flip.toDataURL('image/png') };
}
</script></body></html>`;
}

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.html': 'text/html' };

async function main() {
  const tags = readWeldedTags2026();

  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const body = await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  await new Promise((r) => server.listen(0, r));
  const port = server.address().port;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const renderFrame = async (withMarkers) => {
      const page = await browser.newPage();
      page.on('pageerror', (e) => console.error('[page error]', String(e).slice(0, 500)));
      await page.goto(`http://127.0.0.1:${port}/`);
      await page.setContent(pageHtml(tags, withMarkers));
      await page.waitForFunction(() => window.__result, null, { timeout: 120000 });
      const result = await page.evaluate(() => window.__result);
      await page.close();
      return result;
    };

    // --- Validation frame: markers must land on the calibration prediction.
    const { markers } = await renderFrame(true);
    console.log(`[validate] found ${markers.length} magenta marker(s) (expect 32)`);
    const used = new Set();
    let ok = markers.length === 32;
    const residuals = [];
    for (const t of tags) {
      const col = ORIGIN_PX.x + t.x * PPM;
      const row = OUT_H - (ORIGIN_PX.y + t.y * PPM_Y);
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < markers.length; i++) {
        const d = Math.hypot(markers[i].x - col, markers[i].y - row);
        if (d < bestD) { bestD = d; best = i; }
      }
      if (bestD > 30 || used.has(best)) {
        console.log(`[validate]   tag ${String(t.id).padStart(2)}: pred (${col.toFixed(1)}, ${row.toFixed(1)}) — NO UNIQUE MARKER`);
        ok = false;
        continue;
      }
      used.add(best);
      const dx = markers[best].x - col;
      const dy = markers[best].y - row;
      residuals.push(bestD);
      console.log(
        `[validate]   tag ${String(t.id).padStart(2)}: pred (${col.toFixed(1)}, ${row.toFixed(1)})  ` +
        `meas (${markers[best].x.toFixed(1)}, ${markers[best].y.toFixed(1)})  res ${bestD.toFixed(2)} px (dx ${dx.toFixed(2)}, dy ${dy.toFixed(2)})`,
      );
    }
    residuals.sort((a, b) => a - b);
    const median = residuals.length % 2
      ? residuals[(residuals.length - 1) / 2]
      : (residuals[residuals.length / 2 - 1] + residuals[residuals.length / 2]) / 2;
    const max = residuals[residuals.length - 1] ?? Infinity;
    console.log(`[validate] residuals: n=${residuals.length} median=${median?.toFixed(2)} px, max=${max.toFixed(2)} px (budget ≤ ${MAX_RESIDUAL_PX} px ≈ ${(MAX_RESIDUAL_PX / PPM * 1000).toFixed(1)} mm)`);
    if (!ok || max > MAX_RESIDUAL_PX) {
      console.error('[validate] FAIL — artwork NOT written');
      process.exitCode = 1;
      return;
    }
    console.log('[validate] PASS');
    if (CHECK_ONLY) return;

    // --- Final frame (no markers) → PNG, written via a temp file.
    const { png } = await renderFrame(false);
    const buf = Buffer.from(png.split(',')[1], 'base64');
    // IHDR: width/height big-endian at byte offsets 16/20.
    if (buf.readUInt32BE(16) !== OUT_W || buf.readUInt32BE(20) !== OUT_H) {
      throw new Error(`unexpected PNG dimensions ${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}`);
    }
    writeFileSync(TMP_FILE, buf);
    renameSync(TMP_FILE, OUT_FILE);
    console.log(`[render] wrote ${OUT_FILE} — ${OUT_W}×${OUT_H}, ${(buf.length / 1024 / 1024).toFixed(2)} MB`);
  } finally {
    await browser.close();
    server.close();
  }
}

await main();
