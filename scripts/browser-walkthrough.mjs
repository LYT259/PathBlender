/**
 * Real-browser end-to-end walkthrough against the production preview build:
 * import → collision report → playback (incl. 2x speed) → language switch →
 * share-link restore → field bounds → season switch → custom field →
 * PathPlanner batch → session download → service worker. Screenshots land in
 * /tmp/ghpb-shots for human/AI visual inspection.
 *
 * Usage: node scripts/browser-walkthrough.mjs   (expects vite preview on :4173)
 */
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, readdirSync as readdir } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.WALK_BASE ?? 'http://localhost:4173/';
const SHOTS = '/tmp/ghpb-shots';
const SAMPLES = resolve(process.cwd(), 'samples');
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.field-canvas-3d canvas');
await page.waitForTimeout(800);
check('starts in 3D by default', true);
await page.locator('.canvas-bar .btn', { hasText: '3D' }).click(); // to 2D for the import flow
await page.waitForSelector('.field-canvas');
await page.screenshot({ path: `${SHOTS}/01-empty.png` });
check('page loads', true);

// --- import two ghost files through the real file input ---
const input = page.locator('input[type="file"][multiple]').first();
await input.setInputFiles([
  `${SAMPLES}/ghostauto/straight_run.ghostauto`,
  `${SAMPLES}/ghostauto/stop_and_score.ghostauto`,
]);
await page.waitForSelector('.robot-card', { timeout: 10000 });
await page.waitForFunction(
  () => document.querySelector('.conflict-count')?.textContent === '1',
  undefined,
  { timeout: 10000 },
);
check('collision detected (straight × stop)', true);
await page.screenshot({ path: `${SHOTS}/02-collision.png` });

// --- jump to the conflict via the panel ---
await page.locator('.conflict-jump').first().click();
await page.waitForTimeout(300);
const clockText = await page.locator('.clock').textContent();
check('conflict jump sets clock', parseFloat(clockText ?? '') > 3, `clock=${clockText}`);
await page.screenshot({ path: `${SHOTS}/03-jumped.png` });

// --- playback (scope to the timeline controls — NOT robot-card remove buttons) ---
const playBtn = page.locator('.timeline-controls button.btn.icon').first();
await playBtn.click(); // play
await page.waitForTimeout(1500);
await playBtn.click(); // pause

// --- playback speed: 2x should advance the clock ~twice as fast ---
const speedBtn2x = page.locator('.speeds button', { hasText: '2×' });
await speedBtn2x.click();
const t1 = parseFloat(await page.locator('.clock').textContent() ?? '0');
await playBtn.click(); // play at 2x
await page.waitForTimeout(1000);
await playBtn.click(); // pause
const t2 = parseFloat(await page.locator('.clock').textContent() ?? '0');
check('playback 2x speed', t2 - t1 > 1.6, `clock ${t1.toFixed(2)} → ${t2.toFixed(2)} over 1s wall`);
await page.locator('.speeds button', { hasText: '1×' }).click();
const midClock = await page.locator('.clock').textContent();
check('playback advances clock', parseFloat(midClock ?? '') > 0.5, `clock=${midClock}`);
await page.screenshot({ path: `${SHOTS}/04-playing.png` });

