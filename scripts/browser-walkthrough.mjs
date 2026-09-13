/**
 * Real-browser end-to-end walkthrough against the production preview build:
 * import → collision report → playback (incl. 0.5x speed) → language switch →
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
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
let modelLoaded = false;
page.on('response', (r) => { if (r.url().includes('fields3d/') && r.url().endsWith('model.glb') && r.status() === 200) modelLoaded = true; });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.field-canvas-3d canvas');
await page.waitForTimeout(800);
check('starts in 3D by default', true);
await page.locator('.view-toggle button', { hasText: '2D' }).click(); // to 2D for the import flow
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

// --- playback speeds: 0.25/0.5/1 only (2×/4× removed per user request);
//     verify the 0.5× step exists and slows the clock ---
const halfBtn = page.locator('.speeds button', { hasText: '0.5×' });
await halfBtn.click();
const t1 = parseFloat(await page.locator('.clock').textContent() ?? '0');
await playBtn.click(); // play at 0.5x
await page.waitForTimeout(1000);
await playBtn.click(); // pause
const t2 = parseFloat(await page.locator('.clock').textContent() ?? '0');
check('playback 0.5x speed slows the clock', t2 - t1 > 0.25 && t2 - t1 < 0.9, `clock ${t1.toFixed(2)} → ${t2.toFixed(2)} over 1s wall`);
check('fast-forward speeds removed', (await page.locator('.speeds button', { hasText: '2×' }).count()) === 0 && (await page.locator('.speeds button', { hasText: '4×' }).count()) === 0);
await page.locator('.speeds button', { hasText: '1×' }).click();
const midClock = await page.locator('.clock').textContent();
check('playback advances clock', parseFloat(midClock ?? '') > 0.5, `clock=${midClock}`);
await page.screenshot({ path: `${SHOTS}/04-playing.png` });

// --- language switch via Preferences (rail gear → modal) ---
// Language is staged: choosing reveals Cancel + blue Save; Cancel reverts,
// Save applies AND closes the modal (no second Done click).
const saveBtn = page.locator('.prefs-modal .btn.small.accent');
const cancelBtn = page.locator('.prefs-modal .prefs-row.btns .btn.small:not(.accent)');
const openPrefs = () =>
  page.locator('.tool-btn[aria-label="Preferences"], .tool-btn[aria-label="偏好设置"], .tool-btn[aria-label="偏好設定"]').first().click();
await openPrefs();
const langSelect = page.locator('.prefs-modal select').first();
await langSelect.waitFor({ state: 'visible', timeout: 8000 });
const firstOption = await langSelect.locator('option').first().textContent();
check('follow-system sits first in the language list', /Follow system|跟随系统|跟隨系統/i.test(firstOption ?? ''), firstOption ?? '');
await langSelect.selectOption('zh');
await page.waitForTimeout(150);
check('save/cancel are always present in the footer', (await saveBtn.count()) === 1 && (await cancelBtn.count()) === 1);
await cancelBtn.click();
await page.waitForTimeout(150);
check('cancel reverts the pending language', (await langSelect.inputValue()) !== 'zh');
await langSelect.selectOption('zh');
await saveBtn.click();
await page.waitForTimeout(300);
check('save closes the preferences modal', (await page.locator('.prefs-modal').count()) === 0);
const zhText = await page.locator('.robot-list h2').first().textContent();
check('zh switch', /机器人/.test(zhText ?? ''), zhText ?? '');
await page.screenshot({ path: `${SHOTS}/05-zh.png` });
await openPrefs();
await page.locator('.prefs-modal select').first().selectOption('zh-tw');
await saveBtn.click();
await page.waitForTimeout(300);
const twText = await page.locator('.robot-list h2').first().textContent();
check('zh-tw switch', /機器人/.test(twText ?? ''), twText ?? '');
await page.screenshot({ path: `${SHOTS}/06-zhtw.png` });
await openPrefs();
await page.locator('.prefs-modal select').first().selectOption('en');
await saveBtn.click();
await page.waitForTimeout(200);
// theme: switch to light via Preferences, verify token + shot, then back
const prefsSelects = page.locator('.prefs-modal select');
await page.locator('.tool-btn[aria-label="Preferences"], .tool-btn[aria-label="偏好设置"]').first().click();
await page.waitForTimeout(200);
const themeSel = prefsSelects.nth(1);
// Headless defaults to system-light, so stage dark first: the DOM must stay
// light until Save proves the staged semantics.
await themeSel.selectOption('dark');
await page.waitForTimeout(150);
check('theme staged before Save', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
await themeSel.selectOption('light');
await saveBtn.click();
await page.waitForTimeout(300);
const htmlTheme = await page.evaluate(() => document.documentElement.dataset.theme);
check('theme switches to light on Save', htmlTheme === 'light', `data-theme=${htmlTheme}`);
await page.screenshot({ path: `${SHOTS}/15-theme-light.png` });
await openPrefs();
await page.locator('.prefs-modal select').nth(1).selectOption('dark');
await saveBtn.click();
await page.waitForTimeout(300);

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
await page.getByRole('button', { name: 'Done' }).click(); // close share dialog (not the prefs Save)

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
// Variant stickiness: pick AndyMark, reload, both field and variant survive.
const variantSelect = page.locator('.field-select').nth(1);
await variantSelect.selectOption('andymark');
await page.waitForTimeout(400);
// Drop the share-link hash left by an earlier step — a reload with #s=…
// intentionally restores the shared session's own field instead.
await page.evaluate(() => history.replaceState(null, '', location.pathname));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.field-canvas-3d canvas');
const fieldAfterReload = await page.locator('select').first().inputValue();
const variantAfterReload = await page.locator('.field-select').nth(1).inputValue();
check(
  'field + AndyMark variant survive reload',
  fieldAfterReload === 'reefscape-2025' && variantAfterReload === 'andymark',
  `field=${fieldAfterReload} variant=${variantAfterReload}`,
);
// The reload cleared the in-memory session — re-import for the steps below
// (the out-of-bounds ghost too: later steps expect it in the card count).
await page.locator('input[type="file"][multiple]').first().setInputFiles([
  `${SAMPLES}/ghostauto/straight_run.ghostauto`,
  `${SAMPLES}/ghostauto/stop_and_score.ghostauto`,
  `${SAMPLES}/ghostauto/out_of_bounds.ghostauto`,
]);
await page.waitForSelector('.robot-card', { timeout: 10000 });
// The reload also reset the view to the 3D default — the rest of the flow
// assumes 2D (as after the initial toggle at the top).
await page.locator('.view-toggle button', { hasText: '2D' }).click();
await page.waitForSelector('.field-canvas');
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
await page.waitForSelector('.editor');
// Let the field image load and the initial fit settle before projecting
// drag coordinates onto the canvas.
await page.waitForTimeout(800);
check('editor page opens (own workspace)', true);
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
  page.locator('.editor-bar .seg button', { hasText: '.path' }).click(),
]);
check('adjusted .path export downloads', exportDl !== undefined, exportDl?.suggestedFilename());
const [ghostDl] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }).catch(() => undefined),
  page.locator('.editor-bar .seg button', { hasText: '.ghostauto' }).click(),
]);
check('adjusted .ghostauto export downloads', ghostDl !== undefined, ghostDl?.suggestedFilename());
// Numeric waypoint edit in the side panel marks the robot adjusted too
// (PP rows unfold first; Choreo rows are always visible).
await page.locator('.wp-head').first().click();
await page.waitForTimeout(200);
const firstNum = page.locator('.waypoint-panel input').first();
await firstNum.fill('2.5');
await firstNum.press('Enter');
await page.waitForTimeout(400);
check('numeric waypoint edit works', (await page.locator('.adjusted-badge').count()) >= 1);
await page.locator('.editor-back').click();
await page.waitForSelector('.app-body');
check('editor back returns to fusion', true);

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
await page.locator('.view-toggle button', { hasText: '3D' }).click();
await page.waitForTimeout(600);
check(
  'PNG disabled in 3D (no silent no-op)',
  (await page.locator('.tool-btn[aria-label="Export PNG"], .tool-btn[aria-label="导出 PNG"]').isDisabled()) === true,
);
await page.locator('.view-toggle button', { hasText: '2D' }).click(); // back to 2D

// --- PWA service worker has registered and activated ---
const swUrl = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg?.active?.scriptURL ?? reg?.installing?.scriptURL ?? '';
});
check('service worker registered', swUrl.includes('sw.js'), swUrl);

// --- AI panel: opens to its settings form, fires nothing while off ---
await page.locator('.ai-toggle').click();
await page.waitForTimeout(300);
check(
  'AI panel opens on the new-chat hero (inert by default)',
  (await page.locator('.ai-panel').count()) === 1 &&
    (await page.locator('.ai-hero').count()) === 1 &&
    (await page.locator('.ai-settings').count()) === 0 &&
    errors.length === 0,
);
// Harness composer: slash menu lists whitelisted commands; controls present.
const ta = page.locator('.ai-composer textarea');
await ta.fill('/');
await page.waitForTimeout(250);
const cmdCount = await page.locator('.ai-menu button').count();
await ta.fill('');
check(
  'harness composer is chat-only (+ / text / send) + slash menu',
  cmdCount >= 8 &&
    (await page.locator('.ai-composer select').count()) === 0 &&
    (await page.locator('.ai-composer textarea').count()) === 1 &&
    (await page.locator('.ai-model-chip').count()) === 1,
  `commands=${cmdCount}`,
);
await page.locator('.ai-top .ai-icon-btn').last().click(); // gear -> Preferences (AI settings live there now)
await page.waitForTimeout(200);
check(
  'gear reveals provider settings',
  (await page.locator('.prefs-modal .ai-row').count()) >= 1,
);
// DSH-parity surface: protocol picker + model discovery live in Preferences.
check(
  'provider settings include protocol picker + model discovery',
  (await page.locator('.prefs-modal select option[value="anthropic"]').count()) >= 1 &&
    (await page.locator('.prefs-modal .ai-models-actions button', { hasText: 'Fetch' }).count()) === 1,
);
await page.locator('.prefs-modal .btn.small.accent').click();
await page.waitForTimeout(150);

// History drawer + vision attach entry.
await page.locator('.ai-top .ai-icon-btn').nth(0).click(); // clock icon
check(
  'ai history drawer opens',
  (await page.locator('[data-testid="ai-history"]').count()) === 1,
);
await page.locator('.ai-top .ai-icon-btn').nth(0).click(); // close
await page.locator('.ai-composer .ai-icon-btn').first().click(); // plus menu
check(
  'plus menu offers file / folder / image attach',
  (await page.locator('.ai-menu button').count()) >= 3,
);
await page.keyboard.press('Escape');
await page.locator('.ai-toggle').click(); // close
await page.locator('.view-toggle button', { hasText: '3D' }).click();
await page.waitForTimeout(1200);
check(
  '3D view renders (canvas + no errors)',
  (await page.locator('.field-canvas-3d canvas').count()) >= 1 && errors.length === 0,
);
check('official 3D field model loaded', modelLoaded, modelLoaded ? 'fields3d glb fetched' : 'no model request');
// Theme hot-switch in 3D: the scene is built once per field; retint must
// follow without a reload (sky-corner sample: #1c1c1e dark / #ffffff light).
const sample3dSky = () =>
  page.evaluate(() => {
    const st = window.__pb3d;
    const cv = document.querySelector('.field-canvas-3d canvas');
    if (!st?.renderer || !st?.scene || !st?.camera || !cv) return null;
    // WebGL default is preserveDrawingBuffer:false — the buffer reads black
    // once composited. Re-render synchronously, then read in the same task.
    st.renderer.render(st.scene, st.camera);
    const off = document.createElement('canvas');
    off.width = 1;
    off.height = 1;
    const g = off.getContext('2d', { willReadFrequently: true });
    g.drawImage(cv, 0, 0, Math.round(cv.width * 0.12), Math.round(cv.height * 0.12), 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
const near = (px, rgb, tol = 6) =>
  Array.isArray(px) && rgb.every((v, i) => Math.abs(px[i] - v) <= tol);
const skyDark = await sample3dSky();
check('3D sky is dark before theme switch', near(skyDark, [28, 28, 30]), JSON.stringify(skyDark));
await page.locator('.tool-btn[aria-label="Preferences"], .tool-btn[aria-label="偏好设置"]').first().click();
await page.waitForSelector('.prefs-modal');
await page.locator('.prefs-modal select').nth(1).selectOption('light');
await page.locator('.prefs-modal .btn.small.accent').click(); // Save applies the staged theme
await page.waitForTimeout(700);
const skyLight = await sample3dSky();
check('3D retints to light on hot-switch', near(skyLight, [255, 255, 255]), JSON.stringify(skyLight));
await page.screenshot({ path: `${SHOTS}/14b-3d-light.png` });
await page.locator('.tool-btn[aria-label="Preferences"], .tool-btn[aria-label="偏好设置"]').first().click();
await page.waitForSelector('.prefs-modal');
await page.locator('.prefs-modal select').nth(1).selectOption('dark');
await page.locator('.prefs-modal .btn.small.accent').click();
await page.waitForTimeout(700);
const skyDark2 = await sample3dSky();
check('3D retints back to dark', near(skyDark2, [28, 28, 30]), JSON.stringify(skyDark2));
// Drag-orbit sanity: no ViewCube anymore (removed per user request), so the
// default-view anchor is the camera position itself.
const atHome = () =>
  page.waitForFunction(
    () => {
      const p = window.__pb3d.camera.position;
      return Math.abs(p.x) < 0.05 && Math.abs(p.y - 13.5) < 0.1 && Math.abs(p.z - 10.5) < 0.1;
    },
    undefined,
    { timeout: 6000, polling: 100 },
  );
await atHome();
check('3D opens at the overview camera', true);

// Damped drag (user-restored feel): the view glides after release, then
// settles — assert it STOPS (no endless drift / rAF death).
{
  const main = await page.locator('.field-canvas-3d canvas').first().boundingBox();
  await page.mouse.move(main.x + main.width / 2, main.y + main.height / 2);
  await page.mouse.down();
  await page.mouse.move(main.x + main.width / 2 + 160, main.y + main.height / 2 + 60, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(2600);
  const glide = await page.evaluate(() => window.__pb3d.controls.getAzimuthalAngle());
  await page.waitForTimeout(600);
  const settled = await page.evaluate(() => window.__pb3d.controls.getAzimuthalAngle());
  check(
    'damped orbit settles after release',
    Math.abs(settled - glide) < 0.005,
    `az ${glide.toFixed(3)}→${settled.toFixed(3)}`,
  );
}

// AprilTag pose sanity (2026 welded): the quad's outward normal must point
// into the field — tag 1 sits on the far wall (yaw π) → three −X; tag 2 on
// the reef face (yaw +π/2) → three −Z.
{
  const normals = await page.evaluate(() => {
    const out = {};
    for (const id of [1, 2]) {
      const tag = window.__pb3d.scene.getObjectByName(`apriltag-${id}`);
      if (!tag) continue;
      const Vector3 = Object.getPrototypeOf(tag.position).constructor;
      const dir = new Vector3(0, 0, 1).applyQuaternion(tag.quaternion);
      out[id] = [dir.x, dir.y, dir.z];
    }
    return out;
  });
  const nearV = (v, t) => v && Math.abs(v[0] - t[0]) < 0.06 && Math.abs(v[1] - t[1]) < 0.06 && Math.abs(v[2] - t[2]) < 0.06;
  check(
    'april tag normals point into the field (2026: tag1 −X, tag2 −Z)',
    nearV(normals[1], [-1, 0, 0]) && nearV(normals[2], [0, 0, -1]),
    JSON.stringify(normals),
  );
}

// Vertical drag reaches BOTH sides: down-press leans toward the far side
// (polar grows toward 2.6), up-raise tops out at 0.15 — never stuck.
{
  const main = await page.locator('.field-canvas-3d canvas').first().boundingBox();
  await page.mouse.move(main.x + main.width / 2, main.y + main.height / 2);
  await page.mouse.down();
  await page.mouse.move(main.x + main.width / 2, main.y + main.height / 2 + 400, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(2200);
  const polDown = await page.evaluate(() => window.__pb3d.controls.getPolarAngle());
  await page.mouse.move(main.x + main.width / 2, main.y + main.height / 2);
  await page.mouse.down();
  await page.mouse.move(main.x + main.width / 2, main.y + main.height / 2 - 900, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(2200);
  const polUp = await page.evaluate(() => window.__pb3d.controls.getPolarAngle());
  check(
    'cursor down sees the field top (Onshape direction)',
    Math.abs(polDown - 0.15) < 0.03,
    `down=${polDown.toFixed(2)}`,
  );
  check(
    'cursor up presses to the far-side low angle',
    polUp > 2.0,
    `up=${polUp.toFixed(2)}`,
  );
}

await page.screenshot({ path: `${SHOTS}/14-3d.png` });

// AprilTag quads: real 36h11 faces at the official poses (2026 = 32 tags).
{
  const tagCount = await page.evaluate(() => {
    let n = 0;
    window.__pb3d.scene.traverse((o) => {
      if (o.name.startsWith('apriltag-')) n++;
    });
    return n;
  });
  check('3D renders official tag quads (2026: 32)', tagCount === 32, `count=${tagCount}`);
}

// Season switch while 3D stays open: the scaffold rebuild (env map + model)
// must not starve the page — the old heavy-model regression.
await page.locator('select').first().selectOption('reefscape-2025');
await page.waitForFunction(
  () => document.querySelectorAll('.robot-card').length >= 1,
  undefined,
  { timeout: 20000, polling: 100 },
);
check('season switch with 3D open keeps robots', true);
{
  const tagCount25 = await page.evaluate(() => {
    let n = 0;
    window.__pb3d.scene.traverse((o) => {
      if (o.name.startsWith('apriltag-')) n++;
    });
    return n;
  });
  check('3D tag quads follow season (2025: 22)', tagCount25 === 22, `count=${tagCount25}`);
}

// Field + variant remembered across reloads (AndyMark default). Navigate to
// the bare URL — a leftover share-link hash would restore that session and
// (by design) override the remembered field.
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.field-canvas-3d canvas');
await page.waitForTimeout(800);
const restoredField = await page.locator('select').first().inputValue();
check('field selection remembered across reload', restoredField === 'reefscape-2025', restoredField);
const variantSelected = await page
  .locator('select option[value="andymark"]')
  .first()
  .evaluate((opt) => opt.selected);
check('variant defaults to AndyMark', variantSelected === true);

await page.locator('.view-toggle button', { hasText: '2D' }).click(); // back to 2D
await page.locator('.ai-toggle').click(); // close

check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
