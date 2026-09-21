/**
 * Viewer-only deployment check: the website build (VITE_VIEWER_ONLY=1) must
 * keep import + playback + collision preview and drop every authoring and
 * export surface. Build with the flag, serve dist/ on :4179, then:
 *   VIEWER_BASE=http://localhost:4179/ node scripts/viewer-check.mjs
 */
import { chromium } from 'playwright-core';
import { resolve } from 'node:path';

const BASE = process.env.VIEWER_BASE ?? 'http://localhost:4179/';
const SAMPLES = resolve(process.cwd(), 'samples');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.field-canvas-3d canvas');
await page.locator('.view-toggle button', { hasText: '2D' }).click(); // to 2D for import flow
await page.waitForSelector('.field-canvas');

// --- toolbar: import/share/prefs stay; save & PNG are gone ---
const toolLabels = await page.locator('.toolbar .tool-label').allTextContents();
check('import button present', toolLabels.some((t) => /导入|Import/i.test(t)), JSON.stringify(toolLabels));
check('share button present', toolLabels.some((t) => /分享|Share/i.test(t)));
check('save button absent', !toolLabels.some((t) => /保存|Save/i.test(t)));
check('png button absent', !toolLabels.some((t) => /PNG/i.test(t)));
const ghHref = await page.locator('.toolbar .gh-link').first().getAttribute('href');
check('github link beside Prefs', ghHref === 'https://github.com/LYT259/pathblender', ghHref ?? 'missing');

// --- import still works end to end, collisions still detected ---
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
check('import + collision detection still work', true);

// --- robot card: annotation/view controls stay; authoring rows are gone ---
const card = page.locator('.robot-card').first();
await card.locator('.robot-body').waitFor({ timeout: 5000 }); // rows are open by default
const body = card.locator('.robot-body');
check('team number input present', (await body.locator('.robot-row input[type="text"]').count()) === 1);
check('visible switch present', (await body.locator('.robot-visible').count()) === 1);
check('alliance seg absent', (await body.locator('.seg .on-blue, .seg .on-red').count()) === 0);
check('delay input absent', (await body.locator('.robot-row input[type="number"]').count()) === 0);
check('edit button absent', (await body.locator('.edit-row').count()) === 0);
check('export row absent', (await body.locator('.export-row').count()) === 0);

// --- conflict panel: report stays, one-click resolve is gone ---
check('conflict panel renders', (await page.locator('.conflict-panel h2').count()) === 1);
check('auto-resolve button absent', (await page.locator('.auto-resolve').count()) === 0);

// --- AI is absent from the website entirely (no harness at all) ---
check('ai toggle absent', (await page.locator('.ai-toggle').count()) === 0);
check('ai panel absent', (await page.locator('.ai-panel').count()) === 0);
await page.locator('.tool-btn', { hasText: /Prefs|偏好设置|Preferences/ }).first().click();
await page.waitForSelector('.prefs-modal');
check('prefs has no AI section', (await page.locator('.prefs-modal .prefs-ai').count()) === 0);
check(
  'prefs has no update-channel row (website never self-updates)',
  (await page.locator('.prefs-modal select').count()) === 2,
);
const langOpts = await page.locator('.prefs-modal select').first().locator('option').allTextContents();
check(
  'language list: Follow system first',
  langOpts.length === 4 && /Follow system/i.test(langOpts[0] ?? ''),
  JSON.stringify(langOpts),
);
await page.locator('.prefs-modal .btn.small.accent').click(); // Save

// --- first visit follows the OS language ---
const zhCtx = await browser.newContext({ locale: 'zh-CN' });
const zhPage = await zhCtx.newPage();
await zhPage.goto(BASE, { waitUntil: 'domcontentloaded' });
await zhPage.waitForSelector('.robot-list h2', { timeout: 10000 });
const zhH2 = await zhPage.locator('.robot-list h2').first().textContent();
check('first visit follows OS language (zh-CN)', /机器人/.test(zhH2 ?? ''), zhH2 ?? '');
await zhCtx.close();

// Site flavor: the build under test shows exactly one cross-site entry.
const betaBadge = await page.locator('.beta-link').count();
const previewBanner = await page.locator('.site-preview-banner').count();
if (process.env.SITE_FLAVOR === 'preview') {
  check('preview banner present with stable link',
    previewBanner === 1 && betaBadge === 0 &&
      (await page.locator('.site-preview-banner a').getAttribute('href')) === 'https://pathblender.pages.dev');
} else {
  check('stable site offers the β badge to preview',
    betaBadge === 1 && previewBanner === 0 &&
      (await page.locator('.beta-link').getAttribute('href')) === 'https://pathblender-preview.pages.dev');
}
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