// --- language switch via Preferences (rail gear → modal) ---
await page.locator('.tool-btn[aria-label="Preferences"], .tool-btn[aria-label="偏好设置"]').first().click();
await page.waitForTimeout(300);
const langSelect = page.locator('.prefs-modal select').first();
await langSelect.waitFor({ state: 'visible', timeout: 8000 });
await langSelect.selectOption('zh');
await page.waitForTimeout(300);
const zhText = await page.locator('.robot-list h2').first().textContent();
check('zh switch', /机器人/.test(zhText ?? ''), zhText ?? '');
await page.screenshot({ path: `${SHOTS}/05-zh.png` });
await langSelect.selectOption('zh-tw');
await page.waitForTimeout(300);
const twText = await page.locator('.robot-list h2').first().textContent();
check('zh-tw switch', /機器人/.test(twText ?? ''), twText ?? '');
await page.screenshot({ path: `${SHOTS}/06-zhtw.png` });
await langSelect.selectOption('en');
await page.locator('.prefs-modal .btn.small').click(); // Done
await page.waitForTimeout(200);
// theme: switch to light via Preferences, verify token + shot, then back
const prefsSelects = page.locator('.prefs-modal select');
await page.locator('.tool-btn[aria-label="Preferences"], .tool-btn[aria-label="偏好设置"]').first().click();
await page.waitForTimeout(200);
const themeSel = prefsSelects.nth(1);
await themeSel.selectOption('light');
await page.waitForTimeout(300);
const htmlTheme = await page.evaluate(() => document.documentElement.dataset.theme);
check('theme switches to light', htmlTheme === 'light', `data-theme=${htmlTheme}`);
await page.screenshot({ path: `${SHOTS}/15-theme-light.png` });
await themeSel.selectOption('dark');
await page.waitForTimeout(300);
await page.locator('.prefs-modal .btn.small').last().click(); // Done

// --- share link: dialog with the compressed session, then restore ---
await page.locator('.tool-btn[aria-label="Share link"]').click();
await page.waitForSelector('.share-box', { timeout: 5000 });
const shareText = await page.locator('.share-box').inputValue();
const hash = await page.evaluate(() => location.hash);
check(
  'share dialog shows link',
  shareText.includes('#s=') && hash.startsWith('#s='),
  shareText.slice(0, 40) + '…',
);
await page.locator('.prefs-modal .btn.small').last().click(); // close dialog

const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page2 = await ctx2.newPage();
await page2.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
await page2.waitForSelector('.robot-card', { timeout: 10000 });
const restoredCount = await page2.locator('.robot-card').count();
check('share link restores robots', restoredCount === 2, `cards=${restoredCount}`);
await page2.screenshot({ path: `${SHOTS}/07-share-restored.png` });
await ctx2.close();

// --- out-of-bounds + field bounds panel ---
await input.setInputFiles([`${SAMPLES}/ghostauto/out_of_bounds.ghostauto`]);
await page.waitForFunction(
  () => document.querySelectorAll('.robot-card').length === 3,
  undefined,
  { timeout: 10000 },
);
await page.locator('.conflict-jump.bounds').first().click().catch(() => {});
check('field-bounds entry appears', (await page.locator('.conflict-jump.bounds').count()) >= 1);
await page.screenshot({ path: `${SHOTS}/08-bounds.png` });

// --- season switch (2025 Reefscape, then the oldest 2018 POWER UP) ---
const seasonSelect = page.locator('select').first();
await seasonSelect.selectOption('reefscape-2025');
await page.waitForTimeout(700);
await page.screenshot({ path: `${SHOTS}/09-reefscape.png` });
check('season switch', true);
await seasonSelect.selectOption('powerup-2018');
await page.waitForTimeout(700);
check('oldest season (2018) renders', errors.length === 0);
await page.screenshot({ path: `${SHOTS}/09b-2018.png` });
await seasonSelect.selectOption('rebuilt-2026');
await page.waitForTimeout(400);

// --- custom field panel opens ---
await seasonSelect.selectOption('custom');
await page.waitForTimeout(300);
check('custom-field panel opens', await page.locator('.cf-panel').count() === 1);
// Real image upload into the calibrator (uses a bundled season field png).
await page.setInputFiles('.cf-panel input[type="file"]', `${process.cwd()}/assets/fields/rebuilt2026.png`);
await page.waitForTimeout(400);
check(
  'custom-field image loads',
  (await page.locator('.cf-panel').count()) === 1 && errors.length === 0,
);
await page.screenshot({ path: `${SHOTS}/10-custom-field.png` });
await page.locator('.cf-panel .btn.small').last().click(); // cancel
await seasonSelect.selectOption('rebuilt-2026');
await page.waitForTimeout(300);

// --- alliance toggle on a robot card ---
const firstCard = page.locator('.robot-card').first();
await firstCard.locator('.seg button').nth(1).click(); // Red
check(
  'alliance toggles to red',
  (await firstCard.locator('.seg button').nth(1).getAttribute('class'))?.includes('on-red'),
);
await firstCard.locator('.seg button').nth(0).click(); // back to Blue
check(
  'alliance toggles back to blue',
  (await firstCard.locator('.seg button').nth(0).getAttribute('class'))?.includes('on-blue'),
);

