/**
 * WHO RUNS THIS: developers refreshing the README screenshots. Never ships.
 *
 * Regenerates docs/screenshots/{field3d,collision-report}.png from the real
 * production build with the same synthetic sample pair the browser
 * walkthrough uses (straight_run × stop_and_score → one conflict), so the
 * images always show the current UI: after 1fada97 removed the field
 * conflict dots and inset the timeline segment rings, the 2026-09-27 pair
 * no longer matched what users see. The 3D hero shot is captured with a
 * dark color scheme and the 2D shot with a light one — the same pairing the
 * previous screenshots used, showing both themes the app follows.
 *
 * Usage: npm run build -w @pathblender/web && npm run preview -w @pathblender/web
 *        node scripts/capture-readme-shots.mjs   (expects :4173, or set WALK_BASE)
 */
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';

const BASE = process.env.WALK_BASE ?? 'http://localhost:4173/';
const SAMPLES = resolve(process.cwd(), 'samples');
const OUT = resolve(process.cwd(), 'docs/screenshots');
const FILES = [
  `${SAMPLES}/ghostauto/straight_run.ghostauto`,
  `${SAMPLES}/ghostauto/stop_and_score.ghostauto`,
];

const browser = await chromium
  .launch(process.env.WALK_CHROME === '0' ? {} : { channel: 'chrome' })
  .catch(() => chromium.launch());

async function freshPage(scheme) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  let modelLoaded = false;
  page.on('response', (r) => { if (r.url().includes('fields3d/') && r.url().endsWith('model.glb') && r.status() === 200) modelLoaded = true; });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.locator('input[type="file"][multiple]').first().setInputFiles(FILES);
  await page.waitForSelector('.robot-library-row', { timeout: 10000 });
  await page.waitForSelector('.field-canvas');
  return { page, errors, modelLoaded };
}

// collision-report.png — light scheme, 2D, clock jumped to the conflict so
// the red rings are on screen with the panel and timeline visible.
{
  const { page, errors } = await freshPage('light');
  await page.waitForFunction(
    () => document.querySelector('.conflict-count')?.textContent === '1',
    undefined,
    { timeout: 10000 },
  );
  await page.locator('.conflict-jump').first().click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/collision-report.png` });
  await page.context().close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log('wrote collision-report.png');
}

// field3d.png — dark scheme, 3D, waiting until the field model is fetched
// and the blue-alliance bumpers actually paint (same pixel probe the
// walkthrough uses; scene-graph counts once missed black robots).
{
  const { page, errors, modelLoaded } = await freshPage('dark');
  await page.locator('.view-toggle button', { hasText: '3D' }).click();
  await page.waitForSelector('.field-canvas-3d canvas', { timeout: 15000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => {
    const st = window.__pb3d;
    const cv = document.querySelector('.field-canvas-3d canvas');
    if (!st?.renderer || !cv) return false;
    st.renderer.render(st.scene, st.camera);
    const off = document.createElement('canvas');
    off.width = cv.width;
    off.height = cv.height;
    const g = off.getContext('2d', { willReadFrequently: true });
    g.drawImage(cv, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    let cyan = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (b > r + 50 && gg > 90 && b > 140) cyan++;
    }
    return cyan > 20;
  }, undefined, { timeout: 20000 });
  await page.waitForTimeout(800); // settle the damped orbit before the shot
  await page.screenshot({ path: `${OUT}/field3d.png` });
  await page.context().close();
  // The paint probe above is the load-bearing gate (it catches black-robot
  // regressions that network listeners miss); modelLoaded is advisory only
  // because Vite gives bundled assets hashed names the URL pattern can miss.
  if (errors.length) {
    console.error(`field3d capture errors:\n${errors.join('\n')}`);
    process.exit(1);
  }
  console.log(`wrote field3d.png (model response seen: ${modelLoaded})`);
}

await browser.close();
console.log('capture clean');
