/**
 * WHO RUNS THIS: developers (and the AI sessions working on this repo). The
 * app never ships it and no user ever sees it.
 *
 * WHAT IT PROVES: the website build (`VITE_VIEWER_ONLY=1`, what
 * pathblender.pages.dev serves) really is a viewer. Unit tests run in jsdom
 * without the flag and the full walkthroughs drive the complete build, so this
 * is the only harness that can answer two questions: (1) did the trimming
 * survive — is every export surface actually absent from the DOM rather than
 * just hidden or disabled; (2) does the trimmed product still
 * work — files import, a whole folder imports, the timeline plays, collisions
 * are still found. It also holds the website to its "nothing leaves the
 * browser" promise by refusing any cross-origin request, and checks that a
 * first visit follows the OS language.
 * A new button that leaks an export is exactly what this catches; without it,
 * the claim in README would rest on nobody forgetting.
 *
 * Expectations are read from source instead of being hardcoded, so the harness
 * cannot drift into asserting a UI that no longer exists (the failure mode that
 * retired the previous version of this file).
 *
 * Usage: VITE_VIEWER_ONLY=1 npm run build -w @pathblender/web
 *        node scripts/serve-dist.mjs 4179 &
 *        VIEWER_BASE=http://localhost:4179/ node scripts/viewer-check.mjs
 * System Chrome is used through the channel when present (no 150 MB download).
 * Exits non-zero on any failed check.
 */
import { chromium } from 'playwright-core';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.env.VIEWER_BASE ?? 'http://localhost:4179/';
const SAMPLES = resolve(process.cwd(), 'samples');
const ORIGIN = new URL(BASE).origin;

/** Counted from the dictionaries, never typed in: the old file said "4". */
const LANG_CODES = readdirSync(resolve(process.cwd(), 'packages/web/src/i18n'))
  .filter((f) => f.endsWith('.ts')).length;
/** Read from source: `const GITHUB_URL = '…'` in the app shell. */
const GITHUB_URL = readFileSync(resolve(process.cwd(), 'packages/web/src/App.tsx'), 'utf8')
  .match(/const GITHUB_URL = '([^']+)'/)?.[1] ?? '';
/** Read from source: `const SPEEDS = [...]` in the transport controls. */
const SPEEDS = JSON.parse(readFileSync(resolve(process.cwd(), 'packages/web/src/components/PlaybackControls.tsx'), 'utf8')
  .match(/const SPEEDS = (\[[^\]]+\])/)[1]);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium
  .launch(process.env.VIEWER_CHROME === '0' ? {} : { channel: 'chrome' })
  .catch(() => chromium.launch());

/** @param {{ locale?: string }} options */
async function openApp(options = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: options.locale ?? 'en-US' });
  const page = await ctx.newPage();
  const errors = [];
  const crossOrigin = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
  page.on('request', (r) => {
    try {
      const url = new URL(r.url());
      if (url.protocol.startsWith('http') && url.origin !== ORIGIN) crossOrigin.push(r.url());
    } catch { /* non-http scheme (data:, blob:) — local by definition */ }
  });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  return { ctx, page, errors, crossOrigin };
}

