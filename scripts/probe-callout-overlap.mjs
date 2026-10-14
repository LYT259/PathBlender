/**
 * WHO RUNS THIS: the AI session that changed 2D label collision layout
 * (2026-10-14). Never ships. Loads the built-in annotated example (three
 * robots, real action vocabulary) in the production build, steps the clock
 * 0.5 s at a time, and reads every label plate the renderer draws (by
 * hooking roundRect on the 2D field canvas) to check — numerically, per
 * time step — that no two plates cover each other. Plates are grouped
 * into render bursts (a frame's plates draw back-to-back); only the last
 * burst of each step is checked, so plates from neighboring times never
 * mix. Keeps a screenshot of the busiest step for eyeball review.
 *
 * Usage: npm run build -w @pathblender/web && npm run preview -w @pathblender/web
 *        node scripts/probe-callout-overlap.mjs   (expects :4173, or set WALK_BASE)
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.WALK_BASE ?? 'http://localhost:4173/';
const SHOTS = '/tmp/pb-callout-probe';
mkdirSync(SHOTS, { recursive: true });

const browser = await chromium
  .launch({ channel: 'chrome' })
  .catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// Record every rounded rect drawn on the 2D field canvas, timestamped.
// Plates (number badges, action boxes) are the only roundRects there;
// timestamps split the log into per-frame bursts.
await page.addInitScript(() => {
  window.__plates = [];
  const orig = CanvasRenderingContext2D.prototype.roundRect;
  CanvasRenderingContext2D.prototype.roundRect = function patched(x, y, w, h, r) {
    try {
      if (this.canvas?.closest?.('.field-canvas')) {
        window.__plates.push({ x, y, w, h, ts: performance.now() });
      }
    } catch { /* not a field ctx */ }
    return orig.call(this, x, y, w, h, r);
  };
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Try an example' }).click();
await page.waitForSelector('.field-canvas', { timeout: 20000 });
await page.waitForTimeout(3000);

const step = page.getByRole('button', { name: 'Forward 0.5 seconds' });
let violations = 0;
let maxPlates = 0;
let busiest = null;
let steps = 0;
while (steps < 45 && (await step.isDisabled()) === false) {
  await page.evaluate(() => { window.__plates.length = 0; });
  await step.click();
  steps++;
  await page.waitForTimeout(260);
  const { plates, clock } = await page.evaluate(() => ({
    plates: window.__plates.slice(),
    clock: document.querySelector('.timeline-clock')?.textContent?.trim() ?? '',
  }));
  // Split into bursts: a frame's plates draw back-to-back (< 4 ms apart).
  const bursts = [];
  for (const p of plates) {
    const last = bursts[bursts.length - 1];
    if (last && p.ts - last[last.length - 1].ts < 4) last.push(p);
    else bursts.push([p]);
  }
  const frame = bursts[bursts.length - 1] ?? [];
  if (!frame.length) continue;
  const uniq = new Map();
  for (const p of frame) uniq.set(`${p.x.toFixed(1)},${p.y.toFixed(1)},${p.w.toFixed(1)},${p.h.toFixed(1)}`, p);
  const list = [...uniq.values()];
  maxPlates = Math.max(maxPlates, list.length);
  if (!busiest || list.length > busiest.count) {
    busiest = { count: list.length, clock };
    await page.screenshot({ path: `${SHOTS}/busiest-${clock.replace(/[^\d.]/g, '')}.png` });
  }
  let bad = 0;
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      const A = list[a], B = list[b];
      if (A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h) bad++;
    }
  }
  if (bad) {
    violations += bad;
    console.log(`OVERLAP at t=${clock}: ${bad} pairs among ${list.length} plates`);
    await page.screenshot({ path: `${SHOTS}/overlap-${clock.replace(/[^\d.]/g, '')}.png` });
  }
}
await browser.close();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`done: ${steps} steps, ${violations} overlapping pairs; max plates in one frame = ${maxPlates} (busiest at ${busiest?.clock})`);
