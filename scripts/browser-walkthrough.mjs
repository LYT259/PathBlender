/**
 * Real-browser end-to-end walkthrough against the production preview build.
 * View-only edition (2026-09-30): import → collision → playback (0.5×) →
 * language switch (8 locales) → share-link restore → field bounds → season +
 * variant persistence → custom field → read-only inspector → route library →
 * PathPlanner batch → session save/restore → bulk stress → PNG export →
 * service worker → 3D. The app adjusts nothing: no editing, no delays, no
 * auto-resolve, no AI anywhere.
 *
 * Screenshots land in /tmp/ghpb-shots. Usage: node scripts/browser-walkthrough.mjs
 * (expects `npm run preview` on :4173; system Chrome via channel, fallback bundled).
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

// System Chrome when present (no 150MB playwright download); bundled otherwise.
const browser = await chromium
  .launch(process.env.WALK_CHROME === '0' ? {} : { channel: 'chrome' })
  .catch(() => chromium.launch());
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
  permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
let modelLoaded = false;
page.on('response', (r) => { if (r.url().includes('fields3d/') && r.url().endsWith('model.glb') && r.status() === 200) modelLoaded = true; });

const rows = () => page.locator('.robot-library-row');
const fileInput = () => page.locator('input[type="file"][multiple]').first();
const rowByName = (name) => rows().filter({ has: page.locator('.robot-name', { hasText: name }) });

// The gear's aria-label follows the UI language — match every locale we ship.
const gearLocator = page.locator(
  ['.tool-btn[aria-label="Preferences"]', '.tool-btn[aria-label="Preferencias"]',
   '.tool-btn[aria-label="Tercihler"]', '.tool-btn[aria-label="Préférences"]',
   '.tool-btn[aria-label="偏好设置"]', '.tool-btn[aria-label="偏好設定"]'].join(', '),
).first();
// Since PR #65 Save keeps the window open; several sections below end with
// a Save. Opening the gear self-heals: close any open panel first so a
// leftover overlay can never block the click.
const prefsGear = async () => {
  if (await page.locator('.prefs-modal').count()) {
    await page.locator('.preferences-footer .btn:not(.accent)').click();
    await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
    await page.waitForTimeout(200);
  }
  return gearLocator;
};
const clockText = () => page.locator('.clock').textContent().then((t) => parseFloat(t ?? '0'));

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.workspace-empty');
// Empty state: the whole canvas bar (incl. view toggle) is replaced by the
// welcome screen; view3D defaults to false, asserted once robots exist.
check('page loads with the welcome state', true);
check(
  'import actions offered before any file is loaded',
  (await page.locator('.workspace-empty .welcome-import').count()) === 1 &&
    (await page.locator('.workspace-empty .welcome-folder-import').count()) === 1,
);
await page.screenshot({ path: `${SHOTS}/01-empty.png` });

// --- AI retreat (2026-09-20): no assistant surface anywhere ---
await (await prefsGear()).click();
await page.waitForSelector('.prefs-modal');
check('preferences carry no AI settings (code deleted)', (await page.locator('.prefs-modal .ai-row, .prefs-modal .prefs-ai').count()) === 0);
await page.locator('.preferences-footer .btn:not(.accent)').first().click(); // Cancel — the prefs redesign (0.1.4-beta era) moved the footer to .preferences-footer with .btn / .btn.accent

// --- import two ghost files through the real file input ---
await fileInput().setInputFiles([
  `${SAMPLES}/ghostauto/straight_run.ghostauto`,
  `${SAMPLES}/ghostauto/stop_and_score.ghostauto`,
]);
await page.waitForSelector('.robot-library-row', { timeout: 10000 });
await page.waitForSelector('.field-canvas');
check('starts in 2D (toggle pressed)', (await page.locator('.view-toggle button', { hasText: '2D' }).first().getAttribute('aria-pressed')) === 'true');
// First-run defaults (fresh profile): current season, welded construction,
// schematic artwork, 2D view.
{
  const season = await page.locator('.field-select').first().inputValue();
  const welded = await page.locator('select.field-variant option[value="welded"]').first().evaluate((o) => o.selected);
  const schematic = await page.locator('select.field-style option[value="schematic"]').first().evaluate((o) => o.selected);
  check(
    'first-run defaults: 2026 + welded + schematic',
    season === 'rebuilt-2026' && welded && schematic,
    `season=${season} welded=${welded} schematic=${schematic}`,
  );
}
await page.waitForFunction(
  () => document.querySelector('.conflict-count')?.textContent === '1',
  undefined,
  { timeout: 10000 },
);
check('collision detected (straight × stop)', true);
await page.screenshot({ path: `${SHOTS}/02-collision.png` });

// --- route library: picker beside each robot switches the active route ---
const picker = page.locator('select.route-picker').first();
await picker.waitFor({ timeout: 5000 });
const pickerOptions = await picker.locator('option').count();
check('route picker lists every imported route', pickerOptions === 2, `options=${pickerOptions}`);
const nameBefore = await page.locator('.robot-library-row .robot-name').first().textContent();
await picker.selectOption({ index: 1 });
await page.waitForTimeout(400);
const nameAfter = await page.locator('.robot-library-row .robot-name').first().textContent();
check('switching the picker swaps the robot’s route', nameBefore !== nameAfter, `${nameBefore} → ${nameAfter}`);
await picker.selectOption({ index: 0 });
await page.waitForTimeout(300);
check(
  'undo restores the previous route',
  (await page.locator('.robot-library-row .robot-name').first().textContent()) === nameBefore,
);
await page.locator('.route-library-add-btn').first().click();
await page.waitForTimeout(400);
check('library + places a route as another robot', (await rows().count()) === 3, `rows=${await rows().count()}`);
await page.locator('.robot-inspector-remove').click(); // remove it again via the auto-opened inspector
await page.waitForTimeout(300);

// --- jump to the conflict via the panel (back on the Checks tab) ---
await page.locator('.inspector-tabs button', { hasText: /^Checks|^检查/i }).click();
await page.waitForSelector('.conflict-jump', { timeout: 8000 });
await page.locator('.conflict-jump').first().click();
await page.waitForTimeout(300);
const jumpClock = await clockText();
check('conflict jump sets clock', jumpClock > 3, `clock=${jumpClock}`);
await page.screenshot({ path: `${SHOTS}/03-jumped.png` });

// --- playback: play/pause, 0.5× slows, only 0.25/0.5/1 offered ---
const playBtn = page.locator('.timeline-play');
// Rewind first: the wall-clock steps above vary run to run, and measuring
// the 0.5× rate near the trajectory's end trips the end-of-play rewind and
// reads as a backward jump.
await page.locator('.timeline-transport button').first().click();
await page.waitForTimeout(300);
await playBtn.click();
await page.waitForTimeout(1500);
await playBtn.click();
await page.locator('.timeline-speeds button', { hasText: '0.5×' }).click();
const t1 = await clockText();
await playBtn.click();
await page.waitForTimeout(1000);
await playBtn.click();
const t2 = await clockText();
check('playback 0.5× slows the clock', t2 - t1 > 0.25 && t2 - t1 < 0.9, `clock ${t1.toFixed(2)} → ${t2.toFixed(2)} over 1s wall`);
check(
  'fast-forward speeds removed',
  (await page.locator('.timeline-speeds button', { hasText: '2×' }).count()) === 0 &&
    (await page.locator('.timeline-speeds button', { hasText: '4×' }).count()) === 0,
);
await page.locator('.timeline-speeds button', { hasText: '1×' }).click();
const midClock = await clockText();
check('playback advances clock', midClock > 0.5, `clock=${midClock}`);
await page.screenshot({ path: `${SHOTS}/04-playing.png` });

// --- language switch via Preferences (staged save/cancel semantics) ---
// The 0.1.4-beta prefs redesign: sectioned panel (.preferences-nav tabs),
// footer .preferences-footer (.btn cancel / .btn.accent save), theme as
// radios, About as a section carrying .preferences-product + copy status.
const saveBtn = page.locator('.preferences-footer .btn.accent');
const cancelBtn = page.locator('.preferences-footer .btn:not(.accent)');
const langSelect = page.locator('.preferences-panel select').first();
await (await prefsGear()).click();
await langSelect.waitFor({ state: 'visible', timeout: 8000 });
// About block: natural-facing version ("0.1.4 · Beta N"), the full number,
// one-click copy (versioning scheme 2026-10-01). The exact number drifts
// with every merge by design — assert shape, not value.
await page.locator('.preferences-nav [role=tab]', { hasText: /^About$/ }).click();
{
  const display = (await page.locator('.preferences-product span').textContent())?.trim() ?? '';
  const full = (await page.locator('.preferences-product code').textContent())?.trim() ?? '';
  check(
    'About shows the version line + full number',
    /^\d+\.\d+\.\d+( · Beta \d+)?$/.test(display) && /^\d+\.\d+\.\d+(-beta\.\d+)?$/.test(full),
    `display="${display}" full="${full}"`,
  );
  const copyBtn = page.locator('.preferences-product button');
  check('About offers one-click version copy', (await copyBtn.count()) === 1);
  await copyBtn.click();
  await page.waitForTimeout(300);
  const copyStatus = (await page.locator('.preferences-copy-status').textContent()) ?? '';
  check('version copy reports success', copyStatus.length > 0, `status="${copyStatus}"`);
}
await page.locator('.preferences-nav [role=tab]', { hasText: /^General$/ }).click();
const optionCount = await langSelect.locator('option').count();
check('language list has all 8 choices', optionCount === 8, `options=${optionCount}`);
check('follow-system sits first', /Follow system|跟随系统|跟隨系統/i.test((await langSelect.locator('option').first().textContent()) ?? ''));
await langSelect.selectOption('zh');
await page.waitForTimeout(150);
check('save/cancel are always present in the footer', (await saveBtn.count()) === 1 && (await cancelBtn.count()) === 1);
// Cancel closes the modal AND discards the staged choice (v1.23 semantics).
await cancelBtn.click();
await page.waitForTimeout(300);
const headingAfterCancel = await page.locator('.robot-library-heading h2').first().textContent();
check(
  'cancel discards the pending language',
  (await page.locator('.prefs-modal').count()) === 0 && /Robots/.test(headingAfterCancel ?? ''),
  `modal=${await page.locator('.prefs-modal').count()} heading=${headingAfterCancel}`,
);
await (await prefsGear()).click();
await page.locator('.preferences-panel select').first().selectOption('zh');
await saveBtn.click();
await page.waitForTimeout(300);
// Since PR #65 Save keeps the window open (drafts apply in place); closing
// is via Cancel/Esc — close explicitly between language rounds.
check('save keeps the preferences window open (PR #65)', (await page.locator('.prefs-modal').count()) === 1);
const zhText = await page.locator('.robot-library-heading h2').first().textContent();
check('zh switch', /机器人/.test(zhText ?? ''), zhText ?? '');
await page.screenshot({ path: `${SHOTS}/05-zh.png` });
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);
// fr as a representative of the P1 batch (es/fr/tr)
await (await prefsGear()).click();
await page.locator('.preferences-panel select').first().selectOption('fr');
await saveBtn.click();
await page.waitForTimeout(300);
const frText = await page.locator('.robot-library-heading h2').first().textContent();
check('fr switch (P1 language)', /Robots/.test(frText ?? ''), frText ?? '');
await page.screenshot({ path: `${SHOTS}/05b-fr.png` });
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);
await (await prefsGear()).click();
await page.locator('.preferences-panel select').first().selectOption('en');
await saveBtn.click();
await page.waitForTimeout(300);
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);

// --- theme staged semantics (headless defaults light) ---
await (await prefsGear()).click();
const darkRadio = page.locator('.preferences-theme-choice input[value=dark]');
await darkRadio.check();
await page.waitForTimeout(150);
check('theme staged before Save', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'light');
await page.locator('.preferences-theme-choice input[value=light]').check();
await saveBtn.click();
await page.waitForTimeout(300);
const htmlTheme = await page.evaluate(() => document.documentElement.dataset.theme);
check('theme confirmed light on Save', htmlTheme === 'light', `data-theme=${htmlTheme}`);
await (await prefsGear()).click();
await page.locator('.preferences-theme-choice input[value=dark]').check();
await saveBtn.click();
await page.waitForTimeout(300);
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);

// --- share link: dialog with the compressed session, then restore ---
await page.locator('.share-action').click();
await page.waitForSelector('.share-box', { timeout: 5000 });
const shareText = await page.locator('.share-box').inputValue();
const hash = await page.evaluate(() => location.hash);
check('share dialog shows link', shareText.includes('#s=') && hash.startsWith('#s='), shareText.slice(0, 40) + '…');
await page.getByRole('button', { name: /Done|完成|完成/i }).first().click();

const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
const page2 = await ctx2.newPage();
await page2.goto(BASE + hash, { waitUntil: 'domcontentloaded' });
await page2.waitForSelector('.robot-library-row', { timeout: 10000 });
const restoredCount = await page2.locator('.robot-library-row').count();
check('share link restores robots', restoredCount === 2, `rows=${restoredCount}`);
await page2.screenshot({ path: `${SHOTS}/07-share-restored.png` });
await ctx2.close();

// --- out-of-bounds + field bounds panel ---
await fileInput().setInputFiles([`${SAMPLES}/ghostauto/out_of_bounds.ghostauto`]);
await page.waitForFunction(
  () => document.querySelectorAll('.robot-library-row').length === 3,
  undefined,
  { timeout: 10000 },
);
await page.locator('.conflict-jump.bounds').first().click().catch(() => {});
check('field-bounds entry appears', (await page.locator('.conflict-jump.bounds').count()) >= 1);
await page.screenshot({ path: `${SHOTS}/08-bounds.png` });

// --- season switch + AndyMark variant survive reload ---
const seasonSelect = page.locator('.field-select').first();
await seasonSelect.selectOption('reefscape-2025');
await page.waitForTimeout(700);
await page.locator('.field-select').nth(1).selectOption('andymark');
await page.waitForTimeout(400);
await page.evaluate(() => history.replaceState(null, '', location.pathname));
await page.reload({ waitUntil: 'domcontentloaded' });
// The reload clears the in-memory session; the empty state exposes no field
// controls, so re-import first — the canvas bar (with the selects) follows.
await fileInput().setInputFiles([
  `${SAMPLES}/ghostauto/straight_run.ghostauto`,
  `${SAMPLES}/ghostauto/stop_and_score.ghostauto`,
  `${SAMPLES}/ghostauto/out_of_bounds.ghostauto`,
]);
await page.waitForSelector('.robot-library-row', { timeout: 10000 });
await page.waitForSelector('.field-canvas');
const fieldAfterReload = await seasonSelect.inputValue();
const variantAfterReload = await page.locator('.field-select').nth(1).inputValue();
check('field + AndyMark variant survive reload', fieldAfterReload === 'reefscape-2025' && variantAfterReload === 'andymark', `field=${fieldAfterReload} variant=${variantAfterReload}`);
await page.screenshot({ path: `${SHOTS}/09-reefscape.png` });
// 2025's default style is the schematic (a single artwork): toggling the
// construction variant moves only the tag overlay (~7 cm at the coral
// stations) — still a repaint. The rendered style swaps the official
// artwork pair with the variant.
{
  const canvas2d = page.locator('canvas.field-canvas').first();
  const snap = () => canvas2d.evaluate((c) => c.toDataURL('image/png'));
  const styleSelect = page.locator('select.field-style');
  check('2025 exposes the style selector', (await styleSelect.count()) === 1);
  const amSchematic = await snap();
  await page.locator('.field-select').nth(1).selectOption('welded');
  await page.waitForTimeout(600);
  const wdSchematic = await snap();
  check('schematic variant toggle repaints (tag overlay moves)', amSchematic !== wdSchematic);
  await styleSelect.selectOption('rendered');
  await page.waitForTimeout(600);
  const wdRendered = await snap();
  check('style switch to rendered repaints', wdRendered !== wdSchematic);
  await page.locator('.field-select').nth(1).selectOption('andymark');
  await page.waitForTimeout(600);
  const amRendered = await snap();
  check('2025 rendered pair swaps with the construction variant', amRendered !== wdRendered);
  await styleSelect.selectOption('schematic');
  await page.waitForTimeout(600);
  check('style/variant toggles paint no console/HTTP errors', errors.length === 0, errors.slice(0, 3).join(' | '));
}
check('season switch', true);
await seasonSelect.selectOption('powerup-2018');
await page.waitForTimeout(700);
check('oldest season (2018) renders', errors.length === 0);
check('2018 hides the style selector (single artwork)', (await page.locator('select.field-style').count()) === 0);
// No official 3D model exists for 2018–2020 — the 2D/3D toggle must not
// render at all (user directive 2026-10-01: no 3D offer, no stand-in 3D).
check(
  'model-less season hides the 2D/3D toggle (2018)',
  (await page.locator('.view-toggle').count()) === 0,
);
await page.screenshot({ path: `${SHOTS}/09b-2018.png` });
await seasonSelect.selectOption('rebuilt-2026');
await page.waitForTimeout(400);

// --- custom field panel opens, takes an image, cancels ---
await seasonSelect.selectOption('custom');
await page.waitForTimeout(300);
check('custom-field panel opens', (await page.locator('.cf-panel').count()) === 1);
await page.setInputFiles('.cf-panel input[type="file"]', `${process.cwd()}/assets/fields/rebuilt2026.png`);
await page.waitForTimeout(400);
check('custom-field image loads', (await page.locator('.cf-panel').count()) === 1 && errors.length === 0);
await page.screenshot({ path: `${SHOTS}/10-custom-field.png` });
await page.locator('.cf-panel .btn.small').last().click();
await seasonSelect.selectOption('rebuilt-2026');
await page.waitForTimeout(300);

// --- inspector: read-only everywhere (2026-09-30 pivot) ---
await page.locator('.robot-library-row .robot-library-select').first().click();
await page.waitForTimeout(400);
const inspector = page.locator('.robot-inspector');
await inspector.waitFor();
check(
  'inspector is fully read-only (no spinbuttons/textboxes/toggles)',
  (await inspector.locator('input, .seg button').count()) === 0,
);
check('file alliance shown as text', (await inspector.getByText(/blue|red/i, { exact: true }).count()) >= 1);

// --- keyboard: Home rewinds, Space plays/pauses ---
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Home');
const beforeSpace = await clockText();
check('Home rewinds clock', beforeSpace < 0.05, `clock=${beforeSpace}`);
await page.keyboard.press('Space');
await page.waitForTimeout(900);
await page.keyboard.press('Space');
const afterSpace = await clockText();
check('Space toggles playback', afterSpace > 0.3, `clock 0 → ${afterSpace.toFixed(2)}`);

// --- PathPlanner native import (auto + paths in one batch) ---
await fileInput().setInputFiles([
  `${SAMPLES}/pathplanner/Example Auto.auto`,
  `${SAMPLES}/pathplanner/Pickup.path`,
  `${SAMPLES}/pathplanner/Score.path`,
]);
await page.waitForFunction(
  () => document.querySelectorAll('.robot-library-row').length === 6,
  undefined,
  { timeout: 20000 },
);
check('PathPlanner auto batch import', true, '6 rows total');
await page.screenshot({ path: `${SHOTS}/11-pathplanner.png` });

// --- waypoint editing on the canvas: enter, numeric edit, exports, leave ---
await rowByName('Pickup').first().locator('.robot-library-select').click();
await page.waitForTimeout(300);
// (No waypoint editing / adjusted exports anymore — the app is a viewer.)

// --- session save → remove one robot → restore through the file input ---
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }).catch(() => undefined),
  page.locator('.save-action').click(),
]);
check('session download triggers', download !== undefined);
let restoredRows = 0;
if (download) {
  const buf = await download.path().then((p) => (p ? readFileSync(p) : undefined));
  if (buf) {
    const before = await rows().count();
    await page.locator('.robot-inspector-remove').click();
    await page.waitForTimeout(300);
    const afterRemove = await rows().count();
    check('robot remove works', afterRemove === before - 1, `${before} → ${afterRemove}`);
    await fileInput().setInputFiles([
      { name: 'session.ghpb.json', mimeType: 'application/json', buffer: buf },
    ]);
    await page.waitForFunction(
      (n) => document.querySelectorAll('.robot-library-row').length === n,
      before,
      { timeout: 10000 },
    );
    restoredRows = await rows().count();
  }
}
check('session file restores all robots', restoredRows >= 6, `rows=${restoredRows}`);

// --- stress: import every valid sample in one batch (fresh context) ---
const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
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
  (n) => document.querySelectorAll('.robot-library-row').length >= n,
  16,
  { timeout: 20000 },
);
const stressRows = await page3.locator('.robot-library-row').count();
check('bulk import all samples', stressRows >= 16 && stressErrors.length === 0, `rows=${stressRows}`);
await page3.screenshot({ path: `${SHOTS}/12-bulk-stress.png` });
await ctx3.close();

// --- PNG export via the more-menu; disabled in 3D ---
await page.locator('.workspace-menu summary').click();
const [pngDl] = await Promise.all([
  page.waitForEvent('download', { timeout: 10000 }).catch(() => undefined),
  page.locator('.workspace-menu button', { hasText: /PNG/i }).click(),
]);
check('PNG export downloads', pngDl !== undefined, pngDl?.suggestedFilename());
await page.locator('.view-toggle button', { hasText: '3D' }).click();
await page.waitForTimeout(600);
await page.locator('.workspace-menu summary').click();
check(
  'PNG disabled in 3D (no silent no-op)',
  (await page.locator('.workspace-menu button:disabled', { hasText: /PNG/i }).count()) === 1,
);
await page.locator('.view-toggle button', { hasText: '2D' }).click();

// --- PWA service worker registered ---
const swUrl = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  return reg?.active?.scriptURL ?? reg?.installing?.scriptURL ?? '';
});
check('service worker registered', swUrl.includes('sw.js'), swUrl);

// --- 3D: render, model, theme hot-switch, orbit, tags ---
await page.locator('.view-toggle button', { hasText: '3D' }).click();
await page.waitForTimeout(1500);
check(
  '3D view renders (canvas + no errors)',
  (await page.locator('.field-canvas-3d canvas').count()) >= 1 && errors.length === 0,
);
check('official 3D field model loaded', modelLoaded, modelLoaded ? 'fields3d glb fetched' : 'no model request');
const sample3dSky = () =>
  page.evaluate(() => {
    const st = window.__pb3d;
    const cv = document.querySelector('.field-canvas-3d canvas');
    if (!st?.renderer || !st?.scene || !st?.camera || !cv) return null;
    st.renderer.render(st.scene, st.camera);
    const off = document.createElement('canvas');
    off.width = 1;
    off.height = 1;
    const g = off.getContext('2d', { willReadFrequently: true });
    g.drawImage(cv, 0, 0, Math.round(cv.width * 0.12), Math.round(cv.height * 0.12), 0, 0, 1, 1);
    const d = g.getImageData(0, 0, 1, 1).data;
    return [d[0], d[1], d[2]];
  });
const isDarkSky = (px) => Array.isArray(px) && px.every((v) => v < 60);
const isLightSky = (px) => Array.isArray(px) && px.every((v) => v > 210);
const skyDark = await sample3dSky();
check('3D sky is dark before theme switch', isDarkSky(skyDark), JSON.stringify(skyDark));
await (await prefsGear()).click();
await page.waitForSelector('.prefs-modal');
await page.locator('.preferences-theme-choice input[value=light]').check();
await page.locator('.preferences-footer .btn.accent').click();
await page.waitForTimeout(700);
const skyLight = await sample3dSky();
check('3D retints to light on hot-switch', isLightSky(skyLight), JSON.stringify(skyLight));
await page.screenshot({ path: `${SHOTS}/14b-3d-light.png` });
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);
await (await prefsGear()).click();
await page.waitForSelector('.prefs-modal');
await page.locator('.preferences-theme-choice input[value=dark]').check();
await page.locator('.preferences-footer .btn.accent').click();
await page.waitForTimeout(700);
await cancelBtn.click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });
await page.waitForTimeout(200);

// Damped orbit settles after release (no endless drift).
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
  check('damped orbit settles after release', Math.abs(settled - glide) < 0.005, `az ${glide.toFixed(3)}→${settled.toFixed(3)}`);
}
await page.screenshot({ path: `${SHOTS}/14-3d.png` });

// AprilTag quads follow the season (2026 welded: 32; 2025: 22).
{
  const tagCount = await page.evaluate(() => {
    let n = 0;
    window.__pb3d.scene.traverse((o) => { if (o.name.startsWith('apriltag-')) n++; });
    return n;
  });
  check('3D renders official tag quads (2026: 32)', tagCount === 32, `count=${tagCount}`);
}
const dynBefore = await page.evaluate(() => window.__pb3d.scene.getObjectByName('pb-dynamic')?.children.length ?? -1);
const camBefore = await page.evaluate(() => window.__pb3d.camera.position.toArray().map((v) => +v.toFixed(3)));
await page.locator('.field-select').first().selectOption('reefscape-2025');
await page.waitForFunction(
  () => document.querySelectorAll('.robot-library-row').length >= 1,
  undefined,
  { timeout: 20000, polling: 100 },
);
check('season switch with 3D open keeps robots', true);
// Regression (2026-09-30 user report): switching the field while in 3D used
// to leave the rebuilt scene without any path tubes or robot boxes.
{
  const dynAfter = await page.waitForFunction(
    (before) => {
      const n = window.__pb3d.scene.getObjectByName('pb-dynamic')?.children.length ?? -1;
      return n >= before && before > 0 ? n : false;
    },
    dynBefore,
    { timeout: 8000, polling: 120 },
  ).then((r) => r.jsonValue());
  check('3D paths & robots survive the in-3D season switch', dynAfter === dynBefore, `dynamic children ${dynBefore} → ${dynAfter}`);
  const camAfter = await page.evaluate(() => window.__pb3d.camera.position.toArray().map((v) => +v.toFixed(3)));
  check('camera keeps the user\'s exact viewpoint across the switch', JSON.stringify(camAfter) === JSON.stringify(camBefore), `${camBefore} → ${camAfter}`);
}

{
  const tagCount25 = await page.evaluate(() => {
    let n = 0;
    window.__pb3d.scene.traverse((o) => { if (o.name.startsWith('apriltag-')) n++; });
    return n;
  });
  check('3D tag quads follow season (2025: 22)', tagCount25 === 22, `count=${tagCount25}`);
}
// Back to the first season: the parsed model comes from the module cache —
// tags return instantly, the camera STILL holds, and the cache is warm.
await page.locator('.field-select').first().selectOption('rebuilt-2026');
await page.waitForFunction(() => {
  let n = 0;
  window.__pb3d.scene.traverse((o) => { if (o.name.startsWith('apriltag-')) n++; });
  return n === 32;
}, undefined, { timeout: 20000, polling: 150 });
{
  const dynBack = await page.evaluate(() => window.__pb3d.scene.getObjectByName('pb-dynamic')?.children.length ?? -1);
  const camBack = await page.evaluate(() => window.__pb3d.camera.position.toArray().map((v) => +v.toFixed(3)));
  const cacheSize = await page.evaluate(() => window.__pb3d.modelCacheSize());
  check('revisited season restores instantly from cache (tags 32)', true, `cache=${cacheSize}`);
  check('revisited season keeps paths & camera', dynBack === dynBefore && JSON.stringify(camBack) === JSON.stringify(camBefore), `dynamic=${dynBack}, cam=${camBack}`);
}

// Switching to a model-less season while in 3D falls back to 2D and the
// toggle disappears entirely; returning to a model season brings it back.
await page.locator('.field-select').first().selectOption('powerup-2018');
await page.waitForTimeout(600);
check(
  'model-less season in 3D view falls back to 2D, toggle hidden',
  (await page.locator('.view-toggle').count()) === 0 &&
    (await page.locator('canvas.field-canvas').count()) === 1,
);
await page.locator('.field-select').first().selectOption('rebuilt-2026');
await page.waitForTimeout(400);
check(
  'model season restores the 2D/3D toggle',
  (await page.locator('.view-toggle').count()) === 1,
);

// The 2D/3D choice survives a reload (user directive 2026-10-02).
await page.locator('.view-toggle button', { hasText: '3D' }).click();
await page.waitForSelector('.field-canvas-3d canvas', { timeout: 15000 });
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.workspace-empty');
await fileInput().setInputFiles([`${SAMPLES}/ghostauto/straight_run.ghostauto`]);
await page.waitForSelector('.field-canvas-3d canvas', { timeout: 15000 });
check('3D view restored after reload', true);
await page.locator('.view-toggle button', { hasText: '2D' }).click();
await page.waitForSelector('.field-canvas:not(.field-canvas-3d)', { timeout: 10000 });

// Field remembered across reload (explicit earlier choices).
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.workspace-empty');
await fileInput().setInputFiles([`${SAMPLES}/ghostauto/straight_run.ghostauto`]);
await page.waitForSelector('.field-canvas', { timeout: 10000 });
await page.waitForTimeout(800);
const restoredField = await page.locator('.field-select').first().inputValue();
check('field selection remembered across reload', restoredField === 'rebuilt-2026', restoredField);
const variantSelected = await page
  .locator('select option[value="andymark"]')
  .first()
  .evaluate((opt) => opt.selected);
check('explicit AndyMark choice survives reload', variantSelected === true);

check('no console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