// --- geometry edit on a robot card ---
const lenInput = firstCard.locator('input[title="length"]');
await lenInput.fill('1.2');
check('geometry edit applies', (await lenInput.inputValue()) === '1.2');

// --- keyboard: Home rewinds, Space plays/pauses ---
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Home');
const beforeSpace = parseFloat(await page.locator('.clock').textContent() ?? '0');
check('Home rewinds clock', beforeSpace < 0.05, `clock=${beforeSpace}`);
await page.keyboard.press('Space');
await page.waitForTimeout(900);
await page.keyboard.press('Space');
const afterSpace = parseFloat(await page.locator('.clock').textContent() ?? '0');
check('Space toggles playback', afterSpace > 0.3, `clock 0 → ${afterSpace.toFixed(2)}`);

// --- PathPlanner native import (auto + paths in one batch) ---
await input.setInputFiles([
  `${SAMPLES}/pathplanner/Example Auto.auto`,
  `${SAMPLES}/pathplanner/Pickup.path`,
  `${SAMPLES}/pathplanner/Score.path`,
]);
await page.waitForFunction(
  () => document.querySelectorAll('.robot-card').length === 6,
  undefined,
  { timeout: 20000 },
);
check('PathPlanner auto batch import', true, '6 cards total');
await page.screenshot({ path: `${SHOTS}/11-pathplanner.png` });

// --- meditation editing: drag Pickup's first waypoint, see the badge, export ---
const pickupCard = page.locator('.robot-card', { hasText: 'Pickup' }).first();
await pickupCard.locator('button', { hasText: 'edit path' }).click();
await page.waitForTimeout(300);
const canvasBox = await page.locator('.field-canvas').boundingBox();
if (canvasBox) {
  // Fit-view scale for the 2026 field (16.54 × 8.07 + 0.5 margins), then the
  // screen position of Pickup's first anchor (1.4267, 1.88).
  const scale = Math.min(canvasBox.width / 17.54, canvasBox.height / 9.07);
  const ax = canvasBox.x + canvasBox.width / 2 + (1.4267 - 8.27) * scale;
  const ay = canvasBox.y + canvasBox.height / 2 - (1.88 - 4.035) * scale;
  await page.mouse.move(ax, ay);
  await page.mouse.down();
  await page.mouse.move(ax + 36, ay + 24, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}
check(
  'waypoint drag marks the robot adjusted',
  (await page.locator('.adjusted-badge').count()) >= 1,
);
await page.screenshot({ path: `${SHOTS}/13-editing.png` });

const [exportDl] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }).catch(() => undefined),
  pickupCard.locator('.export-row button', { hasText: '.path' }).click(),
]);
check('adjusted .path export downloads', exportDl !== undefined, exportDl?.suggestedFilename());
const [ghostDl] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }).catch(() => undefined),
  pickupCard.locator('.export-row button', { hasText: '.ghostauto' }).click(),
]);
check('adjusted .ghostauto export downloads', ghostDl !== undefined, ghostDl?.suggestedFilename());
await pickupCard.locator('button', { hasText: 'done editing' }).click();

// --- session save → reload through the real file input ---
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }).catch(() => undefined),
  page.locator('.tool-btn[aria-label="Save session"], .tool-btn[aria-label="保存会话"]').click(),
]);
check('session download triggers', download !== undefined);
let restored = 0;
if (download) {
  const buf = await download.path().then((p) => (p ? readFileSync(p) : undefined));
  if (buf) {
    const cardsBefore = await page.locator('.robot-card').count();
    // remove one robot, then restore the whole session from the saved file
    await page.locator('.robot-card .btn.icon.danger').first().click();
    await page.waitForTimeout(300);
    const afterRemove = await page.locator('.robot-card').count();
    check('robot remove works', afterRemove === cardsBefore - 1, `${cardsBefore} → ${afterRemove}`);
    await input.setInputFiles([
      { name: 'session.ghpb.json', mimeType: 'application/json', buffer: buf },
    ]);
    await page.waitForFunction(
      (n) => document.querySelectorAll('.robot-card').length === n,
      cardsBefore,
      { timeout: 10000 },
    );
    restored = await page.locator('.robot-card').count();
  }
}
check('session file restores all robots', restored >= 6, `cards=${restored}`);

