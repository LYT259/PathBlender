/**
 * WHO RUNS THIS: developers (and the AI sessions working on this repo). It
 * ships nothing and no user ever sees it. The hosted website is a VIEWER
 * build (`VITE_VIEWER_ONLY=1`): import, playback, collision checking, route
 * arranging and 3D stay, while everything that writes a file out or pulls a
 * whole folder in is meant to be gone. This harness proves that boundary in a
 * real browser instead of by reading `if (!VIEWER_ONLY)` in the source — and
 * it drives the surfaces a user could reach WITHOUT a visible button
 * (keyboard accelerators, menu items), which is exactly where such a gate
 * leaks.
 *
 * Every assertion below was measured against the shipped app on 2026-10-06;
 * the checks degrade to FAIL lines with details rather than throwing, so one
 * retired selector reports instead of hiding the other sixteen.
 *
 * Usage:
 *   VITE_VIEWER_ONLY=1 npm run build -w @pathblender/web
 *   npm run preview -w @pathblender/web -- --port 4179 --strictPort   # from the repo root
 *   VIEWER_BASE=http://localhost:4179/ node scripts/viewer-check.mjs
 * (or point VIEWER_BASE at https://pathblender.pages.dev to audit the live
 * site; for a preview-channel build add VITE_SITE_PREVIEW=1 and
 * SITE_FLAVOR=preview.) System Chrome is used through the channel, bundled
 * browser as fallback. Exits non-zero on any failed check.
 *
 * The desktop and web app behaviour as a whole is covered by
 * scripts/browser-walkthrough.mjs (pointer) and scripts/keyboard-walkthrough.mjs
 * (keyboard); this script only checks the website gating.
 */
import { chromium } from 'playwright-core';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.VIEWER_BASE ?? 'http://localhost:4179/';
const FLAVOR = process.env.SITE_FLAVOR ?? 'stable';
const SAMPLES = resolve(process.cwd(), 'samples');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium
  .launch(process.env.WALK_CHROME === '0' ? {} : { channel: 'chrome' })
  .catch(() => chromium.launch());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });

/** Text of the elements matching a selector, or [] when nothing matches. */
const texts = (selector) => page.evaluate((sel) => [...document.querySelectorAll(sel)].map((el) => (el.textContent ?? '').trim()), selector);
const count = (selector) => page.locator(selector).count();
const openFileMenu = async () => {
  await page.getByRole('button', { name: 'File', exact: true }).click();
  await page.waitForSelector('.menu-panel', { timeout: 5000 });
};

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.app.is-welcome', { timeout: 15000 });

// --- 1. welcome screen: file import and a saved session stay, folder goes ---
check('welcome offers import, opening a session and the example',
  (await count('.welcome-import')) === 1 && (await count('.welcome-open-session')) === 1 && (await count('.welcome-try-example')) === 1,
  `import=${await count('.welcome-import')} session=${await count('.welcome-open-session')} example=${await count('.welcome-try-example')}`);
check('welcome hides the folder import', (await count('.welcome-folder-import')) === 0);
// The parked 3D canvas mounts with the first robot, never on an empty page.
check('nothing is mounted on the field before a session exists', (await count('.field-canvas-3d canvas')) === 0 && (await count('.robot-library-row')) === 0);

// --- 2. the DOM menu bar is the only menu, and File is stripped down ---
const menuTops = await texts('.menu-bar .menu-top');
check('website renders the shared menu as a DOM menu bar', menuTops.includes('File') && !menuTops.includes('PathBlender'), JSON.stringify(menuTops));
await openFileMenu();
const fileItems = await texts('.menu-panel .menu-item');
check('File menu keeps only import and clear', JSON.stringify(fileItems) === JSON.stringify(['Import files', 'Clear Session']), JSON.stringify(fileItems));
const forbidden = ['Import folder', 'Open session', 'Save', 'Export Solution Package', 'Export GIF'];
check('File menu hides every export and folder entry',
  !fileItems.some((label) => forbidden.some((word) => label.toLowerCase().includes(word.toLowerCase()))),
  JSON.stringify(fileItems));
await page.keyboard.press('Escape');

// --- 3. accelerators: hidden must mean unreachable, not just invisible ---
// Ctrl/Cmd+S is the leak this harness was written for: the menu hid Save on
// the viewer build while the window keydown handler kept calling saveSession,
// so the public site downloaded a session file with no button anywhere.
// Each accelerator gets a FRESH profile — Chrome blocks a second automatic
// download from the same page (later probes would false-pass), and the app's
// debounced autosave restores the session so the welcome screen disappears
// under the next page.
const freshProbe = async () => {
  const probeCtx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', acceptDownloads: true });
  const probe = await probeCtx.newPage();
  await probe.goto(BASE, { waitUntil: 'domcontentloaded' });
  await probe.waitForSelector('.welcome-try-example', { timeout: 15000 });
  return { probeCtx, probe };
};
const saveAttempt = async (combo) => {
  const { probeCtx, probe } = await freshProbe();
  await probe.locator('.welcome-try-example').click();
  await probe.waitForSelector('.robot-library-row', { timeout: 20000 });
  const settled = probe.waitForEvent('download', { timeout: 5000 })
    .then((d) => d.suggestedFilename()).catch(() => null);
  await probe.keyboard.press(combo);
  const result = await settled;
  await probeCtx.close();
  return result;
};
for (const combo of ['Control+s', 'Meta+s']) {
  const downloaded = await saveAttempt(combo);
  check(`${combo} saves nothing on the viewer build`, downloaded === null, downloaded ? `downloaded ${downloaded}` : 'no download');
}

