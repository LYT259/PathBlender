/**
 * Focus-ring audit (2026-10-07 ring-polish pass): walks every real Tab stop on
 * each screen with page.keyboard and MEASURES the painted ring — flags
 *  (a) rings clipped by an overflow ancestor (the user's "框被遮挡"),
 *  (b) square rings on radius-0 elements (the user's "长方形、没有圆角").
 * Usage: node scripts/focus-audit.mjs  (vite preview on :4173 or WALK_BASE).
 * Exit 0 = clean, 1 = issues found. Screenshots of flagged stops land in
 * /tmp/pb-focus-audit/.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.WALK_BASE ?? 'http://localhost:4173/';
mkdirSync('/tmp/pb-focus-audit', { recursive: true });

const browser = await chromium
  .launch(process.env.WALK_CHROME === '0' ? {} : { channel: 'chrome' })
  .catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
const page = await ctx.newPage();
await page.goto(BASE);
await page.waitForLoadState('domcontentloaded');
await page.waitForTimeout(800);

const ident = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return 'body';
  const label = el.getAttribute('aria-label') ?? el.textContent?.trim().slice(0, 40) ?? '';
  return `${el.tagName.toLowerCase()}${el instanceof HTMLInputElement ? `[type=${el.type}]` : ''}${el.className && typeof el.className === 'string' ? `.${el.className.split(' ').slice(0, 2).join('.')}` : ''} "${label}"`;
});

/** Measure the active element's ring: clipping vs every overflow ancestor and
 *  squareness (outline follows the element's own border-radius). */
const measure = () => page.evaluate(() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  if (cs.outlineStyle === 'none' || parseFloat(cs.outlineWidth) === 0) return { invisible: true };
  const width = parseFloat(cs.outlineWidth) || 0;
  const offset = parseFloat(cs.outlineOffset) || 0;
  const r = el.getBoundingClientRect();
  const issues = [];
  if (offset >= 0) {
    const grow = width + offset;
    const ring = { top: r.top - grow, left: r.left - grow, right: r.right + grow, bottom: r.bottom + grow };
    for (let a = el.parentElement; a; a = a.parentElement) {
      const acs = getComputedStyle(a);
      const clipped = ['auto', 'scroll', 'hidden', 'clip'].includes(acs.overflowX) || ['auto', 'scroll', 'hidden', 'clip'].includes(acs.overflowY);
      if (!clipped) continue;
      const acr = a.getBoundingClientRect();
      const box = {
        top: acr.top + parseFloat(acs.borderTopWidth), left: acr.left + parseFloat(acs.borderLeftWidth),
        right: acr.right - parseFloat(acs.borderRightWidth), bottom: acr.bottom - parseFloat(acs.borderBottomWidth),
      };
      const sides = [];
      if (ring.top < box.top - .5) sides.push('top');
      if (ring.left < box.left - .5) sides.push('left');
      if (ring.right > box.right + .5) sides.push('right');
      if (ring.bottom > box.bottom + .5) sides.push('bottom');
      if (sides.length) issues.push(`clipped ${sides.join('+')} by .${String(a.className).split(' ')[0]}`);
    }
  }
  if (parseFloat(cs.borderRadius) === 0) issues.push('square ring (border-radius 0)');
  return { invisible: false, issues };
});

/** Tab through up to `max` stops, measuring each; stops until focus cycles. */
const auditScreen = async (name, { max = 200 } = {}) => {
  const seen = new Set();
  const findings = [];
  let first = null;
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    await page.waitForTimeout(35);
    const key = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'body';
      const parts = [];
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        const parent = n.parentElement;
        if (!parent) { parts.unshift(String(n.tagName)); break; }
        parts.unshift(`${n.tagName}[${Array.from(parent.children).indexOf(n)}]`);
      }
      return parts.join('>');
    });
    if (first === null) first = key;
    else if (key === first) break;
    if (seen.has(key)) continue;
    seen.add(key);
    const m = await measure();
    if (m && !m.invisible && m.issues.length) {
      const id = await ident();
      findings.push({ stop: id, issues: m.issues });
      await page.screenshot({ path: `/tmp/pb-focus-audit/${name.replace(/\W+/g, '-')}-${seen.size}.png`, clip: { x: 0, y: 0, width: 1440, height: 900 } }).catch(() => {});
    }
  }
  return { name, stops: seen.size, findings };
};

const results = [];

// 1 — welcome page
results.push(await auditScreen('welcome'));

// 2 — load the example, audit the workspace (2D)
let reached = false;
for (let i = 0; i < 15 && !reached; i++) {
  reached = await page.evaluate(() => document.activeElement?.tagName === 'BUTTON' && /Try an example/i.test(document.activeElement.textContent ?? ''));
  if (!reached) await page.keyboard.press('Tab');
}
await page.keyboard.press('Enter');
await page.waitForSelector('.robot-library-row', { timeout: 15000 });
await page.waitForTimeout(500);
await page.keyboard.press('Tab'); // move off the silent landing spot so the ring paints
await page.waitForTimeout(150);
results.push(await auditScreen('workspace-2d'));

// 3 — composer
await page.keyboard.press('e');
await page.waitForSelector('.sequence-composer', { timeout: 5000 });
await page.waitForTimeout(300);
results.push(await auditScreen('composer'));

// 4 — help dialog
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.keyboard.press('?');
await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
results.push(await auditScreen('help-dialog', { max: 40 }));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// 5 — preferences dialog
for (let i = 0; i < 60; i++) {
  if (await page.evaluate(() => /Preferences/i.test(document.activeElement?.getAttribute('aria-label') ?? ''))) break;
  await page.keyboard.press('Tab');
  await page.waitForTimeout(30);
}
await page.keyboard.press('Enter');
await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
await page.waitForTimeout(300);
results.push(await auditScreen('prefs-dialog', { max: 80 }));
await page.keyboard.press('Escape');
await page.waitForTimeout(200);

// 6 — 3D view
await page.keyboard.press('v');
await page.waitForTimeout(600);
results.push(await auditScreen('workspace-3d', { max: 60 }));
await page.keyboard.press('v');
await page.waitForTimeout(400);

await browser.close();

let total = 0;
for (const r of results) {
  console.log(`\n== ${r.name}: ${r.stops} tab stops ==`);
  for (const f of r.findings) {
    total++;
    console.log(`  RING ISSUE  ${f.stop}`);
    for (const i of f.issues) console.log(`      - ${i}`);
  }
}
console.log(total === 0 ? '\nFOCUS AUDIT CLEAN — no clipped or square rings' : `\n${total} ring issue(s) found`);
process.exit(total === 0 ? 0 : 1);