// --- stress: import every valid sample in one batch (fresh context) ---
const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page3 = await ctx3.newPage();
const stressErrors = [];
page3.on('pageerror', (e) => stressErrors.push(String(e)));
await page3.goto(BASE, { waitUntil: 'domcontentloaded' });
const allSamples = [
  ...(await readdir(`${SAMPLES}/traj`)).map((f) => `${SAMPLES}/traj/${f}`),
  ...(await readdir(`${SAMPLES}/ghostauto`)).map((f) => `${SAMPLES}/ghostauto/${f}`),
  ...(await readdir(`${SAMPLES}/pathplanner`)).map((f) => `${SAMPLES}/pathplanner/${f}`),
];
await page3.locator('input[type="file"][multiple]').first().setInputFiles(allSamples);
await page3.waitForFunction(
  (n) => document.querySelectorAll('.robot-card').length >= n,
  16,
  { timeout: 20000 },
);
const stressCards = await page3.locator('.robot-card').count();
check('bulk import all samples', stressCards >= 16 && stressErrors.length === 0, `cards=${stressCards}`);
await page3.screenshot({ path: `${SHOTS}/12-bulk-stress.png` });
await ctx3.close();

// --- one-click conflict mediation: conflicts drop to 0, one robot delayed ---
const beforeCount = Number(await page.locator('.conflict-count').textContent());
await page.locator('.auto-resolve').click();
await page.waitForFunction(
  (n) => Number(document.querySelector('.conflict-count')?.textContent) < n,
  beforeCount,
  { timeout: 15000 },
);
const afterCount = await page.locator('.conflict-count').textContent();
check('auto-resolve reduces conflicts', true, `${beforeCount} → ${afterCount}`);
await page.screenshot({ path: `${SHOTS}/16-auto-resolved.png` });

// --- PNG export (2D canvas) triggers a download; guard against silent no-op in 3D ---
const [pngDl] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }).catch(() => undefined),
  page.locator('.tool-btn[aria-label="Export PNG"], .tool-btn[aria-label="导出 PNG"]').click(),
]);
check('PNG export downloads', pngDl !== undefined, pngDl?.suggestedFilename());
await page.locator('.canvas-bar .btn', { hasText: '3D' }).click();
await page.waitForTimeout(600);
check(
  'PNG disabled in 3D (no silent no-op)',
  (await page.locator('.tool-btn[aria-label="Export PNG"], .tool-btn[aria-label="导出 PNG"]').isDisabled()) === true,
);
await page.locator('.canvas-bar .btn', { hasText: '3D' }).click(); // back to 2D

// --- PWA service worker has registered and activated ---
const swUrl = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg?.active?.scriptURL ?? reg?.installing?.scriptURL ?? '';
});
check('service worker registered', swUrl.includes('sw.js'), swUrl);

// --- AI panel: opens to its settings form, fires nothing while off ---
await page.locator('.canvas-bar .btn', { hasText: 'Agent' }).click();
await page.waitForTimeout(300);
check(
  'AI panel opens with settings form (inert by default)',
  (await page.locator('.ai-panel').count()) === 1 &&
    (await page.locator('.ai-settings').count()) === 1 &&
    errors.length === 0,
);
await page.locator('.canvas-bar .btn', { hasText: 'Agent' }).click(); // close
await page.locator('.canvas-bar .btn', { hasText: '3D' }).click();
await page.waitForTimeout(1200);
check(
  '3D view renders (canvas + no errors)',
  (await page.locator('.field-canvas-3d canvas').count()) >= 1 && errors.length === 0,
);
await page.screenshot({ path: `${SHOTS}/14-3d.png` });
await page.locator('.canvas-bar .btn', { hasText: '3D' }).click(); // back to 2D
await page.locator('.canvas-bar .btn', { hasText: 'Agent' }).click(); // close

check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