// --- 4. toolbar and the file pipeline stay ---
// The session the remaining checks act on: loaded here so step 3 could probe
// an untouched page.
await page.locator('.welcome-try-example').click();
await page.waitForSelector('.robot-library-row', { timeout: 20000 });
check('toolbar keeps file import, drops folder import',
  (await count('.import-action')) === 1 && (await count('.import-folder-action')) === 0,
  `import=${await count('.import-action')} folder=${await count('.import-folder-action')}`);
const { probeCtx: importCtx, probe: fresh } = await freshProbe();
await fresh.locator('input[type="file"][multiple]').first().setInputFiles([
  `${SAMPLES}/ghostauto/straight_run.ghostauto`,
  `${SAMPLES}/ghostauto/stop_and_score.ghostauto`,
]);
await fresh.waitForSelector('.robot-library-row', { timeout: 15000 });
await fresh.waitForFunction(() => document.querySelector('.conflict-count')?.textContent === '1', undefined, { timeout: 12000 });
check('importing real files still computes collisions on the website', (await fresh.locator('.robot-library-row').count()) === 2);
// Read-only cards: the robot list carries controls, not data inputs.
const rowsHaveInputs = await fresh.evaluate(() => [...document.querySelectorAll('.robot-library-row')]
  .some((row) => row.querySelectorAll('input, select, textarea').length > 0));
check('robot cards stay read-only (no inputs in a row)', !rowsHaveInputs);
await importCtx.close();

// --- 5. what the website DOES keep: arranging, heatmap, 3D ---
await page.locator('.robot-arrange-button').first().click();
await page.waitForSelector('.sequence-composer', { timeout: 8000 });
check('timeline arranging stays available (not gated away)',
  (await count('.sequence-composer')) === 1 && (await count('.sequence-route-source')) >= 1,
  `route sources=${await count('.sequence-route-source')}`);
await page.getByRole('button', { name: 'Back to playback' }).click();
await page.waitForSelector('.sequence-composer', { state: 'detached', timeout: 5000 });
check('heatmap switch stays on the canvas bar', (await count('.trails-control')) === 1);
await page.locator('.view-toggle button', { hasText: '3D' }).click();
await page.waitForTimeout(2500);
check('3D stays available on the website', (await count('.field-canvas-3d canvas')) >= 1 && errors.length === 0, errors[0] ?? '');
await page.locator('.view-toggle button', { hasText: '2D' }).click();
await page.waitForTimeout(600);

// --- 6. preferences: no self-update surface, full language list ---
await page.locator('.tool-btn[aria-label="Preferences"]').first().click();
await page.waitForSelector('.prefs-modal', { timeout: 5000 });
const prefTabs = await texts('.preferences-nav [role=tab]');
check('preferences sections are General / Controls / Updates / About',
  JSON.stringify(prefTabs) === JSON.stringify(['General', 'Controls', 'Updates', 'About']), JSON.stringify(prefTabs));
await page.locator('.preferences-nav [role=tab]', { hasText: /^Updates$/ }).click();
await page.waitForTimeout(200);
// The updates section exists on the website too, but it only points at the
// sibling channel: the release-channel select and the check/install buttons
// are desktop-only (`desktop ? … : site link`).
const updateSelects = await count('.prefs-modal select');
const updateButtons = await texts('.prefs-modal button');
check('Updates tab offers the sibling site, never a channel or self-update',
  (await count('.prefs-modal .prefs-link')) === 1 && updateSelects === 0
    && !updateButtons.some((label) => /check update|install/i.test(label)),
  `link=${await count('.prefs-modal .prefs-link')} selects=${updateSelects} buttons=${JSON.stringify(updateButtons)}`);
await page.locator('.preferences-nav [role=tab]', { hasText: /^General$/ }).click();
const langSelect = page.locator('.preferences-panel select, .preferences-dialog select').first();
const optionCount = await langSelect.locator('option').count();
const dictionaries = readdirSync(resolve(process.cwd(), 'packages/web/src/i18n')).filter((f) => f.endsWith('.ts')).length;
check('language picker offers every shipped dictionary', optionCount === dictionaries + 1, `options=${optionCount} dictionaries=${dictionaries}`);
check('no assistant surface anywhere in the preferences',
  (await count('.prefs-modal .ai-row, .prefs-modal .prefs-ai, .ai-panel, .ai-toggle')) === 0);
await page.locator('.preferences-footer .btn:not(.accent)').first().click();
await page.waitForSelector('.prefs-modal', { state: 'detached', timeout: 5000 });

// --- 7. site channel flavor ---
const banner = await count('.site-preview-banner');
await page.locator('.workspace-menu summary').click();
await page.waitForTimeout(200);
const menuLinks = await page.evaluate(() => [...document.querySelectorAll('.workspace-menu-items a')].map((a) => `${a.textContent?.trim()} → ${a.getAttribute('href')}`));
await page.keyboard.press('Escape');
if (FLAVOR === 'preview') {
  check('preview channel build shows its banner and links to stable',
    banner === 1 && (await texts('.site-preview-banner a')).length === 1, `banner=${banner} menu=${JSON.stringify(menuLinks)}`);
} else {
  check('stable site carries no banner and offers the preview channel',
    banner === 0 && menuLinks.some((l) => /preview\.pages\.dev/.test(l)), `banner=${banner} menu=${JSON.stringify(menuLinks)}`);
}

check('no page, console or HTTP errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
