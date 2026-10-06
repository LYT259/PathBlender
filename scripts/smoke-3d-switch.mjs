/**
 * One-off headless smoke for PR #219 (feat/3d-instant-switch) + the prewarm
 * follow-up (fix/3d-first-click-prewarm, 2026-10-06):
 *  1. with robots on screen, the 3D canvas PREWARMS hidden (idle mount +
 *     one warm frame), so the FIRST 3D click renders near-instantly;
 *  2. home/initial 3D camera points along the ViewCube top–front edge
 *     (azimuth 0, polar π/4) and the recenter button returns there;
 *  3. 2D→3D is instant — the renderer canvas DOM node survives the round
 *     trip (parked, not remounted).
 * Run: node scripts/smoke-3d-switch.mjs  (vite dev server auto-started)
 */
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const root = new URL('..', import.meta.url).pathname;
// Port overridable: parallel sessions keep their own dev servers on the
// default 5199, and this script must never smoke-test THEIR tree.
const PORT = process.env.PB_SMOKE_PORT ?? '5199';
const DEV_URL = `http://localhost:${PORT}`;
let server = null;
// Reuse an already-running dev server on the port if one answers.
let up = false;
try { up = (await fetch(DEV_URL)).ok; } catch { /* not up */ }
if (!up) {
  server = spawn('npx', ['vite', '--port', PORT, '--strictPort'], { cwd: `${root}packages/web`, stdio: 'pipe' });
  for (let i = 0; i < 120 && !up; i++) {
    await sleep(500);
    try { up = (await fetch(DEV_URL)).ok; } catch { /* keep waiting */ }
  }
}
if (!up) { console.error('vite dev server did not start'); process.exit(1); }

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
const fails = [];
const check = (name, ok, detail) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); if (!ok) fails.push(name); };

try {
  await page.goto(DEV_URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /example|示例/i }).first().click();
  await page.waitForSelector('.canvas-bar', { timeout: 30000 });

  // 0) prewarm: with robots loaded, the 3D canvas mounts hidden on idle and
  //    renders one warm frame — the first click must then be near-instant
  //    instead of paying the whole build (user follow-up report 2026-10-06).
  const prewarmed = await page.waitForFunction(
    () => (window.__pb3d?.renderer?.info?.render?.frame ?? 0) >= 1,
    null, { timeout: 20000 },
  ).then(() => true).catch(() => false);
  check('prewarm renders a warm frame while still hidden', prewarmed);
  if (prewarmed) {
    await sleep(300);
    const warmFrame = await page.evaluate(() => window.__pb3d.renderer.info.render.frame);
    const t0 = Date.now();
    await page.getByRole('button', { name: '3D', exact: true }).click();
    await page.waitForFunction(
      (f) => (window.__pb3d?.renderer?.info?.render?.frame ?? 0) > f,
      warmFrame, { timeout: 5000 },
    );
    const firstMs = Date.now() - t0;
    // SwiftShader headless lands ~100-250 ms here; a real GPU is faster.
    check('first 3D click after prewarm renders quickly', firstMs < 400, `${firstMs} ms`);
  }

  // 1) enter 3D, wait for the scene, read the home angles
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await page.waitForFunction(() => !!window.__pb3d?.controls, null, { timeout: 30000 });
  const home = await page.evaluate(() => ({
    az: window.__pb3d.controls.getAzimuthalAngle(),
    pol: window.__pb3d.controls.getPolarAngle(),
  }));
  check('initial 3D view is the cube top-front edge (az≈0, pol≈45°)',
    Math.abs(home.az) < 1e-6 && Math.abs(home.pol - Math.PI / 4) < 1e-6,
    `az=${home.az.toFixed(6)} pol=${(home.pol * 180 / Math.PI).toFixed(4)}°`);

  // 2) orbit away with the RIGHT button (Onshape default: right drag =
  //    rotate), then hit the recenter button — must return to the edge
  const cv = page.locator('.field-canvas-3d canvas').first();
  const box = await cv.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(box.x + box.width / 2 + 180, box.y + box.height / 2 + 60, { steps: 8, button: 'right' });
  await page.mouse.up({ button: 'right' });
  await sleep(600);
  const after = await page.evaluate(() => window.__pb3d.controls.getPolarAngle());
  check('orbit actually moved the camera', Math.abs(after - Math.PI / 4) > 0.05, `pol=${(after * 180 / Math.PI).toFixed(2)}°`);

  await page.getByRole('button', { name: /recenter|fit|复位|重新取景/i }).first().click().catch(async () => {
    // aria-label lookup: the button uses tr('canvas.fit')
    await page.locator('.canvas-recenter').click();
  });
  await page.waitForFunction(() => Math.abs(window.__pb3d.controls.getPolarAngle() - Math.PI / 4) < 1e-3 &&
    Math.abs(window.__pb3d.controls.getAzimuthalAngle()) < 1e-3, null, { timeout: 5000 }).then(() => true).catch(() => false)
    .then((ok) => check('recenter returns to the cube top-front edge', ok));

  // 3) 2D→3D round trip keeps the SAME renderer instance (parked, no
  //    remount). Tag the live renderer object — a remount would build a
  //    fresh one and drop the tag. (Canvas-node identity via ElementHandle
  //    is unreliable: .field-canvas-3d holds two canvases, main + viewcube.)
  await page.evaluate(() => { window.__pb3d.renderer.__tag = 'gen1'; });
  await page.getByRole('button', { name: '2D', exact: true }).click();
  await sleep(300);
  await page.getByRole('button', { name: '3D', exact: true }).click();
  await sleep(300);
  const tag = await page.evaluate(() => window.__pb3d?.renderer?.__tag ?? 'REBUILT');
  check('2D→3D keeps the same renderer instance (instant, no remount)', tag === 'gen1', tag);
} catch (e) {
  fails.push('exception: ' + e.message);
} finally {
  await browser.close();
  server?.kill();
}
console.log(fails.length ? `SMOKE FAILED: ${fails.join('; ')}` : 'SMOKE PASSED');
process.exit(fails.length ? 1 : 0);