// ---------------------------------------------------------------- welcome ---
{
  const { ctx, page, errors, crossOrigin } = await openApp();

  const tops = page.locator('.menu-bar .menu-top');
  check('web menu bar renders its five sections', await tops.count() === 5, `${await tops.count()} sections`);

  check('welcome offers import + folder import + example + open session',
    await page.locator('.welcome-import').isVisible()
    && await page.locator('.welcome-folder-import').isVisible()
    && await page.locator('.welcome-try-example').isVisible()
    && await page.locator('.welcome-open-session').isVisible());
  check('loading the site asks nothing outside its own origin',
    crossOrigin.length === 0, crossOrigin.slice(0, 2).join(' | '));

  // ------------------------------------------------------------ import -----
  await page.locator('.welcome-import').click();
  await page.locator('input[type="file"][multiple]:not([webkitdirectory])').first()
    .setInputFiles([`${SAMPLES}/ghostauto/straight_run.ghostauto`, `${SAMPLES}/ghostauto/stop_and_score.ghostauto`]);
  await page.waitForSelector('.robot-library-row', { timeout: 15000 });

  const rows = await page.locator('.robot-library-row').count();
  check('two imported files become two robots', rows === 2, `${rows} rows`);
  const conflicts = Number((await page.locator('.conflict-count').first().textContent())?.trim() ?? '-1');
  check('collision checking still runs on the trimmed build', conflicts > 0, `${conflicts} conflicts`);
  check('playback timeline rendered', await page.locator('.timeline-speeds').isVisible());

  const speedLabels = await page.locator('.timeline-speeds button').allTextContents();
  check(`rate buttons are exactly the steps in source (${SPEEDS.join(', ')})`,
    speedLabels.length === SPEEDS.length
    && speedLabels.every((label, i) => label.includes(String(SPEEDS[i]))), speedLabels.join(' / '));

  // --------------------------------------------------- folder import -------
  // The website imports the way the app does. This is the channel that used to
  // exist only as an ungated drag-and-drop back door (2026-10-06: the buttons
  // were trimmed while the recursive drop handler shipped, so the site had the
  // capability and no control). It is a real control now, and it is exercised
  // as one — a directory path handed to the directory input, the way the
  // engine hands a chosen folder over.
  check('toolbar offers the folder import', await page.locator('.import-folder-action').isVisible());
  const dirInputs = await page.locator('input[webkitdirectory]').count();
  check('the directory input is mounted', dirInputs === 1, `${dirInputs} directory inputs`);

  const rowsBeforeFolder = await page.locator('.robot-library-row').count();
  await page.locator('.import-folder-action').click();
  await page.locator('input[webkitdirectory]').setInputFiles(`${SAMPLES}/ghostauto`);
  await page.waitForFunction(
    (n) => document.querySelectorAll('.robot-library-row').length === n + 1,
    rowsBeforeFolder,
    { timeout: 15000 },
  );
  check('a chosen folder lands as one team, its routes in the library',
    await page.locator('.import-banner').count() === 0,
    `${rowsBeforeFolder} → ${await page.locator('.robot-library-row').count()} teams`);

  // ------------------------------------------------------- what is absent ---

  const leaks = await page.locator('button, a, summary').evaluateAll((nodes) => nodes
    .filter((el) => {
      const text = `${el.textContent ?? ''} ${el.getAttribute('aria-label') ?? ''}`;
      return /save session|export solution|export gif|export png|导出方案包|导出 GIF|保存会话|下载路径/i.test(text);
    })
    .map((el) => (el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 40)));
  check('no save/export affordance anywhere in the rendered DOM', leaks.length === 0, leaks.slice(0, 3).join(' | '));

  const fileItems = await page.locator('.menu-bar .menu-top').first().textContent();
  await page.locator('.menu-bar .menu-top').first().click();
  const itemLabels = (await page.locator('.menu-panel .menu-item-label').allTextContents()).map((s) => s.trim());
  check('File menu opens', itemLabels.length > 0, `${fileItems?.trim()}: ${itemLabels.join(' / ')}`);
  check('File menu keeps both imports and clear',
    itemLabels.some((l) => /import files/i.test(l))
    && itemLabels.some((l) => /import folder/i.test(l))
    && itemLabels.some((l) => /clear session/i.test(l)));
  check('File menu drops save / exports / open session',
    !itemLabels.some((l) => /save session|export|open saved session/i.test(l)),
    itemLabels.join(' / '));
  await page.keyboard.press('Escape');

  const github = page.locator('.toolbar-github');
  check('GitHub link points where source says it should',
    await github.isVisible() && await github.getAttribute('href') === GITHUB_URL, await github.getAttribute('href') ?? 'missing');

  // Documented reality, asserted so the spec cannot drift again: the website
  // build keeps the arrangement entry (it edits the in-browser session, never
  // the imported files, and exports nothing). Pinned to the footer instance —
  // the same shortcut also keys the menu item and the help overlay.
  check('arrangement entry is present in the website timeline',
    await page.locator('.app-footer button[aria-keyshortcuts="e"]').count() === 1);

  // ------------------------------------------------------------- prefs -----
  await page.locator('button[aria-label="Preferences"]').click(); // locale pinned to en-US above
  await page.waitForSelector('.preferences-dialog');
  const langOptions = page.locator('.preferences-dialog select').first().locator('option');
  const count = await langOptions.count();
  const firstLabel = (await langOptions.first().textContent())?.trim() ?? '';
  check(`language picker lists all ${LANG_CODES} dictionaries plus “follow system”`,
    count === LANG_CODES + 1, `${count} options`);
  check('“follow system” is the first entry', /follow system/i.test(firstLabel), firstLabel);
  check('no update-channel picker (the site never self-updates)',
    await page.locator('.preferences-dialog select option[value="beta"]').count() === 0);
  // The site keeps no Updates tab at all (user request 2026-10-07): the
  // website itself is the beta channel.
  check('no Updates tab in the website settings',
    await page.locator('.preferences-dialog [role="tab"]:has-text("Updates")').count() === 0);

  // The preview-site cross links and banner are gone everywhere (2026-10-07):
  // the ⋮ menu carries no off-site jump and no banner markup renders at all.
  await page.keyboard.press('Escape'); // close prefs; the ⋮ menu still opens
  await page.locator('.workspace-menu summary').click();
  const menuLinks = await page.locator('.workspace-menu-items a').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href') ?? ''));
  check('workspace ⋮ menu links nowhere off-site', menuLinks.length === 0, menuLinks.join(' | '));
  check('no preview banner markup', await page.locator('.site-preview-banner').count() === 0);

  check('no page errors after the whole pass', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}

// ------------------------------------------- write paths with no button ---
// Hiding the affordance is not the gate. Until 2026-10-06 the File menu
// dropped Save on this build while the window Ctrl/Cmd+S accelerator kept
// calling saveSession, so pathblender.pages.dev downloaded .pb files that no
// button could produce — the one leak the DOM scans above cannot see.
// Each combination gets its own browser profile, for the two reasons that
// survived measurement. Attribution: both keys write the same file name
// (`session-YYYY-MM-DD.pb`), so a shared page can prove a leak happened but
// not which key caused it — on a build without the gate the SAME page
// delivered BOTH downloads (measured 2/2, reproduced twice), so nothing is
// lost by the split except that ambiguity. Isolation: a session loaded by an
// earlier probe is autosaved, and its restore hides the welcome screen the
// next probe waits for (seen as a timeout while this harness was written).
// The intuitive third reason — Chrome blocking a second automatic download per
// page — was tested and does NOT hold under Playwright, so it is deliberately
// not cited as the justification.
for (const combo of ['Control+s', 'Meta+s']) {
  const { ctx, page } = await openApp();
  await page.locator('.welcome-import').click();
  await page.locator('input[type="file"][multiple]:not([webkitdirectory])').first()
    .setInputFiles(`${SAMPLES}/ghostauto/straight_run.ghostauto`);
  await page.waitForSelector('.robot-library-row', { timeout: 15000 });
  const settled = page.waitForEvent('download', { timeout: 5000 })
    .then((d) => d.suggestedFilename()).catch(() => null);
  await page.keyboard.press(combo);
  const downloaded = await settled;
  check(`${combo} writes no file on the viewer build`, downloaded === null, downloaded ?? 'no download');
  await ctx.close();
}

// ------------------------------------------------- first visit follows OS ---
{
  const { ctx, page } = await openApp({ locale: 'zh-CN' });
  const lang = await page.evaluate(() => document.documentElement.lang);
  const importLabel = await page.locator('.welcome-import').getAttribute('aria-label');
  check('a zh-CN first visit opens in Chinese', lang.startsWith('zh') && /导入/.test(importLabel ?? ''), `${lang} / ${importLabel}`);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
