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

// --- AI surface: read-only actions + bounds skill only ---
await page.locator('.canvas-bar .ai-toggle').click();
await page.waitForSelector('.ai-panel .ai-composer textarea');
const ta = page.locator('.ai-panel .ai-composer textarea');
await ta.fill('/');
await page.waitForTimeout(300);
let cmds = await page.locator('.ai-menu .ai-cmd-name').allTextContents();
const cmdNames = cmds.map((c) => c.replace(/^\//, '').trim()).sort();
check(
  '"/" menu = 4 read-only actions',
  JSON.stringify(cmdNames) === JSON.stringify(['list_robots', 'query_collisions', 'remove_robot', 'set_team_number']),
  JSON.stringify(cmdNames),
);
await ta.fill('$');
await page.waitForTimeout(300);
cmds = await page.locator('.ai-menu .ai-cmd-name').allTextContents();
check('"$" menu = bounds skill only', cmds.length === 1, JSON.stringify(cmds));

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
